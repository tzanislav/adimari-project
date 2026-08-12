'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const NasAuditEvent = require('../models/nasAuditEvent');
const NasConnector = require('../models/nasConnector');
const NasEnrollmentToken = require('../models/nasEnrollmentToken');
const NasFileEntry = require('../models/nasFileEntry');
const NasStorageRoot = require('../models/nasStorageRoot');
const NasTransferJob = require('../models/nasTransferJob');

test('NAS connector keeps its credential hash hidden and validates its state', () => {
  assert.equal(NasConnector.schema.path('credentialHash').options.select, false);
  const connector = new NasConnector({
    name: 'Office NAS connector',
    installationId: 'a9d24d65-1a96-4f65-aa06-40c74c5934ac',
    credentialHash: 'a'.repeat(64),
  });

  assert.equal(connector.validateSync(), undefined);
  assert.equal(connector.status, 'enrolling');
});

test('NAS enrollment tokens keep secret hashes hidden and expire after their bounded recovery window', () => {
  assert.equal(NasEnrollmentToken.schema.path('tokenHash').options.select, false);
  assert.equal(NasEnrollmentToken.schema.path('targetCredentialHash').options.select, false);
  assert.equal(NasEnrollmentToken.schema.path('consumedDeviceSecretHash').options.select, false);
  const ttlIndex = NasEnrollmentToken.schema.indexes()
    .find(([keys, options]) => keys.recoveryExpiresAt === 1 && options.expireAfterSeconds === 0);
  assert.ok(ttlIndex);
});

test('NAS metadata models support indexed files and bounded transfer jobs', () => {
  const connectorId = new NasConnector({
    name: 'Office NAS connector', installationId: 'unique-installation', credentialHash: 'b'.repeat(64),
  })._id;
  const root = new NasStorageRoot({ connectorId, connectorRootId: 'projects-root', displayName: 'Projects' });
  assert.equal(root.validateSync(), undefined);

  const entry = new NasFileEntry({
    storageRootId: root._id,
    relativePath: '2026/Preview.jpg',
    parentPath: '2026',
    name: 'Preview.jpg',
    entryType: 'file',
    sizeBytes: 1024,
    contentType: 'image/jpeg',
    previewKind: 'image',
    imageWidth: 1600,
    imageHeight: 900,
    lastIndexedAt: new Date(),
  });
  assert.equal(entry.validateSync(), undefined);

  const job = new NasTransferJob({
    type: 'generate_thumbnail', connectorId, storageRootId: root._id, fileEntryId: entry._id,
    progressStage: 'generating_thumbnail', progressBytes: 512, progressTotalBytes: 1024,
  });
  assert.equal(job.validateSync(), undefined);
  assert.equal(job.status, 'queued');
  assert.equal(job.attemptCount, 0);
  assert.equal(job.progressBytes, 512);
  assert.equal(entry.thumbnailStatus, 'not_requested');
});

test('NAS schemas reject unsupported job and audit action values', () => {
  const job = new NasTransferJob({ type: 'delete_from_nas' });
  const auditEvent = new NasAuditEvent({ action: 'file_deleted', result: 'success' });

  assert.equal(job.validateSync().errors.type.kind, 'enum');
  assert.equal(auditEvent.validateSync().errors.action.kind, 'enum');
});
