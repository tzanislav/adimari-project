'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  NasStorageConfigurationError,
  createNasStorageConfig,
} = require('../services/nasStorageService');

const fileServerConfig = {
  region: 'eu-west-1',
  bucketName: 'adimari-private-files-prod',
  prefix: 'files/',
  credentials: { accessKeyId: 'FILE_KEY', secretAccessKey: 'file-secret' },
  downloadUrlTtlSeconds: 300,
};

const nasConfig = {
  region: 'eu-west-1',
  bucketName: 'adimari-private-files-prod',
  cachePrefix: 'nas-cache/',
  credentials: { accessKeyId: 'NAS_KEY', secretAccessKey: 'nas-secret' },
};

test('creates every NAS storage configuration from the shared File Server baseline', () => {
  const config = createNasStorageConfig({
    nasConfig,
    fileServerConfig,
    prefix: nasConfig.cachePrefix,
    overrides: { uploadPartUrlTtlSeconds: 900 },
  });

  assert.deepEqual(config, {
    ...fileServerConfig,
    region: nasConfig.region,
    bucketName: nasConfig.bucketName,
    prefix: 'nas-cache/',
    credentials: nasConfig.credentials,
    uploadPartUrlTtlSeconds: 900,
  });
});

test('falls back to File Server credentials for NAS storage when using an IAM role', () => {
  const config = createNasStorageConfig({
    nasConfig: { ...nasConfig, credentials: undefined },
    fileServerConfig,
    prefix: 'nas-thumbnails/',
  });

  assert.equal(config.prefix, 'nas-thumbnails/');
  assert.equal(config.credentials, fileServerConfig.credentials);
});

test('requires the complete trusted NAS and File Server configuration', () => {
  assert.throws(
    () => createNasStorageConfig({ nasConfig, fileServerConfig, prefix: '' }),
    NasStorageConfigurationError,
  );
});
