'use strict';

const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');

const { createFolderShareArchiveService } = require('../services/folderShareArchiveService');

const setNestedValue = (target, path, value) => {
  const segments = path.split('.');
  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    current[segment] ||= {};
    current = current[segment];
  }
  current[segments.at(-1)] = value;
};

const applyUpdate = (target, update) => {
  for (const [path, value] of Object.entries(update.$set || {})) setNestedValue(target, path, value);
  for (const [path, value] of Object.entries(update.$inc || {})) {
    const segments = path.split('.');
    let current = target;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      current[segment] ||= {};
      current = current[segment];
    }
    const key = segments.at(-1);
    current[key] = (current[key] || 0) + value;
  }
};

const waitFor = async (condition, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for the archive worker.');
};

test('folder-share worker streams one ZIP archive and records a ready state', async () => {
  const share = {
    _id: '507f1f77bcf86cd799439011',
    status: 'active',
    shareType: 'folder',
    s3Key: 'files/Projects/',
    originalFileName: 'Projects',
    fileCount: 2,
    totalBytes: 10,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    archive: { status: 'queued', attempts: 0 },
  };
  const zipChunks = [];
  const auditEvents = [];
  const storage = {
    createShareArchiveKey: ({ shareId, attempt }) => `file-share-archives/${shareId}-${attempt}.zip`,
    getShareableFileStream: async ({ key, eTag }) => {
      assert.ok(['files/Projects/brief.txt', 'files/Projects/Plans/notes.txt'].includes(key));
      assert.ok(['brief-etag', 'notes-etag'].includes(eTag));
      return Readable.from([key.endsWith('brief.txt') ? Buffer.from('brief') : Buffer.from('notes')]);
    },
    uploadShareArchive: async ({ key, body }) => {
      assert.equal(key, 'file-share-archives/507f1f77bcf86cd799439011-1.zip');
      for await (const chunk of body) zipChunks.push(Buffer.from(chunk));
      return { key };
    },
    headShareArchive: async () => ({ ContentLength: Buffer.concat(zipChunks).length }),
    deleteShareArchive: async () => undefined,
  };
  const FileShareModel = {
    findOneAndUpdate: async (_query, update) => {
      applyUpdate(share, update);
      return share;
    },
    updateOne: async (_query, update) => {
      applyUpdate(share, update);
      return { modifiedCount: 1 };
    },
    find: () => ({ select: () => ({ limit: () => ({ lean: async () => [] }) }) }),
  };
  const FileShareEntryModel = {
    find: () => ({
      sort: () => ({
        lean: async () => [
          { s3Key: 'files/Projects/brief.txt', archivePath: 'brief.txt', size: 5, eTag: 'brief-etag' },
          { s3Key: 'files/Projects/Plans/notes.txt', archivePath: 'Plans/notes.txt', size: 5, eTag: 'notes-etag' },
        ],
      }),
    }),
  };
  const service = createFolderShareArchiveService({
    config: { shareArchiveBuildConcurrency: 1 },
    storage,
    FileShareModel,
    FileShareEntryModel,
    FileAuditEventModel: { create: async (event) => { auditEvents.push(event); } },
  });

  try {
    assert.equal(service.enqueue(share._id), true);
    await waitFor(() => ['ready', 'failed'].includes(share.archive.status));
    assert.equal(share.archive.status, 'ready', JSON.stringify(auditEvents));
    const zip = Buffer.concat(zipChunks);
    assert.equal(zip.subarray(0, 2).toString('ascii'), 'PK');
    assert.match(zip.toString('binary'), /brief\.txt/);
    assert.match(zip.toString('binary'), /Plans\/notes\.txt/);
    assert.equal(share.archive.fileName, 'Projects.zip');
    assert.equal(share.archive.processedFiles, 2);
    assert.equal(share.archive.processedBytes, 10);
    assert.ok(share.archive.size > 0);
    assert.ok(auditEvents.some((event) => event.action === 'share_archive_started'));
    assert.ok(auditEvents.some((event) => event.action === 'share_archive_completed'));
  } finally {
    service.stop();
  }
});

test('a timed-out ready update preserves its ZIP in case MongoDB commits it late', async () => {
  const share = {
    _id: '507f1f77bcf86cd799439015',
    status: 'active',
    shareType: 'folder',
    s3Key: 'files/Finalization/',
    originalFileName: 'Finalization',
    fileCount: 1,
    totalBytes: 4,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    archive: { status: 'queued', attempts: 0 },
  };
  let findOneAndUpdateCalls = 0;
  const deletedArchiveKeys = [];
  const storage = {
    createShareArchiveKey: ({ shareId, attempt }) => `file-share-archives/${shareId}-${attempt}.zip`,
    getShareableFileStream: async () => Readable.from([Buffer.from('data')]),
    uploadShareArchive: async ({ body, onUploadCreated }) => {
      onUploadCreated({ abort: async () => undefined });
      for await (const _chunk of body) {
        // Consume the ZIP output before the final database transition.
      }
    },
    headShareArchive: async () => ({ ContentLength: 128 }),
    deleteShareArchive: async ({ key }) => { deletedArchiveKeys.push(key); },
  };
  const FileShareModel = {
    findOneAndUpdate: async (_query, update) => {
      findOneAndUpdateCalls += 1;
      if (findOneAndUpdateCalls === 1) {
        applyUpdate(share, update);
        return share;
      }
      return new Promise(() => {});
    },
    updateOne: async (_query, update) => {
      applyUpdate(share, update);
      return { modifiedCount: 1 };
    },
    find: () => ({ select: () => ({ limit: () => ({ lean: async () => [] }) }) }),
  };
  const FileShareEntryModel = {
    find: () => ({
      sort: () => ({
        lean: async () => [{
          s3Key: 'files/Finalization/data.txt',
          archivePath: 'data.txt',
          size: 4,
          eTag: 'data-etag',
        }],
      }),
    }),
  };
  const service = createFolderShareArchiveService({
    config: { shareArchiveBuildConcurrency: 1 },
    storage,
    FileShareModel,
    FileShareEntryModel,
    FileAuditEventModel: { create: async () => undefined },
    logger: { error: () => undefined },
    operationTimeoutMs: 10,
  });

  try {
    service.enqueue(share._id);
    await waitFor(() => share.archive.status === 'failed');

    assert.equal(findOneAndUpdateCalls, 2);
    assert.equal(share.archive.errorCode, 'FOLDER_SHARE_ARCHIVE_OPERATION_TIMEOUT');
    assert.deepEqual(deletedArchiveKeys, []);
  } finally {
    service.stop();
  }
});

test('cancelling an active folder-share build aborts its source and upload without marking it ready', async () => {
  const share = {
    _id: '507f1f77bcf86cd799439012',
    status: 'active',
    shareType: 'folder',
    s3Key: 'files/Long-running/',
    originalFileName: 'Long-running',
    fileCount: 1,
    totalBytes: 12,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    archive: { status: 'queued', attempts: 0 },
  };
  let sourceStarted = false;
  let sourceClosed = false;
  let uploadAborted = false;
  let headCalled = false;
  const deletedArchiveKeys = [];
  const auditEvents = [];
  const sourceStream = new Readable({
    read() {
      if (sourceStarted) return;
      sourceStarted = true;
      this.push(Buffer.from('partial data'));
      // Intentionally leave the stream open so cancellation must interrupt it.
    },
  });
  sourceStream.once('close', () => { sourceClosed = true; });
  const storage = {
    createShareArchiveKey: ({ shareId, attempt }) => `file-share-archives/${shareId}-${attempt}.zip`,
    getShareableFileStream: async () => sourceStream,
    uploadShareArchive: ({ body, onUploadCreated }) => {
      let rejectAbort;
      const abortPromise = new Promise((_, reject) => { rejectAbort = reject; });
      const consumePromise = (async () => {
        for await (const _chunk of body) {
          // Reading starts yazl's lazy source callback and leaves it in flight.
        }
      })();
      const upload = {
        abort: () => {
          uploadAborted = true;
          const error = new Error('upload aborted');
          body.destroy(error);
          rejectAbort(error);
          return Promise.resolve();
        },
      };
      onUploadCreated(upload);
      return Promise.race([consumePromise, abortPromise]);
    },
    headShareArchive: async () => {
      headCalled = true;
      return { ContentLength: 0 };
    },
    deleteShareArchive: async ({ key }) => { deletedArchiveKeys.push(key); },
  };
  const FileShareModel = {
    findOneAndUpdate: async (_query, update) => {
      applyUpdate(share, update);
      return share;
    },
    updateOne: async (_query, update) => {
      applyUpdate(share, update);
      return { modifiedCount: 1 };
    },
    find: () => ({ select: () => ({ limit: () => ({ lean: async () => [] }) }) }),
  };
  const FileShareEntryModel = {
    find: () => ({
      sort: () => ({
        lean: async () => [{
          s3Key: 'files/Long-running/archive.bin',
          archivePath: 'archive.bin',
          size: 12,
          eTag: 'archive-etag',
        }],
      }),
    }),
  };
  const service = createFolderShareArchiveService({
    config: { shareArchiveBuildConcurrency: 1 },
    storage,
    FileShareModel,
    FileShareEntryModel,
    FileAuditEventModel: { create: async (event) => { auditEvents.push(event); } },
  });

  try {
    service.enqueue(share._id);
    await waitFor(() => sourceStarted);

    assert.equal(service.cancel(share._id), true);
    await waitFor(() => uploadAborted && sourceClosed && deletedArchiveKeys.length === 1);

    assert.equal(headCalled, false);
    assert.equal(share.archive.status, 'preparing');
    assert.equal(share.archive.attempts, 1);
    assert.deepEqual(deletedArchiveKeys, ['file-share-archives/507f1f77bcf86cd799439012-1.zip']);
    assert.ok(auditEvents.some((event) => event.action === 'share_archive_started'));
    assert.ok(!auditEvents.some((event) => event.action === 'share_archive_completed'));
    assert.ok(!auditEvents.some((event) => event.action === 'share_archive_failed'));
  } finally {
    service.stop();
  }
});

test('recovery aborts a stale in-process build before rebuilding it with a new attempt', async () => {
  let currentTime = new Date('2026-01-01T00:00:00Z');
  const share = {
    _id: '507f1f77bcf86cd799439014',
    status: 'active',
    shareType: 'folder',
    s3Key: 'files/Stalled/',
    originalFileName: 'Stalled',
    fileCount: 1,
    totalBytes: 4,
    createdAt: currentTime,
    archive: { status: 'queued', attempts: 0 },
  };
  let firstSourceStarted = false;
  let firstSourceClosed = false;
  let sourceCalls = 0;
  const archiveKeys = [];
  const abortedUploadKeys = [];
  const deletedArchiveKeys = [];
  const stalledSource = new Readable({
    read() {
      if (firstSourceStarted) return;
      firstSourceStarted = true;
      this.push(Buffer.from('data'));
      // Recovery must interrupt this stream before it can finish.
    },
  });
  stalledSource.once('close', () => { firstSourceClosed = true; });
  const storage = {
    createShareArchiveKey: ({ shareId, attempt }) => {
      const key = `file-share-archives/${shareId}-${attempt}.zip`;
      archiveKeys.push(key);
      return key;
    },
    getShareableFileStream: async () => {
      sourceCalls += 1;
      return sourceCalls === 1 ? stalledSource : Readable.from([Buffer.from('data')]);
    },
    uploadShareArchive: ({ key, body, onUploadCreated }) => {
      let rejectAbort;
      const abortPromise = new Promise((_, reject) => { rejectAbort = reject; });
      const consumePromise = (async () => {
        for await (const _chunk of body) {
          // Consume each attempt's ZIP body.
        }
        return { key };
      })();
      onUploadCreated({
        abort: () => {
          abortedUploadKeys.push(key);
          const error = new Error('upload aborted');
          body.destroy(error);
          rejectAbort(error);
          return Promise.resolve();
        },
      });
      return Promise.race([consumePromise, abortPromise]);
    },
    headShareArchive: async () => ({ ContentLength: 128 }),
    deleteShareArchive: async ({ key }) => { deletedArchiveKeys.push(key); },
  };
  const FileShareModel = {
    findOneAndUpdate: async (_query, update) => {
      applyUpdate(share, update);
      return share;
    },
    updateOne: async (_query, update) => {
      applyUpdate(share, update);
      return { modifiedCount: 1 };
    },
    find: () => ({
      select: () => ({
        limit: () => ({ lean: async () => [{ _id: share._id }] }),
      }),
    }),
  };
  const FileShareEntryModel = {
    find: () => ({
      sort: () => ({
        lean: async () => [{
          s3Key: 'files/Stalled/data.txt',
          archivePath: 'data.txt',
          size: 4,
          eTag: 'data-etag',
        }],
      }),
    }),
  };
  const service = createFolderShareArchiveService({
    config: { shareArchiveBuildConcurrency: 1 },
    storage,
    FileShareModel,
    FileShareEntryModel,
    FileAuditEventModel: { create: async () => undefined },
    now: () => new Date(currentTime),
    staleHeartbeatMs: 60 * 1000,
  });

  try {
    service.enqueue(share._id);
    await waitFor(() => firstSourceStarted);

    currentTime = new Date('2026-01-01T00:02:00Z');
    await service.recover();
    await waitFor(() => share.archive.status === 'ready');

    assert.equal(firstSourceClosed, true);
    assert.deepEqual(abortedUploadKeys, ['file-share-archives/507f1f77bcf86cd799439014-1.zip']);
    assert.deepEqual(deletedArchiveKeys, ['file-share-archives/507f1f77bcf86cd799439014-1.zip']);
    assert.deepEqual(archiveKeys, [
      'file-share-archives/507f1f77bcf86cd799439014-1.zip',
      'file-share-archives/507f1f77bcf86cd799439014-2.zip',
    ]);
    assert.equal(share.archive.attempts, 2);
    assert.equal(share.archive.s3Key, 'file-share-archives/507f1f77bcf86cd799439014-2.zip');
  } finally {
    service.stop();
  }
});

test('recovery reclaims a stale preparing folder-share build with a fresh attempt and archive key', async () => {
  const currentTime = new Date('2026-01-01T00:10:00Z');
  const staleHeartbeat = new Date('2026-01-01T00:00:00Z');
  const share = {
    _id: '507f1f77bcf86cd799439013',
    status: 'active',
    shareType: 'folder',
    s3Key: 'files/Recovered/',
    originalFileName: 'Recovered',
    fileCount: 1,
    totalBytes: 4,
    createdAt: staleHeartbeat,
    archive: {
      status: 'preparing',
      attempts: 1,
      startedAt: staleHeartbeat,
      heartbeatAt: staleHeartbeat,
    },
  };
  let recoveryQuery;
  const archiveKeys = [];
  const storage = {
    createShareArchiveKey: ({ shareId, attempt }) => {
      const key = `file-share-archives/${shareId}-${attempt}.zip`;
      archiveKeys.push(key);
      return key;
    },
    getShareableFileStream: async () => Readable.from([Buffer.from('data')]),
    uploadShareArchive: async ({ body, onUploadCreated }) => {
      onUploadCreated({ abort: async () => undefined });
      for await (const _chunk of body) {
        // Consume the ZIP upload.
      }
    },
    headShareArchive: async () => ({ ContentLength: 128 }),
    deleteShareArchive: async () => undefined,
  };
  const FileShareModel = {
    findOneAndUpdate: async (_query, update) => {
      applyUpdate(share, update);
      return share;
    },
    updateOne: async (_query, update) => {
      applyUpdate(share, update);
      return { modifiedCount: 1 };
    },
    find: (query) => {
      recoveryQuery = query;
      return {
        select: () => ({
          limit: () => ({ lean: async () => [{ _id: share._id }] }),
        }),
      };
    },
  };
  const FileShareEntryModel = {
    find: () => ({
      sort: () => ({
        lean: async () => [{
          s3Key: 'files/Recovered/data.txt',
          archivePath: 'data.txt',
          size: 4,
          eTag: 'data-etag',
        }],
      }),
    }),
  };
  const service = createFolderShareArchiveService({
    config: { shareArchiveBuildConcurrency: 1 },
    storage,
    FileShareModel,
    FileShareEntryModel,
    FileAuditEventModel: { create: async () => undefined },
    now: () => new Date(currentTime),
    staleHeartbeatMs: 60 * 1000,
  });

  try {
    await service.recover();
    await waitFor(() => ['ready', 'failed'].includes(share.archive.status));

    assert.equal(share.archive.status, 'ready');
    assert.equal(share.archive.attempts, 2);
    assert.deepEqual(archiveKeys, ['file-share-archives/507f1f77bcf86cd799439013-2.zip']);
    assert.equal(recoveryQuery.status, 'active');
    assert.equal(recoveryQuery.shareType, 'folder');
    assert.deepEqual(
      recoveryQuery.$or[1]['archive.heartbeatAt'],
      { $lt: new Date('2026-01-01T00:09:00Z') },
    );
  } finally {
    service.stop();
  }
});
