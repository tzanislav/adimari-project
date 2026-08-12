'use strict';

class BackendNetworkConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackendNetworkConfigurationError';
    this.code = 'BACKEND_NETWORK_CONFIGURATION_ERROR';
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

// The Node process is an application server behind Nginx, not an internet
// listener. Keeping it on loopback makes the reverse proxy/firewall boundary
// unambiguous and protects against an accidental direct port exposure.
const getBackendBindHost = (environment = process.env) => {
  const host = String(environment.BACKEND_BIND_HOST || '127.0.0.1').trim().toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new BackendNetworkConfigurationError(
      'BACKEND_BIND_HOST must be a loopback address (127.0.0.1, ::1, or localhost).',
    );
  }
  return host;
};

module.exports = {
  BackendNetworkConfigurationError,
  getBackendBindHost,
};
