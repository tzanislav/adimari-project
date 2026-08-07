'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const LicenseEntry = require('../models/LicenseEntry');

test('license schema has no plaintext password field and hides encrypted data by default', () => {
  assert.equal(LicenseEntry.schema.path('password'), undefined);
  assert.equal(LicenseEntry.schema.path('passwordEncrypted').options.required, true);
  assert.equal(LicenseEntry.schema.path('passwordEncrypted').options.select, false);
});

test('license schema accepts the versioned encrypted-password payload used by the crypto module', () => {
  const license = new LicenseEntry({
    user: 'license-user',
    platform: 'Example platform',
    clearances: 'moderator',
    passwordEncrypted: {
      version: 1,
      algorithm: 'aes-256-gcm',
      keyId: 'v1',
      iv: Buffer.alloc(12).toString('base64'),
      ciphertext: Buffer.from('ciphertext').toString('base64'),
      authTag: Buffer.alloc(16).toString('base64'),
    },
  });

  assert.equal(license.validateSync(), undefined);
});

test('license schema rejects new records without encrypted password data', () => {
  const license = new LicenseEntry({
    user: 'license-user',
    platform: 'Example platform',
    clearances: 'moderator',
  });

  assert.equal(license.validateSync().errors.passwordEncrypted.kind, 'required');
});

test('license schema rejects the retired private clearance value', () => {
  const license = new LicenseEntry({
    user: 'license-user',
    platform: 'Example platform',
    clearances: 'private',
    passwordEncrypted: {
      version: 1,
      algorithm: 'aes-256-gcm',
      keyId: 'v1',
      iv: Buffer.alloc(12).toString('base64'),
      ciphertext: Buffer.from('ciphertext').toString('base64'),
      authTag: Buffer.alloc(16).toString('base64'),
    },
  });

  assert.equal(license.validateSync().errors.clearances.kind, 'enum');
});
