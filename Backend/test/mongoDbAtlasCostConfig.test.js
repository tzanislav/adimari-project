'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MongoDbAtlasCostConfigurationError,
  createMongoDbAtlasCostConfig,
} = require('../config/mongoDbAtlasCostConfig');

test('disables MongoDB Atlas cost reporting until explicitly enabled', () => {
  assert.deepEqual(createMongoDbAtlasCostConfig({}), { enabled: false });
});

test('requires an Atlas organization service account when enabled', () => {
  assert.throws(
    () => createMongoDbAtlasCostConfig({ MONGODB_ATLAS_COSTS_ENABLED: 'true' }),
    MongoDbAtlasCostConfigurationError
  );

  const config = createMongoDbAtlasCostConfig({
    MONGODB_ATLAS_COSTS_ENABLED: 'true',
    MONGODB_ATLAS_ORG_ID: '507f1f77bcf86cd799439011',
    MONGODB_ATLAS_CLIENT_ID: 'atlas-client-id',
    MONGODB_ATLAS_CLIENT_SECRET: 'atlas-client-secret',
    MONGODB_ATLAS_COSTS_CACHE_TTL_SECONDS: '120',
  });

  assert.equal(config.organizationId, '507f1f77bcf86cd799439011');
  assert.equal(config.clientId, 'atlas-client-id');
  assert.equal(config.cacheTtlMs, 120000);
});
