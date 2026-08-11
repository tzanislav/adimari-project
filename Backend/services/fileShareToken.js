'use strict';

const crypto = require('crypto');

const SHARE_TOKEN_BYTES = 32;
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

class FileShareTokenError extends Error {
  constructor(message = 'Share token is invalid.') {
    super(message);
    this.name = 'FileShareTokenError';
    this.code = 'FILE_SHARE_TOKEN_INVALID';
  }
}

const normalizeShareToken = (value) => {
  if (typeof value !== 'string' || !SHARE_TOKEN_PATTERN.test(value)) {
    throw new FileShareTokenError();
  }

  return value;
};

const hashShareToken = (token) => crypto
  .createHash('sha256')
  .update(normalizeShareToken(token), 'utf8')
  .digest('hex');

const createShareToken = () => {
  const token = crypto.randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashShareToken(token) };
};

module.exports = {
  FileShareTokenError,
  SHARE_TOKEN_BYTES,
  createShareToken,
  hashShareToken,
  normalizeShareToken,
};
