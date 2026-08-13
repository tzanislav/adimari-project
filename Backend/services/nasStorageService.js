'use strict';

const { createFileStorageService } = require('./fileStorageService');

class NasStorageConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NasStorageConfigurationError';
  }
}

// NAS cache, thumbnail, and staging objects deliberately use the same bucket
// and credentials as File Server, but each keeps an isolated managed prefix.
// Keep that composition in one place so a future storage change cannot make
// one of the three paths behave differently.
const createNasStorageConfig = ({ nasConfig, fileServerConfig, prefix, overrides = {} } = {}) => {
  if (!nasConfig || !fileServerConfig || typeof prefix !== 'string' || !prefix) {
    throw new NasStorageConfigurationError('NAS and File Server storage configuration is required.');
  }

  return {
    ...fileServerConfig,
    region: nasConfig.region,
    bucketName: nasConfig.bucketName,
    prefix,
    credentials: nasConfig.credentials || fileServerConfig.credentials,
    ...overrides,
  };
};

const createNasStorageService = (options = {}) => createFileStorageService({
  config: createNasStorageConfig(options),
});

module.exports = {
  NasStorageConfigurationError,
  createNasStorageConfig,
  createNasStorageService,
};
