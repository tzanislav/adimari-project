'use strict';

const {
  MAX_S3_MULTIPART_OBJECT_BYTES,
  MAX_S3_MULTIPART_PART_BYTES,
  MIN_S3_MULTIPART_PART_BYTES,
  normalizeManagedPrefix,
} = require('../services/fileStorageValidation');

const MAX_PRESIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

class FileServerConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FileServerConfigurationError';
    this.code = 'FILE_SERVER_CONFIGURATION_ERROR';
  }
}

const requiredString = (environment, key) => {
  const value = environment[key];
  if (typeof value !== 'string' || !value.trim() || /^<.*>$/.test(value.trim())) {
    throw new FileServerConfigurationError(`Missing required environment variable: ${key}`);
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
    throw new FileServerConfigurationError(`${key} must be an integer between ${min} and ${max}.`);
  }

  return value;
};

const normalizePublicBaseUrl = (value) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new FileServerConfigurationError('FILE_SERVER_PUBLIC_BASE_URL must be a valid HTTP(S) origin.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || parsed.username
    || parsed.password) {
    throw new FileServerConfigurationError('FILE_SERVER_PUBLIC_BASE_URL must contain only an HTTP(S) origin.');
  }

  return parsed.origin;
};

const validateBucketName = (value) => {
  if (!/^(?!\d+\.\d+\.\d+\.\d+$)(?!xn--)[a-z0-9](?:[a-z0-9.-]{1,61})[a-z0-9]$/.test(value)
    || value.includes('..')) {
    throw new FileServerConfigurationError('FILE_SERVER_BUCKET_NAME must be a valid DNS-compatible S3 bucket name.');
  }

  return value;
};

const validateManagedPrefix = (value) => {
  try {
    return normalizeManagedPrefix(value);
  } catch {
    throw new FileServerConfigurationError('FILE_SERVER_S3_PREFIX must contain safe path segments.');
  }
};

const createFileServerConfig = (environment = process.env) => {
  const accessKeyId = optionalString(environment, 'FILE_SERVER_AWS_ACCESS_KEY_ID');
  const secretAccessKey = optionalString(environment, 'FILE_SERVER_AWS_SECRET_ACCESS_KEY');

  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new FileServerConfigurationError(
      'FILE_SERVER_AWS_ACCESS_KEY_ID and FILE_SERVER_AWS_SECRET_ACCESS_KEY must be set together, or both omitted for IAM-role credentials.',
    );
  }

  const config = {
    region: requiredString(environment, 'FILE_SERVER_AWS_REGION'),
    bucketName: validateBucketName(requiredString(environment, 'FILE_SERVER_BUCKET_NAME')),
    prefix: validateManagedPrefix(requiredString(environment, 'FILE_SERVER_S3_PREFIX')),
    publicBaseUrl: normalizePublicBaseUrl(requiredString(environment, 'FILE_SERVER_PUBLIC_BASE_URL')),
    maxUploadBytes: requiredInteger(environment, 'FILE_SERVER_MAX_UPLOAD_BYTES', {
      min: 1,
      max: MAX_S3_MULTIPART_OBJECT_BYTES,
    }),
    multipartPartSizeBytes: requiredInteger(environment, 'FILE_SERVER_MULTIPART_PART_SIZE_BYTES', {
      min: MIN_S3_MULTIPART_PART_BYTES,
      max: MAX_S3_MULTIPART_PART_BYTES,
    }),
    uploadPartUrlTtlSeconds: requiredInteger(environment, 'FILE_SERVER_UPLOAD_PART_URL_TTL_SECONDS', {
      min: 1,
      max: MAX_PRESIGNED_URL_TTL_SECONDS,
    }),
    downloadUrlTtlSeconds: requiredInteger(environment, 'FILE_SERVER_DOWNLOAD_URL_TTL_SECONDS', {
      min: 1,
      max: MAX_PRESIGNED_URL_TTL_SECONDS,
    }),
  };

  if (accessKeyId) {
    config.credentials = { accessKeyId, secretAccessKey };
  }

  return Object.freeze(config);
};

module.exports = {
  FileServerConfigurationError,
  MAX_PRESIGNED_URL_TTL_SECONDS,
  createFileServerConfig,
  getFileServerConfig: () => createFileServerConfig(process.env),
};
