'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BackendNetworkConfigurationError,
  getBackendBindHost,
} = require('../config/backendNetworkConfig');

test('backend binds to IPv4 loopback by default and permits only loopback overrides', () => {
  assert.equal(getBackendBindHost({}), '127.0.0.1');
  assert.equal(getBackendBindHost({ BACKEND_BIND_HOST: 'localhost' }), 'localhost');
  assert.equal(getBackendBindHost({ BACKEND_BIND_HOST: '::1' }), '::1');
});

test('backend rejects LAN and wildcard bind hosts', () => {
  for (const host of ['0.0.0.0', '192.168.1.10', '10.0.0.5', '::']) {
    assert.throws(
      () => getBackendBindHost({ BACKEND_BIND_HOST: host }),
      BackendNetworkConfigurationError,
    );
  }
});
