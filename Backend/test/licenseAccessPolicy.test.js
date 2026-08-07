'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CLEARANCES,
  canSetClearance,
  licenseFilterById,
  readableLicenseFilter,
} = require('../security/licenseAccessPolicy');

const moderator = { role: 'moderator', uid: 'moderator-uid' };
const admin = { role: 'admin', uid: 'admin-uid' };
const regular = { role: 'regular', uid: 'regular-uid' };

test('moderators can query only moderator-visible records', () => {
  assert.deepEqual(readableLicenseFilter(moderator), { clearances: CLEARANCES.MODERATOR });
  assert.deepEqual(licenseFilterById(moderator, 'license-id'), {
    _id: 'license-id',
    clearances: CLEARANCES.MODERATOR,
  });
});

test('admins can query every record and regular users receive a no-match filter', () => {
  assert.deepEqual(readableLicenseFilter(admin), {});
  assert.deepEqual(readableLicenseFilter(regular), { _id: null });
});

test('only admins can set admin-only clearance', () => {
  assert.equal(canSetClearance(moderator, CLEARANCES.MODERATOR), true);
  assert.equal(canSetClearance(moderator, CLEARANCES.ADMIN), false);
  assert.equal(canSetClearance(admin, CLEARANCES.ADMIN), true);
  assert.equal(canSetClearance(admin, 'private'), false);
  assert.equal(canSetClearance(regular, CLEARANCES.MODERATOR), false);
  assert.equal(canSetClearance(admin, 'unknown'), false);
});
