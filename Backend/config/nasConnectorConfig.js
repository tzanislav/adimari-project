'use strict';

const { MAX_S3_MULTIPART_OBJECT_BYTES, normalizeManagedPrefix } = require('../services/fileStorageValidation');
const { createFileServerConfig } = require('./fileServerConfig');

const MAX_PRESIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

class NasConnectorConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NasConnectorConfigurationError';
    this.code = 'NAS_CONNECTOR_CONFIGURATION_ERROR';
  }
}

const requiredString = (environment, key) => {
  const value = environment[key];
  if (typeof value !== 'string' || !value.trim() || /^<.*>$/.test(value.trim())) {
    throw new NasConnectorConfigurationError(`Missing required environment variable: ${key}`);
  }
  return value.trim();
};

const optionalString = (environment, key) => {
  const value = environment[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const requiredInteger = (environment, key, { min, max }) => {
  const value = Number(requiredString(environment, key));
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new NasConnectorConfigurationError(`${key} must be an integer between ${min} and ${max}.`);
  }
  return value;
};

const optionalInteger = (environment, key, { min, max, defaultValue }) => {
  const raw = optionalString(environment, key);
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new NasConnectorConfigurationError(`${key} must be an integer between ${min} and ${max}.`);
  }
  return value;
};

const requiredSecret = (environment, key) => {
  const value = requiredString(environment, key);
  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new NasConnectorConfigurationError(`${key} must be at least 32 bytes long.`);
  }
  return value;
};

const validateBucketName = (value) => {
  if (!/^(?!\d+\.\d+\.\d+\.\d+$)(?!xn--)[a-z0-9](?:[a-z0-9.-]{1,61})[a-z0-9]$/.test(value)
    || value.includes('..')) {
    throw new NasConnectorConfigurationError('NAS_CONNECTOR_BUCKET_NAME must be a valid DNS-compatible S3 bucket name.');
  }
  return value;
};

const validatePrefix = (environment, key) => {
  try {
    return normalizeManagedPrefix(requiredString(environment, key));
  } catch {
    throw new NasConnectorConfigurationError(`${key} must contain safe path segments.`);
  }
};

const prefixesOverlap = (left, right) => left.startsWith(right) || right.startsWith(left);

const isNasConnectorEnabled = (environment = process.env) => environment.NAS_CONNECTOR_ENABLED === 'true';

const createNasConnectorConfig = (environment = process.env) => {
  const fileServerConfig = createFileServerConfig(environment);
  const accessKeyId = optionalString(environment, 'NAS_CONNECTOR_AWS_ACCESS_KEY_ID');
  const secretAccessKey = optionalString(environment, 'NAS_CONNECTOR_AWS_SECRET_ACCESS_KEY');

  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new NasConnectorConfigurationError(
      'NAS_CONNECTOR_AWS_ACCESS_KEY_ID and NAS_CONNECTOR_AWS_SECRET_ACCESS_KEY must be set together, or both omitted for IAM-role credentials.',
    );
  }

  const heartbeatIntervalSeconds = requiredInteger(environment, 'NAS_CONNECTOR_HEARTBEAT_INTERVAL_SECONDS', {
    min: 5,
    max: 60 * 60,
  });
  // Allow an explicit policy, but never classify a connector as offline after
  // only one missed scheduled heartbeat. The default remains three intervals.
  const heartbeatStaleAfterSeconds = optionalInteger(environment, 'NAS_CONNECTOR_HEARTBEAT_STALE_AFTER_SECONDS', {
    min: heartbeatIntervalSeconds * 2,
    max: 7 * 24 * 60 * 60,
    defaultValue: heartbeatIntervalSeconds * 3,
  });

  const config = {
    region: requiredString(environment, 'NAS_CONNECTOR_AWS_REGION'),
    bucketName: validateBucketName(requiredString(environment, 'NAS_CONNECTOR_BUCKET_NAME')),
    cachePrefix: validatePrefix(environment, 'NAS_CONNECTOR_CACHE_S3_PREFIX'),
    uploadStagingPrefix: validatePrefix(environment, 'NAS_CONNECTOR_UPLOAD_STAGING_S3_PREFIX'),
    thumbnailPrefix: validatePrefix(environment, 'NAS_CONNECTOR_THUMBNAIL_S3_PREFIX'),
    cacheRetentionDays: requiredInteger(environment, 'NAS_CONNECTOR_CACHE_RETENTION_DAYS', { min: 1, max: 3_650 }),
    thumbnailMaxDimension: requiredInteger(environment, 'NAS_CONNECTOR_THUMBNAIL_MAX_DIMENSION', { min: 64, max: 2_048 }),
    maxUploadBytes: requiredInteger(environment, 'NAS_CONNECTOR_MAX_UPLOAD_BYTES', { min: 1, max: MAX_S3_MULTIPART_OBJECT_BYTES }),
    browserUploadUrlTtlSeconds: requiredInteger(environment, 'NAS_CONNECTOR_BROWSER_UPLOAD_URL_TTL_SECONDS', {
      min: 1,
      max: MAX_PRESIGNED_URL_TTL_SECONDS,
    }),
    connectorTransferUrlTtlSeconds: requiredInteger(environment, 'NAS_CONNECTOR_TRANSFER_URL_TTL_SECONDS', {
      min: 1,
      max: MAX_PRESIGNED_URL_TTL_SECONDS,
    }),
    authHmacSecret: requiredSecret(environment, 'NAS_CONNECTOR_AUTH_HMAC_SECRET'),
    enrollmentTokenTtlSeconds: requiredInteger(environment, 'NAS_CONNECTOR_ENROLLMENT_TOKEN_TTL_SECONDS', {
      min: 60,
      max: 24 * 60 * 60,
    }),
    // A consumed token is retained briefly only to let the same Service recover
    // after a lost 2xx response. This never extends the token's redemption
    // deadline, which remains enrollmentTokenTtlSeconds.
    enrollmentRecoveryTtlSeconds: optionalInteger(environment, 'NAS_CONNECTOR_ENROLLMENT_RECOVERY_TTL_SECONDS', {
      min: 60,
      max: 7 * 24 * 60 * 60,
      defaultValue: 60 * 60,
    }),
    heartbeatIntervalSeconds,
    heartbeatStaleAfterSeconds,
    // This channel supplements, but never replaces, the REST heartbeat. Keep
    // it independently configurable so operators can tune persistent-socket
    // liveness without changing the authoritative REST cadence.
    controlPingIntervalSeconds: optionalInteger(environment, 'NAS_CONNECTOR_CONTROL_PING_INTERVAL_SECONDS', {
      min: 5,
      max: 60 * 60,
      defaultValue: heartbeatIntervalSeconds,
    }),
    // Defense in depth for HTTP upgrades. Nginx must enforce a stricter
    // public-edge limit as well because it can reject before Node allocates a
    // WebSocket or touches MongoDB.
    controlUpgradeRateLimitPerMinute: optionalInteger(environment, 'NAS_CONNECTOR_CONTROL_UPGRADE_RATE_LIMIT_PER_MINUTE', {
      min: 1,
      max: 1_000,
      defaultValue: 30,
    }),
  };

  if (config.region !== fileServerConfig.region || config.bucketName !== fileServerConfig.bucketName) {
    throw new NasConnectorConfigurationError(
      'NAS connector storage must reuse the configured File Server bucket and region.',
    );
  }

  const prefixes = [fileServerConfig.prefix, config.cachePrefix, config.uploadStagingPrefix, config.thumbnailPrefix];
  if (prefixes.some((prefix, index) => prefixes.slice(index + 1).some((other) => prefixesOverlap(prefix, other)))) {
    throw new NasConnectorConfigurationError(
      'File Server, NAS cache, NAS upload-staging, and NAS thumbnail prefixes must not overlap.',
    );
  }

  if (accessKeyId) {
    config.credentials = { accessKeyId, secretAccessKey };
  }

  return Object.freeze(config);
};

module.exports = {
  MAX_PRESIGNED_URL_TTL_SECONDS,
  NasConnectorConfigurationError,
  createNasConnectorConfig,
  getNasConnectorConfig: () => createNasConnectorConfig(process.env),
  isNasConnectorEnabled,
};
