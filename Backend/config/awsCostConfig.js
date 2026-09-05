'use strict';

class AwsCostConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AwsCostConfigurationError';
  }
}

const readValue = (value) => (typeof value === 'string' ? value.trim() : '');

const parseCacheTtlSeconds = (value) => {
  if (!value) {
    return 300;
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 30 || parsedValue > 3600) {
    throw new AwsCostConfigurationError('AWS_COSTS_CACHE_TTL_SECONDS must be an integer between 30 and 3600.');
  }

  return parsedValue;
};

const createAwsCostConfig = (env = process.env) => {
  const enabled = readValue(env.AWS_COSTS_ENABLED).toLowerCase() === 'true';

  if (!enabled) {
    return { enabled: false };
  }

  const accessKeyId = readValue(env.AWS_COSTS_AWS_ACCESS_KEY_ID);
  const secretAccessKey = readValue(env.AWS_COSTS_AWS_SECRET_ACCESS_KEY);

  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new AwsCostConfigurationError(
      'Set both AWS_COSTS_AWS_ACCESS_KEY_ID and AWS_COSTS_AWS_SECRET_ACCESS_KEY, or neither when using an IAM role.'
    );
  }

  return {
    enabled: true,
    // Cost Explorer has a single, global endpoint in us-east-1.
    region: 'us-east-1',
    cacheTtlMs: parseCacheTtlSeconds(readValue(env.AWS_COSTS_CACHE_TTL_SECONDS)) * 1000,
    credentials: accessKeyId
      ? { accessKeyId, secretAccessKey }
      : undefined,
  };
};

module.exports = {
  AwsCostConfigurationError,
  createAwsCostConfig,
};
