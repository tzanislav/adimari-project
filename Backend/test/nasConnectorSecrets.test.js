'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BASE64URL_256_BIT_PATTERN,
  NasConnectorSecretError,
  createDeviceSecret,
  createEnrollmentToken,
  hashDeviceSecret,
  hashEnrollmentToken,
  normalizeDeviceSecret,
  verifyDeviceSecret,
} = require('../services/nasConnectorSecrets');

const HMAC_SECRET = 'this-is-a-long-test-only-connector-hmac-secret';

test('NAS connector tokens and device secrets have 256 bits of random base64url material', () => {
  const first = createEnrollmentToken(HMAC_SECRET);
  const second = createEnrollmentToken(HMAC_SECRET);
  const deviceSecret = createDeviceSecret();

  assert.match(first.token, /^nce1_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.tokenHash, hashEnrollmentToken(first.token, HMAC_SECRET));
  assert.match(deviceSecret, BASE64URL_256_BIT_PATTERN);
  assert.equal(normalizeDeviceSecret(deviceSecret), deviceSecret);
});

test('connector credential comparison rejects malformed or incorrect device secrets without exposing them', () => {
  const deviceSecret = createDeviceSecret();
  const hash = hashDeviceSecret(deviceSecret, HMAC_SECRET);

  assert.equal(verifyDeviceSecret({ deviceSecret, expectedHash: hash, hmacSecret: HMAC_SECRET }), true);
  assert.equal(verifyDeviceSecret({
    deviceSecret: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    expectedHash: hash,
    hmacSecret: HMAC_SECRET,
  }), false);
  assert.equal(verifyDeviceSecret({ deviceSecret: 'not-a-secret', expectedHash: hash, hmacSecret: HMAC_SECRET }), false);
  assert.throws(() => normalizeDeviceSecret('not-a-secret'), NasConnectorSecretError);
});
