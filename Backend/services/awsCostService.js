'use strict';

const {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostForecastCommand,
} = require('@aws-sdk/client-cost-explorer');

const COST_METRIC = 'UnblendedCost';
const FORECAST_METRIC = 'UNBLENDED_COST';

class AwsCostServiceError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'AwsCostServiceError';
  }
}

const asAmount = (metric) => {
  const amount = Number(metric?.Amount);

  return Number.isFinite(amount) ? amount : 0;
};

const asCurrency = (metric) => metric?.Unit || 'USD';

// GetCostAndUsage returns totals for each time bucket, unlike GetCostForecast,
// which returns its total directly on the response.
const getCostAndUsageMetric = (response) => response.ResultsByTime?.[0]?.Total?.[COST_METRIC];

const getCostAndUsageAmount = (response) => (response.ResultsByTime || []).reduce(
  (total, result) => total + asAmount(result.Total?.[COST_METRIC]),
  0
);

const startOfUtcDay = (value) => new Date(Date.UTC(
  value.getUTCFullYear(),
  value.getUTCMonth(),
  value.getUTCDate()
));

const startOfUtcMonth = (value) => new Date(Date.UTC(
  value.getUTCFullYear(),
  value.getUTCMonth(),
  1
));

const addUtcDays = (value, days) => {
  const nextValue = new Date(value);
  nextValue.setUTCDate(nextValue.getUTCDate() + days);
  return nextValue;
};

const addUtcMonths = (value, months) => new Date(Date.UTC(
  value.getUTCFullYear(),
  value.getUTCMonth() + months,
  1
));

const toAwsDate = (value) => value.toISOString().slice(0, 10);

const toTimePeriod = (start, end) => ({
  Start: toAwsDate(start),
  End: toAwsDate(end),
});

const createCostRequest = (timePeriod, { groupByService = false } = {}) => ({
  TimePeriod: timePeriod,
  Granularity: 'MONTHLY',
  Metrics: [COST_METRIC],
  ...(groupByService ? { GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }] } : {}),
});

const toMonthlyBreakdown = (response) => {
  const monthsByPeriod = new Map();

  (response.ResultsByTime || []).forEach((result) => {
    const startDate = result.TimePeriod?.Start;
    const endDate = result.TimePeriod?.End;

    if (!startDate || !endDate) {
      return;
    }

    const periodKey = `${startDate}:${endDate}`;
    const month = monthsByPeriod.get(periodKey) || {
      startDate,
      endDate,
      services: new Map(),
    };

    (result.Groups || []).forEach((group) => {
      const name = group.Keys?.[0] || 'Other';
      const amount = asAmount(group.Metrics?.[COST_METRIC]);
      month.services.set(name, (month.services.get(name) || 0) + amount);
    });

    monthsByPeriod.set(periodKey, month);
  });

  return Array.from(monthsByPeriod.values())
    .map((month) => {
      const services = Array.from(month.services, ([name, amount]) => ({ name, amount }))
        .filter((service) => service.amount > 0)
        .sort((left, right) => right.amount - left.amount);

      // Grouped Cost Explorer results commonly return an empty Total object.
      // The service groups are the complete source of truth for this chart/table.
      return {
        startDate: month.startDate,
        endDate: month.endDate,
        total: services.reduce((total, service) => total + service.amount, 0),
        services,
      };
    })
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
};

const getCostAndUsage = async (client, request) => {
  const resultsByTime = [];
  const seenTokens = new Set();
  let nextPageToken;

  do {
    const response = await client.send(new GetCostAndUsageCommand({
      ...request,
      ...(nextPageToken ? { NextPageToken: nextPageToken } : {}),
    }));
    resultsByTime.push(...(response.ResultsByTime || []));
    nextPageToken = response.NextPageToken;

    if (nextPageToken && seenTokens.has(nextPageToken)) {
      throw new AwsCostServiceError('AWS Cost Explorer returned a repeated pagination token.');
    }

    seenTokens.add(nextPageToken);
  } while (nextPageToken);

  return { ResultsByTime: resultsByTime };
};

const getForecastAmount = async (client, timePeriod) => {
  const response = await client.send(new GetCostForecastCommand({
    TimePeriod: timePeriod,
    Granularity: 'MONTHLY',
    Metric: FORECAST_METRIC,
  }));

  return asAmount(response.Total);
};

class AwsCostService {
  constructor({ client, cacheTtlMs = 300000, now = () => new Date() }) {
    this.client = client;
    this.cacheTtlMs = cacheTtlMs;
    this.now = now;
    this.cache = null;
    this.pendingRequest = null;
  }

  async getSummary() {
    const requestedAt = this.now();
    const requestedAtMs = requestedAt.getTime();

    if (this.cache && this.cache.expiresAt > requestedAtMs) {
      return this.cache.value;
    }

    if (this.pendingRequest) {
      return this.pendingRequest;
    }

    this.pendingRequest = this.loadSummary(requestedAt)
      .then((value) => {
        this.cache = {
          value,
          expiresAt: requestedAtMs + this.cacheTtlMs,
        };
        return value;
      })
      .finally(() => {
        this.pendingRequest = null;
      });

    return this.pendingRequest;
  }

  async loadSummary(requestedAt) {
    const today = startOfUtcDay(requestedAt);
    const currentMonthStart = startOfUtcMonth(today);
    const currentPeriodEnd = addUtcDays(today, 1);
    const previousMonthStart = addUtcMonths(currentMonthStart, -1);
    const unboundedPreviousSamePeriodEnd = addUtcDays(
      previousMonthStart,
      Math.round((currentPeriodEnd.getTime() - currentMonthStart.getTime()) / (24 * 60 * 60 * 1000))
    );
    // A shorter preceding month cannot supply a matching day range beyond its own end.
    const previousSamePeriodEnd = new Date(Math.min(
      unboundedPreviousSamePeriodEnd.getTime(),
      currentMonthStart.getTime()
    ));
    const nextMonthStart = addUtcMonths(currentMonthStart, 1);
    const historyStart = addUtcMonths(currentMonthStart, -5);

    try {
      const [currentResponse, previousSamePeriodResponse, previousMonthResponse, breakdownResponse, forecastResult] = await Promise.all([
        getCostAndUsage(this.client, createCostRequest(
          toTimePeriod(currentMonthStart, currentPeriodEnd)
        )),
        getCostAndUsage(this.client, createCostRequest(
          toTimePeriod(previousMonthStart, previousSamePeriodEnd)
        )),
        getCostAndUsage(this.client, createCostRequest(
          toTimePeriod(previousMonthStart, currentMonthStart)
        )),
        getCostAndUsage(this.client, createCostRequest(
          toTimePeriod(historyStart, currentPeriodEnd),
          { groupByService: true }
        )),
        // Cost Explorer needs sufficient historic data to provide a forecast. Costs remain useful if it cannot.
        getForecastAmount(this.client, toTimePeriod(today, nextMonthStart)).catch(() => null),
      ]);

      const currentMetric = getCostAndUsageMetric(currentResponse);
      const currentMonthToDate = getCostAndUsageAmount(currentResponse);
      const forecastedMonthTotal = forecastResult === null
        ? null
        : currentMonthToDate + forecastResult;

      return {
        currency: asCurrency(currentMetric),
        generatedAt: requestedAt.toISOString(),
        period: {
          startDate: toAwsDate(currentMonthStart),
          endDate: toAwsDate(currentPeriodEnd),
        },
        monthToDate: currentMonthToDate,
        previousMonthSamePeriod: getCostAndUsageAmount(previousSamePeriodResponse),
        forecastedMonthTotal,
        previousMonthTotal: getCostAndUsageAmount(previousMonthResponse),
        monthlyBreakdown: toMonthlyBreakdown(breakdownResponse),
      };
    } catch (error) {
      throw new AwsCostServiceError('Could not retrieve AWS Cost Explorer data.', error);
    }
  }
}

const createAwsCostService = ({ config, client, now }) => new AwsCostService({
  client: client || new CostExplorerClient({
    region: config.region,
    credentials: config.credentials,
  }),
  cacheTtlMs: config.cacheTtlMs,
  now,
});

module.exports = {
  AwsCostService,
  AwsCostServiceError,
  createAwsCostService,
  toMonthlyBreakdown,
};
