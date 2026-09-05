'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { AwsCostService } = require('../services/awsCostService');

const total = (amount) => ({
  ResultsByTime: [{
    TimePeriod: { Start: '2026-09-01', End: '2026-10-01' },
    Total: {
      UnblendedCost: {
        Amount: String(amount),
        Unit: 'USD',
      },
    },
  }],
});

test('loads the summary periods and combines month-to-date cost with AWS forecast', async () => {
  const requests = [];
  const client = {
    send: async (command) => {
      requests.push(command.input);

      if (command.input.GroupBy) {
        return {
          ResultsByTime: [{
            TimePeriod: { Start: '2026-04-01', End: '2026-05-01' },
            // AWS leaves this object empty for service-grouped responses.
            Total: {},
            Groups: [
              { Keys: ['Amazon S3'], Metrics: { UnblendedCost: { Amount: '4', Unit: 'USD' } } },
              { Keys: ['Amazon EC2'], Metrics: { UnblendedCost: { Amount: '10', Unit: 'USD' } } },
            ],
          }],
        };
      }

      if (command.input.Metric === 'UNBLENDED_COST') {
        return { Total: { Amount: '22', Unit: 'USD' } };
      }

      if (command.input.TimePeriod.Start === '2026-09-01') {
        return total(8);
      }

      if (command.input.TimePeriod.End === '2026-09-01') {
        return total(31);
      }

      return total(11);
    },
  };
  const service = new AwsCostService({
    client,
    cacheTtlMs: 300000,
    now: () => new Date('2026-09-05T12:00:00.000Z'),
  });

  const summary = await service.getSummary();

  assert.equal(summary.currency, 'USD');
  assert.equal(summary.monthToDate, 8);
  assert.equal(summary.previousMonthSamePeriod, 11);
  assert.equal(summary.previousMonthTotal, 31);
  assert.equal(summary.forecastedMonthTotal, 30);
  assert.deepEqual(summary.period, { startDate: '2026-09-01', endDate: '2026-09-06' });
  assert.deepEqual(summary.monthlyBreakdown, [{
    startDate: '2026-04-01',
    endDate: '2026-05-01',
    total: 14,
    services: [
      { name: 'Amazon EC2', amount: 10 },
      { name: 'Amazon S3', amount: 4 },
    ],
  }]);
  assert.deepEqual(
    requests.find((request) => request.TimePeriod.Start === '2026-08-01' && request.TimePeriod.End === '2026-08-06').TimePeriod,
    { Start: '2026-08-01', End: '2026-08-06' }
  );
});

test('returns a cached summary without issuing a second set of Cost Explorer requests', async () => {
  let requestCount = 0;
  const client = {
    send: async (command) => {
      requestCount += 1;
      return command.input.Metric === 'UNBLENDED_COST'
        ? { Total: { Amount: '1', Unit: 'USD' } }
        : total(1);
    },
  };
  const service = new AwsCostService({
    client,
    cacheTtlMs: 300000,
    now: () => new Date('2026-09-05T12:00:00.000Z'),
  });

  await service.getSummary();
  await service.getSummary();

  assert.equal(requestCount, 5);
});

test('does not compare a long month with days from the following month', async () => {
  const requests = [];
  const client = {
    send: async (command) => {
      requests.push(command.input);
      return command.input.Metric === 'UNBLENDED_COST'
        ? { Total: { Amount: '1', Unit: 'USD' } }
        : total(1);
    },
  };
  const service = new AwsCostService({
    client,
    now: () => new Date('2026-03-31T12:00:00.000Z'),
  });

  await service.getSummary();

  assert.ok(requests.some((request) => (
    request.TimePeriod.Start === '2026-02-01'
    && request.TimePeriod.End === '2026-03-01'
  )));
});
