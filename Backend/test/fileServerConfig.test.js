'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FileServerConfigurationError,
  createFileServerConfig,
} = require('../config/fileServerConfig');

const createEnvironment = (overrides = {}) => ({
  FILE_SERVER_AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  FILE_SERVER_AWS_SECRET_ACCESS_KEY: 'example-secret',
  FILE_SERVER_AWS_REGION: 'eu-west-1',
  FILE_SERVER_BUCKET_NAME: 'adimari-private-files-prod',
  FILE_SERVER_S3_PREFIX: 'files/',
  FILE_SERVER_PUBLIC_BASE_URL: 'https://adimari-db.com',
  FILE_SERVER_MAX_UPLOAD_BYTES: '50000000000000',
  FILE_SERVER_MULTIPART_PART_SIZE_BYTES: '67108864',
  FILE_SERVER_UPLOAD_PART_URL_TTL_SECONDS: '900',
  FILE_SERVER_DOWNLOAD_URL_TTL_SECONDS: '300',
  ...overrides,
});

test('creates isolated file-server configuration with dedicated IAM credentials', () => {
  const config = createFileServerConfig(createEnvironment());

  assert.equal(config.bucketName, 'adimari-private-files-prod');
  assert.equal(config.prefix, 'files/');
  assert.equal(config.publicBaseUrl, 'https://adimari-db.com');
  assert.deepEqual(config.credentials, {
    accessKeyId: 'AKIAEXAMPLE',
    secretAccessKey: 'example-secret',
  });
});

test('allows IAM-role credentials when both file-server access-key variables are omitted', () => {
  const config = createFileServerConfig(createEnvironment({
    FILE_SERVER_AWS_ACCESS_KEY_ID: '',
    FILE_SERVER_AWS_SECRET_ACCESS_KEY: '',
  }));

  assert.equal(config.credentials, undefined);
});

test('rejects partial credentials, unsafe prefixes, and non-origin public URLs', () => {
  assert.throws(
    () => createFileServerConfig(createEnvironment({ FILE_SERVER_AWS_SECRET_ACCESS_KEY: '' })),
    FileServerConfigurationError,
  );
  assert.throws(
    () => createFileServerConfig(createEnvironment({ FILE_SERVER_S3_PREFIX: '../files' })),
    FileServerConfigurationError,
  );
  assert.throws(
    () => createFileServerConfig(createEnvironment({ FILE_SERVER_PUBLIC_BASE_URL: 'https://adimari-db.com/download' })),
    FileServerConfigurationError,
  );
});
