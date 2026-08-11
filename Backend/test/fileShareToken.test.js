'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FileShareTokenError,
  createShareToken,
  hashShareToken,
} = require('../services/fileShareToken');

test('creates a 256-bit opaque token and deterministic hash without returning the raw token from the hash API', () => {
  const first = createShareToken();
  const second = createShareToken();

  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.token, second.token);
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(first.tokenHash, hashShareToken(first.token));
});

test('rejects malformed public share tokens', () => {
  assert.throws(() => hashShareToken('not a token'), FileShareTokenError);
  assert.throws(() => hashShareToken('a'.repeat(42)), FileShareTokenError);
});
