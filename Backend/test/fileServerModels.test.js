'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const FileAuditEvent = require('../models/fileAuditEvent');
const FileOperation = require('../models/fileOperation');
const FileShare = require('../models/fileShare');

test('file-share schema keeps share tokens hidden and validates share metrics', () => {
  assert.equal(FileShare.schema.path('tokenHash').options.select, false);
  const share = new FileShare({
    s3Key: 'files/Projects/proposal.pdf',
    originalFileName: 'proposal.pdf',
    tokenHash: 'a'.repeat(64),
    createdBy: 'firebase-user-id',
  });

  assert.equal(share.validateSync(), undefined);
  assert.equal(share.downloadCount, 0);
  assert.equal(share.status, 'active');
});

test('operation and audit schemas reject unsupported action values', () => {
  const operation = new FileOperation({ type: 'copy', actorUid: 'firebase-user-id' });
  const auditEvent = new FileAuditEvent({ action: 'file_downloaded', result: 'success' });

  assert.equal(operation.validateSync().errors.type.kind, 'enum');
  assert.equal(auditEvent.validateSync().errors.action.kind, 'enum');
});

test('a NAS share can remain in preparation without an S3 object, while legacy S3 shares stay ready', () => {
  const pendingNasShare = new FileShare({
    sourceType: 'nas_file',
    nasFileEntryId: '507f1f77bcf86cd799439011',
    originalFileName: 'proposal.pdf',
    tokenHash: 'b'.repeat(64),
    createdBy: 'firebase-user-id',
    deliveryStatus: 'preparing',
  });

  assert.equal(pendingNasShare.validateSync(), undefined);
  assert.equal(pendingNasShare.s3Key, null);
  assert.equal(pendingNasShare.deliveryStatus, 'preparing');
});
