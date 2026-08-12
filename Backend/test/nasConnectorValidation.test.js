'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  NasConnectorValidationError,
  assertObjectId,
  normalizeAgentVersion,
  normalizeConnectorRoot,
  normalizeConnectorRootId,
  normalizeDisplayName,
  normalizeInstallationId,
  normalizeQueueLength,
  normalizeRelativePath,
} = require('../services/nasConnectorValidation');

test('normalizes safe NAS metadata identifiers and relative paths', () => {
  assert.equal(normalizeConnectorRootId('office-projects_01'), 'office-projects_01');
  assert.equal(normalizeDisplayName('  Design projects  '), 'Design projects');
  assert.equal(normalizeRelativePath('2026/Пропозиція.pdf'), '2026/Пропозиція.pdf');
  assert.equal(normalizeRelativePath(''), '');
  assert.equal(normalizeInstallationId('A9D24D65-1A96-4F65-AA06-40C74C5934AC'), 'a9d24d65-1a96-4f65-aa06-40c74c5934ac');
  assert.equal(normalizeAgentVersion('0.1.0-preview+1'), '0.1.0-preview+1');
  assert.deepEqual(normalizeConnectorRoot({ connectorRootId: 'office-root', displayName: 'Office', uploadsEnabled: false }), {
    connectorRootId: 'office-root', displayName: 'Office', uploadsEnabled: false,
  });
  assert.equal(normalizeQueueLength(0), 0);
  assert.equal(assertObjectId('507f1f77bcf86cd799439011'), '507f1f77bcf86cd799439011');
});

test('rejects traversal, filesystem paths, and malformed identifiers', () => {
  for (const path of ['../secret', 'folder/../secret', '/absolute', 'folder\\file', 'folder//file']) {
    assert.throws(() => normalizeRelativePath(path), NasConnectorValidationError);
  }
  assert.throws(() => normalizeConnectorRootId('root/path'), NasConnectorValidationError);
  assert.throws(() => normalizeDisplayName('name\u0000'), NasConnectorValidationError);
  assert.throws(() => assertObjectId('not-a-mongodb-id'), NasConnectorValidationError);
  assert.throws(() => normalizeInstallationId('not-a-uuid'), NasConnectorValidationError);
  assert.throws(() => normalizeConnectorRoot({ connectorRootId: 'root', displayName: 'Root', uploadsEnabled: 'yes' }), NasConnectorValidationError);
  assert.throws(() => normalizeQueueLength(-1), NasConnectorValidationError);
});
