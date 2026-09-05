'use strict';

const millisecondsPerDay = 24 * 60 * 60 * 1000;

class OpenAiCostServiceError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'OpenAiCostServiceError';
  }
}

const asAmount = (value) => {
  const amount = Number(value);

  return Number.isFinite(amount) ? amount : 0;
};

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

const toDateKey = (value) => value.toISOString().slice(0, 10);

const getMonthKey = (unixSeconds) => toDateKey(startOfUtcMonth(new Date(unixSeconds * 1000)));

const createMonthlyBreakdown = (buckets) => {
  const months = new Map();

  buckets.forEach((bucket) => {
    const monthKey = getMonthKey(bucket.startTime);
    const month = months.get(monthKey) || { startDate: monthKey, services: new Map() };

    bucket.lineItems.forEach((lineItem) => {
      month.services.set(
        lineItem.name,
        (month.services.get(lineItem.name) || 0) + lineItem.amount
      );
    });

    months.set(monthKey, month);
  });

  return Array.from(months.values())
    .map((month) => {
      const services = Array.from(month.services, ([name, amount]) => ({ name, amount }))
        .filter((service) => service.amount !== 0)
        .sort((left, right) => right.amount - left.amount);

      return {
        startDate: month.startDate,
        total: services.reduce((total, service) => total + service.amount, 0),
        services,
      };
    })
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
};

class OpenAiCostService {
  constructor({ config, fetchImpl = global.fetch, now = () => new Date() }) {
    this.config = config;
    this.fetchImpl = fetchImpl;
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
          expiresAt: requestedAtMs + this.config.cacheTtlMs,
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
      Math.round((currentPeriodEnd.getTime() - currentMonthStart.getTime()) / millisecondsPerDay)
    );
    const previousSamePeriodEnd = new Date(Math.min(
      unboundedPreviousSamePeriodEnd.getTime(),
      currentMonthStart.getTime()
    ));
    const historyStart = addUtcMonths(currentMonthStart, -5);
    const buckets = await this.loadBuckets(historyStart, currentPeriodEnd);
    const amountForPeriod = (start, end) => buckets
      .filter((bucket) => bucket.startTime >= start.getTime() / 1000 && bucket.startTime < end.getTime() / 1000)
      .reduce((total, bucket) => total + bucket.total, 0);
    const firstCurrency = buckets.find((bucket) => bucket.currency)?.currency || 'USD';

    return {
      currency: firstCurrency.toUpperCase(),
      generatedAt: requestedAt.toISOString(),
      period: {
        startDate: toDateKey(currentMonthStart),
        endDate: toDateKey(currentPeriodEnd),
      },
      monthToDate: amountForPeriod(currentMonthStart, currentPeriodEnd),
      previousMonthSamePeriod: amountForPeriod(previousMonthStart, previousSamePeriodEnd),
      previousMonthTotal: amountForPeriod(previousMonthStart, currentMonthStart),
      monthlyBreakdown: createMonthlyBreakdown(buckets),
    };
  }

  async loadBuckets(startDate, endDate) {
    const buckets = [];
    const seenPages = new Set();
    let nextPage;

    do {
      const url = new URL('https://api.openai.com/v1/organization/costs');
      url.searchParams.set('start_time', String(Math.floor(startDate.getTime() / 1000)));
      url.searchParams.set('end_time', String(Math.floor(endDate.getTime() / 1000)));
      url.searchParams.set('bucket_width', '1d');
      url.searchParams.set('group_by', 'line_item');
      url.searchParams.set('limit', '180');

      if (nextPage) {
        url.searchParams.set('page', nextPage);
      }

      let response;

      try {
        response = await this.fetchImpl(url, {
          headers: {
            Authorization: `Bearer ${this.config.adminApiKey}`,
          },
        });
      } catch (error) {
        throw new OpenAiCostServiceError('Could not connect to the OpenAI Costs API.', error);
      }

      if (!response.ok) {
        throw new OpenAiCostServiceError(`OpenAI Costs API returned HTTP ${response.status}.`);
      }

      const payload = await response.json();
      (payload.data || []).forEach((bucket) => {
        const rawResults = bucket.results || [];
        const lineItems = (bucket.results || []).map((result) => ({
          name: result.line_item || 'Other API costs',
          amount: asAmount(result.amount?.value),
        }));

        buckets.push({
          startTime: Number(bucket.start_time),
          endTime: Number(bucket.end_time),
          total: lineItems.reduce((total, lineItem) => total + lineItem.amount, 0),
          currency: rawResults.find((result) => result.amount?.currency)?.amount?.currency,
          lineItems,
        });
      });

      nextPage = payload.has_more ? payload.next_page : null;

      if (nextPage && seenPages.has(nextPage)) {
        throw new OpenAiCostServiceError('OpenAI Costs API returned a repeated pagination cursor.');
      }

      seenPages.add(nextPage);
    } while (nextPage);

    return buckets;
  }
}

const createOpenAiCostService = ({ config, fetchImpl, now }) => new OpenAiCostService({
  config,
  fetchImpl,
  now,
});

module.exports = {
  OpenAiCostService,
  OpenAiCostServiceError,
  createOpenAiCostService,
};
