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

const optionalBoolean = (environment, key, defaultValue = false) => {
  const raw = optionalString(environment, key);
  if (raw === undefined) return defaultValue;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new NasConnectorConfigurationError(`${key} must be true or false.`);
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

const requiredSharedSecret = (environment, key) => {
  const value = requiredString(environment, key);
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new NasConnectorConfigurationError(`${key} must be a 32-byte base64url key.`);
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
    // A small trusted deployment intentionally uses one manually distributed
    // connector key for every Connector request.
    sharedSecret: requiredSharedSecret(environment, 'NAS_CONNECTOR_SHARED_SECRET'),
    heartbeatIntervalSeconds,
    heartbeatStaleAfterSeconds,
    // A short DB-backed lease governs safe HTTPS-poll replay when an
    // acknowledgement is interrupted or a connector restarts.
    jobLeaseSeconds: optionalInteger(environment, 'NAS_CONNECTOR_JOB_LEASE_SECONDS', {
      min: 15,
      max: 600,
      defaultValue: 90,
    }),
    terminalJobRetentionDays: optionalInteger(environment, 'NAS_CONNECTOR_TERMINAL_JOB_RETENTION_DAYS', {
      min: 7,
      max: 3_650,
      defaultValue: 30,
    }),
    deletedEntryRetentionDays: optionalInteger(environment, 'NAS_CONNECTOR_DELETED_ENTRY_RETENTION_DAYS', {
      min: 7,
      max: 3_650,
      defaultValue: 30,
    }),
    auditRetentionDays: optionalInteger(environment, 'NAS_CONNECTOR_AUDIT_RETENTION_DAYS', {
      min: 30,
      max: 3_650,
      defaultValue: 365,
    }),
    staleThumbnailRetentionDays: optionalInteger(environment, 'NAS_CONNECTOR_STALE_THUMBNAIL_RETENTION_DAYS', {
      min: 1,
      max: 3_650,
      defaultValue: 14,
    }),
    retentionSweepIntervalHours: optionalInteger(environment, 'NAS_CONNECTOR_RETENTION_SWEEP_INTERVAL_HOURS', {
      min: 1,
      max: 24 * 7,
      defaultValue: 6,
    }),
    recoveryStuckAfterMinutes: optionalInteger(environment, 'NAS_CONNECTOR_RECOVERY_STUCK_AFTER_MINUTES', {
      min: 10,
      max: 7 * 24 * 60,
      defaultValue: 30,
    }),
    // HTTPS remains the normal deployment. This explicit switch exists for a
    // small trusted/local installation that deliberately prefers plain HTTP.
    allowInsecureHttp: optionalBoolean(environment, 'NAS_CONNECTOR_ALLOW_HTTP', false),
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
