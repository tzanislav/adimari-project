'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ALGORITHM,
  ENCRYPTION_VERSION,
  createLicensePasswordCrypto,
  createLicensePasswordCryptoFromEnvironment,
} = require('../security/licensePasswordCrypto');

const testKey = Buffer.alloc(32, 23).toString('base64');
const cryptoService = createLicensePasswordCrypto({ keyBase64: testKey, keyId: 'test-v1' });

test('encrypts and decrypts a license password with a versioned AES-256-GCM payload', () => {
  const encrypted = cryptoService.encrypt('correct horse battery staple');

  assert.deepEqual(Object.keys(encrypted).sort(), [
    'algorithm',
    'authTag',
    'ciphertext',
    'iv',
    'keyId',
    'version',
  ]);
  assert.equal(encrypted.version, ENCRYPTION_VERSION);
  assert.equal(encrypted.algorithm, ALGORITHM);
  assert.equal(encrypted.keyId, 'test-v1');
  assert.notEqual(encrypted.ciphertext, 'correct horse battery staple');
  assert.equal(cryptoService.decrypt(encrypted), 'correct horse battery staple');
});

test('uses a fresh IV so encrypting identical passwords produces different payloads', () => {
  const first = cryptoService.encrypt('same password');
  const second = cryptoService.encrypt('same password');

  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(cryptoService.decrypt(first), 'same password');
  assert.equal(cryptoService.decrypt(second), 'same password');
});

test('rejects missing, malformed, and incorrectly sized environment keys', () => {
  for (const keyBase64 of [undefined, '', 'not base64', Buffer.alloc(31).toString('base64')]) {
    assert.throws(
      () => createLicensePasswordCrypto({ keyBase64 }),
      { code: 'LICENSE_ENCRYPTION_CONFIGURATION_ERROR' },
    );
  }

  assert.throws(
    () => createLicensePasswordCryptoFromEnvironment({ LICENSE_ENCRYPTION_KEY_V1: testKey, LICENSE_ENCRYPTION_KEY_ID: '' }),
    { code: 'LICENSE_ENCRYPTION_CONFIGURATION_ERROR' },
  );
});

test('rejects tampered ciphertext and unsupported encryption versions', () => {
  const encrypted = cryptoService.encrypt('sensitive credential');
  const tamperedCiphertext = Buffer.from(encrypted.ciphertext, 'base64');
  tamperedCiphertext[0] ^= 1;

  assert.throws(
    () => cryptoService.decrypt({ ...encrypted, ciphertext: tamperedCiphertext.toString('base64') }),
    { code: 'LICENSE_PASSWORD_DECRYPTION_ERROR' },
  );
  assert.throws(
    () => cryptoService.decrypt({ ...encrypted, version: 999 }),
    { code: 'LICENSE_PASSWORD_DECRYPTION_ERROR' },
  );
  assert.throws(
    () => cryptoService.decrypt({ ...encrypted, keyId: 'unknown-key' }),
    { code: 'LICENSE_PASSWORD_DECRYPTION_ERROR' },
  );
});
