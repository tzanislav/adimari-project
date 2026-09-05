'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { OpenAiCostService } = require('../services/openAiCostService');

const toUnixSeconds = (date) => Math.floor(new Date(`${date}T00:00:00.000Z`).getTime() / 1000);

const bucket = (date, results) => ({
  start_time: toUnixSeconds(date),
  end_time: toUnixSeconds(date) + (24 * 60 * 60),
  results: results.map(([lineItem, value]) => ({
    line_item: lineItem,
    amount: { value, currency: 'usd' },
  })),
});

test('summarizes paginated OpenAI Costs API data by month and line item', async () => {
  const urls = [];
  const fetchImpl = async (url, options) => {
    urls.push({ url: String(url), options });
    const isSecondPage = new URL(url).searchParams.get('page') === 'page-two';

    return {
      ok: true,
      json: async () => (isSecondPage ? {
        data: [
          bucket('2026-08-02', [['gpt-5, output_tokens', 5]]),
          bucket('2026-08-20', [['gpt-5, input_tokens', 10]]),
        ],
        has_more: false,
        next_page: null,
      } : {
        data: [
          bucket('2026-08-01', [['gpt-5, input_tokens', 6]]),
          bucket('2026-09-01', [['gpt-5, input_tokens', 4]]),
        ],
        has_more: true,
        next_page: 'page-two',
      }),
    };
  };
  const service = new OpenAiCostService({
    config: { adminApiKey: 'sk-admin-example', cacheTtlMs: 300000 },
    fetchImpl,
    now: () => new Date('2026-09-05T12:00:00.000Z'),
  });

  const summary = await service.getSummary();

  assert.equal(summary.currency, 'USD');
  assert.equal(summary.monthToDate, 4);
  assert.equal(summary.previousMonthSamePeriod, 11);
  assert.equal(summary.previousMonthTotal, 21);
  assert.deepEqual(summary.monthlyBreakdown, [
    {
      startDate: '2026-08-01',
      total: 21,
      services: [
        { name: 'gpt-5, input_tokens', amount: 16 },
        { name: 'gpt-5, output_tokens', amount: 5 },
      ],
    },
    {
      startDate: '2026-09-01',
      total: 4,
      services: [{ name: 'gpt-5, input_tokens', amount: 4 }],
    },
  ]);
  assert.equal(urls.length, 2);
  assert.match(urls[0].url, /group_by=line_item/);
  assert.equal(urls[0].options.headers.Authorization, 'Bearer sk-admin-example');
});
