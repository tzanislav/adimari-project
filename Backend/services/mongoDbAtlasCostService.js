'use strict';

class MongoDbAtlasCostServiceError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'MongoDbAtlasCostServiceError';
  }
}

const asCents = (value) => {
  const cents = Number(value);
  return Number.isFinite(cents) ? cents : 0;
};

const startOfUtcMonth = (value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));

const addUtcMonths = (value, months) => new Date(Date.UTC(
  value.getUTCFullYear(), value.getUTCMonth() + months, 1
));

const toDateKey = (value) => value.toISOString().slice(0, 10);

const getMonthKey = (dateString) => {
  const value = new Date(dateString);
  return Number.isNaN(value.getTime()) ? null : toDateKey(startOfUtcMonth(value));
};

const createMonthlyHistory = (invoices, pendingInvoices) => {
  const totalsByMonth = new Map();
  const addInvoice = (invoice) => {
    const monthKey = getMonthKey(invoice.startDate);
    if (!monthKey) return;
    totalsByMonth.set(monthKey, (totalsByMonth.get(monthKey) || 0) + (asCents(invoice.amountBilledCents) / 100));
  };

  invoices
    .filter((invoice) => invoice.statusName !== 'PENDING')
    .forEach(addInvoice);
  pendingInvoices.forEach(addInvoice);

  return Array.from(totalsByMonth, ([startDate, total]) => ({ startDate, total }))
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
};

class MongoDbAtlasCostService {
  constructor({ config, fetchImpl = global.fetch, now = () => new Date() }) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.cache = null;
    this.pendingRequest = null;
  }

  async getSummary() {
    const requestedAt = this.now();
    const requestedAtMs = requestedAt.getTime();
    if (this.cache && this.cache.expiresAt > requestedAtMs) return this.cache.value;
    if (this.pendingRequest) return this.pendingRequest;

    this.pendingRequest = this.loadSummary(requestedAt)
      .then((value) => {
        this.cache = { value, expiresAt: requestedAtMs + this.config.cacheTtlMs };
        return value;
      })
      .finally(() => { this.pendingRequest = null; });

    return this.pendingRequest;
  }

  async loadSummary(requestedAt) {
    const currentMonthStart = startOfUtcMonth(requestedAt);
    const historyStart = addUtcMonths(currentMonthStart, -5);

    // Obtain a token before making the two parallel API requests so both calls
    // share the same short-lived credential.
    await this.getAccessToken();
    const [pendingResponse, invoices] = await Promise.all([
      this.getJson(`/api/atlas/v2/orgs/${this.config.organizationId}/invoices/pending`),
      this.getInvoices(historyStart),
    ]);
    const pendingInvoices = Array.isArray(pendingResponse.results) ? pendingResponse.results : [];
    const monthlyHistory = createMonthlyHistory(invoices, pendingInvoices);
    const currentMonthKey = toDateKey(currentMonthStart);
    const pendingMonth = pendingInvoices.length > 0
      ? monthlyHistory.find((month) => month.startDate === currentMonthKey)
      : null;
    const latestCompletedMonth = monthlyHistory
      .filter((month) => month.startDate < currentMonthKey)
      .at(-1);
    const displayedMonth = pendingMonth || latestCompletedMonth || null;

    return {
      currency: 'USD',
      generatedAt: requestedAt.toISOString(),
      currentMonthlyCost: displayedMonth?.total || 0,
      monthlyCostPeriod: displayedMonth
        ? { startDate: displayedMonth.startDate, isPending: Boolean(pendingMonth) }
        : null,
      monthlyHistory,
    };
  }

  async getInvoices(historyStart) {
    const invoices = [];
    let pageNum = 1;

    while (true) {
      const query = new URLSearchParams({
        fromDate: toDateKey(historyStart),
        itemsPerPage: '100',
        pageNum: String(pageNum),
        sortBy: 'START_DATE',
        orderBy: 'asc',
      });
      const payload = await this.getJson(`/api/atlas/v2/orgs/${this.config.organizationId}/invoices?${query}`);
      const results = Array.isArray(payload.results) ? payload.results : [];
      invoices.push(...results);

      const totalCount = Number(payload.totalCount);
      if (
        results.length === 0
        || results.length < 100
        || (Number.isFinite(totalCount) && invoices.length >= totalCount)
      ) {
        return invoices;
      }

      pageNum += 1;
    }
  }

  async getJson(path) {
    const accessToken = await this.getAccessToken();
    let response;

    try {
      response = await this.fetchImpl(`https://cloud.mongodb.com${path}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.atlas.2025-03-12+json',
        },
      });
    } catch (error) {
      throw new MongoDbAtlasCostServiceError('Could not connect to the MongoDB Atlas Administration API.', error);
    }

    if (!response.ok) {
      throw new MongoDbAtlasCostServiceError(`MongoDB Atlas Administration API returned HTTP ${response.status}.`);
    }

    return response.json();
  }

  async getAccessToken() {
    if (this.accessToken && this.accessTokenExpiresAt > Date.now()) return this.accessToken;

    let response;
    try {
      response = await this.fetchImpl('https://cloud.mongodb.com/api/oauth/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
    } catch (error) {
      throw new MongoDbAtlasCostServiceError('Could not authenticate with MongoDB Atlas.', error);
    }

    if (!response.ok) {
      throw new MongoDbAtlasCostServiceError(`MongoDB Atlas authentication returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    if (typeof payload.access_token !== 'string' || !payload.access_token) {
      throw new MongoDbAtlasCostServiceError('MongoDB Atlas authentication returned no access token.');
    }

    this.accessToken = payload.access_token;
    this.accessTokenExpiresAt = Date.now() + Math.max(0, (Number(payload.expires_in) || 3600) - 60) * 1000;
    return this.accessToken;
  }
}

const createMongoDbAtlasCostService = ({ config, fetchImpl, now }) => new MongoDbAtlasCostService({
  config,
  fetchImpl,
  now,
});

module.exports = {
  MongoDbAtlasCostService,
  MongoDbAtlasCostServiceError,
  createMongoDbAtlasCostService,
};
