'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  NasConnectorConfigurationError,
  createNasConnectorConfig,
  isNasConnectorEnabled,
} = require('../config/nasConnectorConfig');

const createEnvironment = (overrides = {}) => ({
  FILE_SERVER_AWS_ACCESS_KEY_ID: 'AKIAFILES',
  FILE_SERVER_AWS_SECRET_ACCESS_KEY: 'file-server-secret',
  FILE_SERVER_AWS_REGION: 'eu-west-1',
  FILE_SERVER_BUCKET_NAME: 'adimari-private-files-prod',
  FILE_SERVER_S3_PREFIX: 'files/',
  FILE_SERVER_PUBLIC_BASE_URL: 'https://app.example.com',
  FILE_SERVER_MAX_UPLOAD_BYTES: '50000000000000',
  FILE_SERVER_MULTIPART_PART_SIZE_BYTES: '67108864',
  FILE_SERVER_UPLOAD_PART_URL_TTL_SECONDS: '900',
  FILE_SERVER_DOWNLOAD_URL_TTL_SECONDS: '300',
  NAS_CONNECTOR_ENABLED: 'true',
  NAS_CONNECTOR_AWS_ACCESS_KEY_ID: 'AKIANAS',
  NAS_CONNECTOR_AWS_SECRET_ACCESS_KEY: 'nas-connector-secret',
  NAS_CONNECTOR_AWS_REGION: 'eu-west-1',
  NAS_CONNECTOR_BUCKET_NAME: 'adimari-private-files-prod',
  NAS_CONNECTOR_CACHE_S3_PREFIX: 'nas-cache/',
  NAS_CONNECTOR_UPLOAD_STAGING_S3_PREFIX: 'nas-upload-staging/',
  NAS_CONNECTOR_THUMBNAIL_S3_PREFIX: 'nas-thumbnails/',
  NAS_CONNECTOR_CACHE_RETENTION_DAYS: '10',
  NAS_CONNECTOR_THUMBNAIL_MAX_DIMENSION: '320',
  NAS_CONNECTOR_MAX_UPLOAD_BYTES: '50000000000000',
  NAS_CONNECTOR_BROWSER_UPLOAD_URL_TTL_SECONDS: '900',
  NAS_CONNECTOR_TRANSFER_URL_TTL_SECONDS: '3600',
  NAS_CONNECTOR_AUTH_HMAC_SECRET: 'this-is-a-long-test-only-connector-hmac-secret',
  NAS_CONNECTOR_SHARED_SECRET: 'Z2VuZXJhdGVkLWRldmljZS1zZWNyZXQtMzItYnl0ZXM',
  NAS_CONNECTOR_ENROLLMENT_TOKEN_TTL_SECONDS: '900',
  NAS_CONNECTOR_HEARTBEAT_INTERVAL_SECONDS: '30',
  ...overrides,
});

test('creates NAS configuration in the existing File Server bucket with isolated prefixes', () => {
  const config = createNasConnectorConfig(createEnvironment());

  assert.equal(config.bucketName, 'adimari-private-files-prod');
  assert.equal(config.cachePrefix, 'nas-cache/');
  assert.equal(config.uploadStagingPrefix, 'nas-upload-staging/');
  assert.equal(config.thumbnailPrefix, 'nas-thumbnails/');
  assert.equal(config.cacheRetentionDays, 10);
  assert.equal(config.thumbnailMaxDimension, 320);
  assert.equal(config.enrollmentTokenTtlSeconds, 900);
  assert.equal(config.sharedSecret, 'Z2VuZXJhdGVkLWRldmljZS1zZWNyZXQtMzItYnl0ZXM');
  assert.equal(config.enrollmentRecoveryTtlSeconds, 3_600);
  assert.equal(config.heartbeatIntervalSeconds, 30);
  assert.equal(config.heartbeatStaleAfterSeconds, 90);
  assert.equal(config.controlPingIntervalSeconds, 30);
  assert.equal(config.controlUpgradeRateLimitPerMinute, 30);
  assert.equal(config.jobLeaseSeconds, 90);
  assert.equal(config.allowInsecureHttp, false);
  assert.deepEqual(config.credentials, {
    accessKeyId: 'AKIANAS',
    secretAccessKey: 'nas-connector-secret',
  });
});

test('allows IAM-role credentials when both NAS credential variables are omitted', () => {
  const config = createNasConnectorConfig(createEnvironment({
    NAS_CONNECTOR_AWS_ACCESS_KEY_ID: '',
    NAS_CONNECTOR_AWS_SECRET_ACCESS_KEY: '',
  }));

  assert.equal(config.credentials, undefined);
});

test('rejects a bucket/region mismatch and any overlapping prefix', () => {
  assert.throws(
    () => createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_BUCKET_NAME: 'other-private-bucket' })),
    NasConnectorConfigurationError,
  );
  assert.throws(
    () => createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_CACHE_S3_PREFIX: 'files/cache/' })),
    NasConnectorConfigurationError,
  );
  assert.throws(
    () => createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_UPLOAD_STAGING_S3_PREFIX: 'nas-cache/' })),
    NasConnectorConfigurationError,
  );
  assert.throws(
    () => createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_THUMBNAIL_S3_PREFIX: 'nas-cache/thumbnails/' })),
    NasConnectorConfigurationError,
  );
});

test('enables NAS startup validation only for the exact true flag', () => {
  assert.equal(isNasConnectorEnabled(createEnvironment()), true);
  assert.equal(isNasConnectorEnabled(createEnvironment({ NAS_CONNECTOR_ENABLED: 'false' })), false);
  assert.equal(isNasConnectorEnabled(createEnvironment({ NAS_CONNECTOR_ENABLED: 'TRUE' })), false);
});

test('requires a backend-only HMAC secret when the NAS connector is enabled', () => {
  assert.throws(
    () => createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_AUTH_HMAC_SECRET: 'too-short' })),
    NasConnectorConfigurationError,
  );
});

test('requires a 32-byte base64url shared connector key', () => {
  assert.throws(
    () => createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_SHARED_SECRET: 'too-short' })),
    NasConnectorConfigurationError,
  );
});

test('does not require legacy enrollment-token settings for the shared-key connector', () => {
  const config = createNasConnectorConfig(createEnvironment({
    NAS_CONNECTOR_ENROLLMENT_TOKEN_TTL_SECONDS: undefined,
    NAS_CONNECTOR_ENROLLMENT_RECOVERY_TTL_SECONDS: undefined,
  }));
  assert.equal(config.enrollmentTokenTtlSeconds, 900);
  assert.equal(config.enrollmentRecoveryTtlSeconds, 3_600);
});

test('uses a bounded enrollment recovery window without extending token redemption', () => {
  assert.equal(
    createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_ENROLLMENT_RECOVERY_TTL_SECONDS: '120' }))
      .enrollmentRecoveryTtlSeconds,
    120,
  );
  assert.throws(
    () => createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_ENROLLMENT_RECOVERY_TTL_SECONDS: '30' })),
    NasConnectorConfigurationError,
  );
});

test('defaults stale heartbeat detection to three intervals and validates an explicit policy', () => {
  assert.equal(
    createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_HEARTBEAT_STALE_AFTER_SECONDS: '120' }))
      .heartbeatStaleAfterSeconds,
    120,
  );
  assert.throws(
    () => createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_HEARTBEAT_STALE_AFTER_SECONDS: '59' })),
    NasConnectorConfigurationError,
  );
  assert.throws(
    () => createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_HEARTBEAT_STALE_AFTER_SECONDS: 'not-a-number' })),
    NasConnectorConfigurationError,
  );
});

test('uses bounded control-channel ping and upgrade limits', () => {
  const config = createNasConnectorConfig(createEnvironment({
    NAS_CONNECTOR_CONTROL_PING_INTERVAL_SECONDS: '45',
    NAS_CONNECTOR_CONTROL_UPGRADE_RATE_LIMIT_PER_MINUTE: '12',
  }));
  assert.equal(config.controlPingIntervalSeconds, 45);
  assert.equal(config.controlUpgradeRateLimitPerMinute, 12);
  assert.throws(
    () => createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_CONTROL_PING_INTERVAL_SECONDS: '4' })),
    NasConnectorConfigurationError,
  );
  assert.throws(
    () => createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_CONTROL_UPGRADE_RATE_LIMIT_PER_MINUTE: '0' })),
    NasConnectorConfigurationError,
  );
});

test('uses a short bounded lease for durable connector job delivery', () => {
  assert.equal(
    createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_JOB_LEASE_SECONDS: '45' })).jobLeaseSeconds,
    45,
  );
  assert.throws(
    () => createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_JOB_LEASE_SECONDS: '14' })),
    NasConnectorConfigurationError,
  );
});

test('allows an explicit HTTP transport setting for a private/local connector deployment', () => {
  assert.equal(
    createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_ALLOW_HTTP: 'true' })).allowInsecureHttp,
    true,
  );
  assert.throws(
    () => createNasConnectorConfig(createEnvironment({ NAS_CONNECTOR_ALLOW_HTTP: 'yes' })),
    NasConnectorConfigurationError,
  );
});
