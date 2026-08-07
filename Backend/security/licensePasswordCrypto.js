'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const DEFAULT_KEY_ID = 'v1';
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

let configuredCrypto;

const configurationError = () => {
  const error = new Error('License password encryption is not configured correctly.');
  error.code = 'LICENSE_ENCRYPTION_CONFIGURATION_ERROR';
  return error;
};

const decryptionError = () => {
  const error = new Error('Unable to decrypt the license password.');
  error.code = 'LICENSE_PASSWORD_DECRYPTION_ERROR';
  return error;
};

const decodeBase64 = (value, { allowEmpty = false, errorFactory = configurationError } = {}) => {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw errorFactory();
  }

  if (value.length > 0 && !BASE64_PATTERN.test(value)) {
    throw errorFactory();
  }

  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) {
    throw errorFactory();
  }

  return decoded;
};

const readKeyId = (keyId) => {
  if (typeof keyId !== 'string' || keyId.trim().length === 0 || keyId.length > 64) {
    throw configurationError();
  }

  return keyId;
};

const createLicensePasswordCrypto = ({ keyBase64, keyId = DEFAULT_KEY_ID } = {}) => {
  const key = decodeBase64(keyBase64);
  if (key.length !== KEY_BYTES) {
    throw configurationError();
  }

  const configuredKeyId = readKeyId(keyId);

  const encrypt = (password) => {
    if (typeof password !== 'string') {
      throw new TypeError('License password must be a string.');
    }

    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      version: ENCRYPTION_VERSION,
      algorithm: ALGORITHM,
      keyId: configuredKeyId,
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      authTag: authTag.toString('base64'),
    };
  };

  const decrypt = (encryptedPassword) => {
    if (!encryptedPassword || typeof encryptedPassword !== 'object'
      || encryptedPassword.version !== ENCRYPTION_VERSION
      || encryptedPassword.algorithm !== ALGORITHM
      || encryptedPassword.keyId !== configuredKeyId) {
      throw decryptionError();
    }

    try {
      const iv = decodeBase64(encryptedPassword.iv, { errorFactory: decryptionError });
      const ciphertext = decodeBase64(encryptedPassword.ciphertext, {
        allowEmpty: true,
        errorFactory: decryptionError,
      });
      const authTag = decodeBase64(encryptedPassword.authTag, { errorFactory: decryptionError });

      if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
        throw decryptionError();
      }

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch (error) {
      if (error && error.code === 'LICENSE_PASSWORD_DECRYPTION_ERROR') {
        throw error;
      }
      throw decryptionError();
    }
  };

  return Object.freeze({
    encrypt,
    decrypt,
    keyId: configuredKeyId,
  });
};

const createLicensePasswordCryptoFromEnvironment = (environment = process.env) => (
  createLicensePasswordCrypto({
    keyBase64: environment.LICENSE_ENCRYPTION_KEY_V1,
    keyId: environment.LICENSE_ENCRYPTION_KEY_ID === undefined
      ? DEFAULT_KEY_ID
      : environment.LICENSE_ENCRYPTION_KEY_ID,
  })
);

const getLicensePasswordCrypto = () => {
  if (!configuredCrypto) {
    configuredCrypto = createLicensePasswordCryptoFromEnvironment();
  }

  return configuredCrypto;
};

module.exports = {
  ALGORITHM,
  ENCRYPTION_VERSION,
  createLicensePasswordCrypto,
  createLicensePasswordCryptoFromEnvironment,
  getLicensePasswordCrypto,
};
