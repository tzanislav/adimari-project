'use strict';

class MongoDbAtlasCostConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MongoDbAtlasCostConfigurationError';
  }
}

const readValue = (value) => (typeof value === 'string' ? value.trim() : '');

const parseCacheTtlSeconds = (value) => {
  if (!value) return 300;

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 30 || parsedValue > 3600) {
    throw new MongoDbAtlasCostConfigurationError(
      'MONGODB_ATLAS_COSTS_CACHE_TTL_SECONDS must be an integer between 30 and 3600.'
    );
  }

  return parsedValue;
};

const createMongoDbAtlasCostConfig = (env = process.env) => {
  const enabled = readValue(env.MONGODB_ATLAS_COSTS_ENABLED).toLowerCase() === 'true';
  if (!enabled) return { enabled: false };

  const organizationId = readValue(env.MONGODB_ATLAS_ORG_ID);
  const clientId = readValue(env.MONGODB_ATLAS_CLIENT_ID);
  const clientSecret = readValue(env.MONGODB_ATLAS_CLIENT_SECRET);

  if (!/^[a-f\d]{24}$/i.test(organizationId)) {
    throw new MongoDbAtlasCostConfigurationError('MONGODB_ATLAS_ORG_ID must be a 24-character Atlas organization ID.');
  }

  if (!clientId || !clientSecret) {
    throw new MongoDbAtlasCostConfigurationError(
      'MONGODB_ATLAS_CLIENT_ID and MONGODB_ATLAS_CLIENT_SECRET are required when Atlas cost reporting is enabled.'
    );
  }

  return {
    enabled: true,
    organizationId,
    clientId,
    clientSecret,
    cacheTtlMs: parseCacheTtlSeconds(readValue(env.MONGODB_ATLAS_COSTS_CACHE_TTL_SECONDS)) * 1000,
  };
};

module.exports = {
  MongoDbAtlasCostConfigurationError,
  createMongoDbAtlasCostConfig,
};
