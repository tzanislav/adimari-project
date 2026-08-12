'use strict';

const crypto = require('crypto');

const ENROLLMENT_TOKEN_BYTES = 32;
const DEVICE_SECRET_BYTES = 32;
const ENROLLMENT_TOKEN_PREFIX = 'nce1_';
const BASE64URL_256_BIT_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ENROLLMENT_TOKEN_PATTERN = new RegExp(`^${ENROLLMENT_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`);

class NasConnectorSecretError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NasConnectorSecretError';
    this.code = 'NAS_CONNECTOR_SECRET_INVALID';
  }
}

const assertHmacSecret = (value) => {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 32) {
    throw new NasConnectorSecretError('NAS connector authentication secret is not configured.');
  }
  return value;
};

const normalizeEnrollmentToken = (value) => {
  if (typeof value !== 'string' || !ENROLLMENT_TOKEN_PATTERN.test(value)) {
    throw new NasConnectorSecretError('Enrollment token is invalid.');
  }
  return value;
};

const normalizeDeviceSecret = (value) => {
  if (typeof value !== 'string' || !BASE64URL_256_BIT_PATTERN.test(value)) {
    throw new NasConnectorSecretError('Connector device secret is invalid.');
  }
  return value;
};

// The intentionally simple connector mode uses one manually distributed
// 256-bit base64url key. Keeping the same compact alphabet as the previous
// device secret makes it safe to carry in a standard Authorization header.
const normalizeSharedSecret = (value) => {
  if (typeof value !== 'string' || !BASE64URL_256_BIT_PATTERN.test(value)) {
    throw new NasConnectorSecretError('Connector shared access key is invalid.');
  }
  return value;
};

const hashSecret = ({ value, purpose, hmacSecret }) => crypto
  .createHmac('sha256', assertHmacSecret(hmacSecret))
  .update(`${purpose}\u0000${value}`, 'utf8')
  .digest('hex');

const hashEnrollmentToken = (token, hmacSecret) => hashSecret({
  value: normalizeEnrollmentToken(token),
  purpose: 'nas-connector-enrollment-token:v1',
  hmacSecret,
});

const hashDeviceSecret = (deviceSecret, hmacSecret) => hashSecret({
  value: normalizeDeviceSecret(deviceSecret),
  purpose: 'nas-connector-device-secret:v1',
  hmacSecret,
});

const createEnrollmentToken = (hmacSecret) => {
  assertHmacSecret(hmacSecret);
  const token = `${ENROLLMENT_TOKEN_PREFIX}${crypto.randomBytes(ENROLLMENT_TOKEN_BYTES).toString('base64url')}`;
  return { token, tokenHash: hashEnrollmentToken(token, hmacSecret) };
};

const createDeviceSecret = () => crypto.randomBytes(DEVICE_SECRET_BYTES).toString('base64url');

const safelyCompareHashes = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length
    && leftBuffer.length > 0
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
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

const verifyDeviceSecret = ({ deviceSecret, expectedHash, hmacSecret }) => {
  try {
    return safelyCompareHashes(expectedHash, hashDeviceSecret(deviceSecret, hmacSecret));
  } catch (error) {
    if (error instanceof NasConnectorSecretError) return false;
    throw error;
  }
};

module.exports = {
  BASE64URL_256_BIT_PATTERN,
  DEVICE_SECRET_BYTES,
  ENROLLMENT_TOKEN_BYTES,
  ENROLLMENT_TOKEN_PREFIX,
  NasConnectorSecretError,
  assertHmacSecret,
  createDeviceSecret,
  createEnrollmentToken,
  hashDeviceSecret,
  hashEnrollmentToken,
  normalizeDeviceSecret,
  normalizeEnrollmentToken,
  normalizeSharedSecret,
  safelyCompareHashes,
  safelyCompareSecrets,
  verifyDeviceSecret,
  verifySharedSecret,
};
