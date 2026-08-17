'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const FileAuditEvent = require('../models/fileAuditEvent');
const FileOperation = require('../models/fileOperation');
const FileShare = require('../models/fileShare');
const FileShareEntry = require('../models/fileShareEntry');

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

test('folder shares retain archive state separately from their immutable file entries', () => {
  const share = new FileShare({
    shareType: 'folder',
    s3Key: 'files/Projects/',
    originalFileName: 'Projects',
    folderPath: 'Projects',
    fileCount: 1,
    totalBytes: 12,
    archive: { status: 'queued' },
    tokenHash: 'b'.repeat(64),
    createdBy: 'firebase-user-id',
  });
  const entry = new FileShareEntry({
    fileShareId: share._id,
    s3Key: 'files/Projects/brief.pdf',
    archivePath: 'brief.pdf',
    size: 12,
    eTag: 'snapshot-etag',
  });

  assert.equal(share.validateSync(), undefined);
  assert.equal(entry.validateSync(), undefined);
  assert.equal(share.archive.status, 'queued');
  assert.equal(FileShare.schema.path('archive.s3Key').options.select, false);
  assert.equal(FileShareEntry.schema.path('eTag').options.required, true);
});

test('operation and audit schemas reject unsupported action values', () => {
  const operation = new FileOperation({ type: 'copy', actorUid: 'firebase-user-id' });
  const auditEvent = new FileAuditEvent({ action: 'file_downloaded', result: 'success' });

  assert.equal(operation.validateSync().errors.type.kind, 'enum');
  assert.equal(auditEvent.validateSync().errors.action.kind, 'enum');
});
