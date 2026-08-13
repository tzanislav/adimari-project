'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BASE64URL_256_BIT_PATTERN,
  NasConnectorSecretError,
  normalizeSharedSecret,
  verifySharedSecret,
} = require('../services/nasConnectorSecrets');

const SHARED_ACCESS_KEY = 'Z2VuZXJhdGVkLWRldmljZS1zZWNyZXQtMzItYnl0ZXM';

test('a shared connector key must be exactly 32 bytes of base64url material', () => {
  assert.match(SHARED_ACCESS_KEY, BASE64URL_256_BIT_PATTERN);
  assert.equal(normalizeSharedSecret(SHARED_ACCESS_KEY), SHARED_ACCESS_KEY);
  assert.throws(() => normalizeSharedSecret('not-a-shared-key'), NasConnectorSecretError);
});

test('shared connector-key comparison accepts only the configured key', () => {
  assert.equal(verifySharedSecret({ sharedSecret: SHARED_ACCESS_KEY, expectedSecret: SHARED_ACCESS_KEY }), true);
  assert.equal(verifySharedSecret({ sharedSecret: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', expectedSecret: SHARED_ACCESS_KEY }), false);
  assert.equal(verifySharedSecret({ sharedSecret: 'not-a-shared-key', expectedSecret: SHARED_ACCESS_KEY }), false);
});
