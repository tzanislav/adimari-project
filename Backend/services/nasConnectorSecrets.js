'use strict';

const crypto = require('crypto');

const BASE64URL_256_BIT_PATTERN = /^[A-Za-z0-9_-]{43}$/;

class NasConnectorSecretError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NasConnectorSecretError';
    this.code = 'NAS_CONNECTOR_SECRET_INVALID';
  }
}

const normalizeSharedSecret = (value) => {
  if (typeof value !== 'string' || !BASE64URL_256_BIT_PATTERN.test(value)) {
    throw new NasConnectorSecretError('Connector shared access key is invalid.');
  }
  return value;
};

const safelyCompareSecrets = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length
    && leftBuffer.length > 0
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const verifySharedSecret = ({ sharedSecret, expectedSecret }) => {
  try {
    return safelyCompareSecrets(normalizeSharedSecret(sharedSecret), normalizeSharedSecret(expectedSecret));
  } catch (error) {
    if (error instanceof NasConnectorSecretError) return false;
    throw error;
  }
};

module.exports = {
  BASE64URL_256_BIT_PATTERN,
  NasConnectorSecretError,
  normalizeSharedSecret,
  safelyCompareSecrets,
  verifySharedSecret,
};
