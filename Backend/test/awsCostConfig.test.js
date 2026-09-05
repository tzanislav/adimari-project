'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AwsCostConfigurationError,
  createAwsCostConfig,
} = require('../config/awsCostConfig');

test('disables AWS cost reporting until it is explicitly enabled', () => {
  assert.deepEqual(createAwsCostConfig({}), { enabled: false });
});

test('creates an AWS Cost Explorer configuration with a dedicated IAM identity', () => {
  const config = createAwsCostConfig({
    AWS_COSTS_ENABLED: 'true',
    AWS_COSTS_AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
    AWS_COSTS_AWS_SECRET_ACCESS_KEY: 'example-secret',
    AWS_COSTS_CACHE_TTL_SECONDS: '120',
  });

  assert.equal(config.enabled, true);
  assert.equal(config.region, 'us-east-1');
  assert.equal(config.cacheTtlMs, 120000);
  assert.deepEqual(config.credentials, {
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: 'example-secret',
  });
});

test('permits IAM role credentials and rejects a partial static credential pair', () => {
  const roleConfig = createAwsCostConfig({ AWS_COSTS_ENABLED: 'true' });
  assert.equal(roleConfig.credentials, undefined);

  assert.throws(
    () => createAwsCostConfig({
      AWS_COSTS_ENABLED: 'true',
      AWS_COSTS_AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
    }),
    AwsCostConfigurationError
  );
});
