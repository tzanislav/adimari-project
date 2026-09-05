'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  OpenAiCostConfigurationError,
  createOpenAiCostConfig,
} = require('../config/openAiCostConfig');

test('disables OpenAI cost reporting until explicitly enabled', () => {
  assert.deepEqual(createOpenAiCostConfig({}), { enabled: false });
});

test('requires a dedicated OpenAI organization admin key when enabled', () => {
  assert.throws(
    () => createOpenAiCostConfig({ OPENAI_COSTS_ENABLED: 'true' }),
    OpenAiCostConfigurationError
  );

  const config = createOpenAiCostConfig({
    OPENAI_COSTS_ENABLED: 'true',
    OPENAI_ADMIN_KEY: 'sk-admin-example',
    OPENAI_COSTS_CACHE_TTL_SECONDS: '120',
  });

  assert.equal(config.adminApiKey, 'sk-admin-example');
  assert.equal(config.cacheTtlMs, 120000);
});
