'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { MongoDbAtlasCostService } = require('../services/mongoDbAtlasCostService');

test('summarizes pending and completed Atlas invoices into monthly costs', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const requestUrl = String(url);
    requests.push({ url: requestUrl, options });

    if (requestUrl === 'https://cloud.mongodb.com/api/oauth/token') {
      return { ok: true, json: async () => ({ access_token: 'atlas-token', expires_in: 3600 }) };
    }

    if (requestUrl.includes('/invoices/pending')) {
      return {
        ok: true,
        json: async () => ({
          results: [{ startDate: '2026-09-01T00:00:00Z', amountBilledCents: 142 }],
        }),
      };
    }

    if (requestUrl.includes('/invoices?')) {
      return {
        ok: true,
        json: async () => ({
          totalCount: 3,
          results: [
            { statusName: 'CLOSED', startDate: '2026-07-01T00:00:00Z', amountBilledCents: 300 },
            { statusName: 'CLOSED', startDate: '2026-08-01T00:00:00Z', amountBilledCents: 250 },
            { statusName: 'PENDING', startDate: '2026-09-01T00:00:00Z', amountBilledCents: 999 },
          ],
        }),
      };
    }

    throw new Error(`Unexpected request: ${requestUrl}`);
  };
  const service = new MongoDbAtlasCostService({
    config: {
      organizationId: '507f1f77bcf86cd799439011',
      clientId: 'atlas-client-id',
      clientSecret: 'atlas-client-secret',
      cacheTtlMs: 300000,
    },
    fetchImpl,
    now: () => new Date('2026-09-05T12:00:00.000Z'),
  });

  const summary = await service.getSummary();

  assert.equal(summary.currency, 'USD');
  assert.equal(summary.currentMonthlyCost, 1.42);
  assert.deepEqual(summary.monthlyCostPeriod, { startDate: '2026-09-01', isPending: true });
  assert.deepEqual(summary.monthlyHistory, [
    { startDate: '2026-07-01', total: 3 },
    { startDate: '2026-08-01', total: 2.5 },
    { startDate: '2026-09-01', total: 1.42 },
  ]);
  assert.equal(requests.filter(({ url }) => url.endsWith('/api/oauth/token')).length, 1);
  assert.equal(requests.filter(({ url }) => url.includes('/invoices')).every(
    ({ options }) => options.headers.Authorization === 'Bearer atlas-token'
  ), true);
});

test('uses the latest completed invoice when Atlas has no pending invoice', async () => {
  const fetchImpl = async (url) => {
    const requestUrl = String(url);
    if (requestUrl === 'https://cloud.mongodb.com/api/oauth/token') {
      return { ok: true, json: async () => ({ access_token: 'atlas-token', expires_in: 3600 }) };
    }
    if (requestUrl.includes('/invoices/pending')) return { ok: true, json: async () => ({ results: [] }) };
    if (requestUrl.includes('/invoices?')) {
      return {
        ok: true,
        json: async () => ({
          totalCount: 2,
          results: [
            { statusName: 'CLOSED', startDate: '2026-07-01T00:00:00Z', amountBilledCents: 300 },
            { statusName: 'CLOSED', startDate: '2026-08-01T00:00:00Z', amountBilledCents: 250 },
          ],
        }),
      };
    }
    throw new Error(`Unexpected request: ${requestUrl}`);
  };
  const service = new MongoDbAtlasCostService({
    config: {
      organizationId: '507f1f77bcf86cd799439011',
      clientId: 'atlas-client-id',
      clientSecret: 'atlas-client-secret',
      cacheTtlMs: 300000,
    },
    fetchImpl,
    now: () => new Date('2026-09-05T12:00:00.000Z'),
  });

  const summary = await service.getSummary();

  assert.equal(summary.currentMonthlyCost, 2.5);
  assert.deepEqual(summary.monthlyCostPeriod, { startDate: '2026-08-01', isPending: false });
});
