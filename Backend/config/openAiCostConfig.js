'use strict';

class OpenAiCostConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OpenAiCostConfigurationError';
  }
}

const readValue = (value) => (typeof value === 'string' ? value.trim() : '');

const parseCacheTtlSeconds = (value) => {
  if (!value) {
    return 300;
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue < 30 || parsedValue > 3600) {
    throw new OpenAiCostConfigurationError('OPENAI_COSTS_CACHE_TTL_SECONDS must be an integer between 30 and 3600.');
  }

  return parsedValue;
};

const createOpenAiCostConfig = (env = process.env) => {
  const enabled = readValue(env.OPENAI_COSTS_ENABLED).toLowerCase() === 'true';

  if (!enabled) {
    return { enabled: false };
  }

  const adminApiKey = readValue(env.OPENAI_ADMIN_KEY);

  if (!adminApiKey) {
    throw new OpenAiCostConfigurationError('OPENAI_ADMIN_KEY is required when OpenAI cost reporting is enabled.');
  }

  return {
    enabled: true,
    adminApiKey,
    cacheTtlMs: parseCacheTtlSeconds(readValue(env.OPENAI_COSTS_CACHE_TTL_SECONDS)) * 1000,
  };
};

module.exports = {
  OpenAiCostConfigurationError,
  createOpenAiCostConfig,
};
