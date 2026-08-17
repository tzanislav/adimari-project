'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const { createFileRoutes } = require('../routes/fileRoutes');
const { FileStorageError } = require('../services/fileStorageService');

const startApp = async (role) => {
  const app = express();
  app.use(express.json());
  app.use('/api/files', createFileRoutes({
    config: { prefix: 'files/' },
    storage: {
      listFolder: async () => ({ folder: '', files: [], folders: [], nextContinuationToken: null }),
    },
    FileOperationModel: { findOne: async () => null },
    FileShareModel: { updateMany: async () => ({}) },
    FileAuditEventModel: { create: async () => ({}) },
    authenticateMiddleware: (req, res, next) => {
      if (req.header('authorization') !== 'Bearer valid') {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      req.user = { uid: 'test-user', role };
      return next();
    },
    authorizeMiddleware: (req, res, next) => {
      if (!['moderator', 'admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      return next();
    },
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
  };
};

test('file routes allow moderators and deny anonymous or regular users', async () => {
  const moderator = await startApp('moderator');
  try {
    const authorized = await fetch(`${moderator.url}/api/files`, { headers: { authorization: 'Bearer valid' } });
    const anonymous = await fetch(`${moderator.url}/api/files`);
    assert.equal(authorized.status, 200);
    assert.equal(anonymous.status, 401);
  } finally {
    await new Promise((resolve) => moderator.server.close(resolve));
  }

  const regular = await startApp('regular');
  try {
    const denied = await fetch(`${regular.url}/api/files`, { headers: { authorization: 'Bearer valid' } });
    assert.equal(denied.status, 403);
  } finally {
    await new Promise((resolve) => regular.server.close(resolve));
  }
});

test('a configured File Sync prefix can create a share without expanding manager storage operations', async () => {
  const app = express();
  app.use(express.json());
  let sharedKey;
  let managerStorageCalled = false;
  app.use('/api/files', createFileRoutes({
    config: {
      prefix: 'files/',
      shareablePrefixes: ['files/', 'files-sync/'],
      publicBaseUrl: 'https://adimari-db.com',
    },
    storage: {
      headShareableFile: async ({ key }) => {
        sharedKey = key;
        return { ContentLength: 12 };
      },
      headFile: async () => { managerStorageCalled = true; },
    },
    FileOperationModel: { findOne: async () => null },
    FileShareModel: {
      create: async (share) => ({ _id: 'share-1', ...share }),
    },
    FileAuditEventModel: { create: async () => ({}) },
    authenticateMiddleware: (req, res, next) => {
      if (req.header('authorization') !== 'Bearer valid') {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      req.user = { uid: 'test-user', role: 'moderator' };
      return next();
    },
    authorizeMiddleware: (req, res, next) => next(),
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/files/shares`, {
      method: 'POST',
      headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'files-sync/nas/photo.jpg' }),
    });

    assert.equal(response.status, 201);
    assert.equal(sharedKey, 'files-sync/nas/photo.jpg');
    assert.equal(managerStorageCalled, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a folder share stores a recursive snapshot, returns a link, and queues ZIP packaging', async () => {
  const app = express();
  app.use(express.json());
  let snapshotArguments;
  let insertedEntries;
  let queuedShareId;
  let createdShareAttributes;
  let initializationQuery;
  app.use('/api/files', createFileRoutes({
    config: {
      prefix: 'files/',
      shareablePrefixes: ['files/'],
      publicBaseUrl: 'https://adimari-db.com',
      shareArchiveMaxFiles: 50,
      shareArchiveMaxBytes: 1_000_000,
    },
    storage: {
      listFolderShareSnapshot: async (arguments_) => {
        snapshotArguments = arguments_;
        return {
          folder: 'Projects/2026',
          prefix: 'files/Projects/2026/',
          totalBytes: 30,
          files: [
            { key: 'files/Projects/2026/brief.pdf', archivePath: 'brief.pdf', size: 12, eTag: 'brief' },
            { key: 'files/Projects/2026/Plans/floor.pdf', archivePath: 'Plans/floor.pdf', size: 18, eTag: 'floor' },
          ],
        };
      },
    },
    FileOperationModel: { findOne: async () => null },
    FileShareModel: {
      create: async (share) => {
        createdShareAttributes = share;
        return { _id: '507f1f77bcf86cd799439011', ...share };
      },
      findOneAndUpdate: async (query, update) => {
        initializationQuery = query;
        return {
        _id: '507f1f77bcf86cd799439011',
        shareType: 'folder',
        s3Key: 'files/Projects/2026/',
        originalFileName: '2026',
        folderPath: 'Projects/2026',
        fileCount: 2,
        totalBytes: 30,
        archive: { status: update.$set['archive.status'] },
        createdBy: 'test-user',
        };
      },
    },
    FileShareEntryModel: {
      insertMany: async (entries) => { insertedEntries = entries; },
    },
    FileAuditEventModel: { create: async () => ({}) },
    archiveService: { enqueue: (shareId) => { queuedShareId = String(shareId); } },
    authenticateMiddleware: (req, res, next) => {
      if (req.header('authorization') !== 'Bearer valid') return res.status(401).json({ error: 'Unauthorized' });
      req.user = { uid: 'test-user', role: 'moderator' };
      return next();
    },
    authorizeMiddleware: (req, res, next) => next(),
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/files/folder-shares`, {
      method: 'POST',
      headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ folder: 'Projects/2026' }),
    });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.match(body.url, /^https:\/\/adimari-db\.com\/file-download\//);
    assert.equal(body.share.shareType, 'folder');
    assert.equal(body.share.archive.status, 'queued');
    assert.equal(body.share.fileCount, 2);
    assert.equal(body.share.totalBytes, 30);
    assert.equal(createdShareAttributes.archive.status, 'initializing');
    assert.equal(initializationQuery['archive.status'], 'initializing');
    assert.deepEqual(snapshotArguments, { folder: 'Projects/2026', maxFiles: 50, maxBytes: 1_000_000 });
    assert.deepEqual(insertedEntries.map((entry) => ({ s3Key: entry.s3Key, archivePath: entry.archivePath, size: entry.size })), [
      { s3Key: 'files/Projects/2026/brief.pdf', archivePath: 'brief.pdf', size: 12 },
      { s3Key: 'files/Projects/2026/Plans/floor.pdf', archivePath: 'Plans/floor.pdf', size: 18 },
    ]);
    assert.equal(queuedShareId, '507f1f77bcf86cd799439011');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('moving a source file revokes affected folder snapshots and cleans up their archive', async () => {
  const app = express();
  app.use(express.json());
  const sourceKey = 'files/Projects/brief.pdf';
  const destinationKey = 'files/Archive/brief.pdf';
  const updateFilters = [];
  let distinctFilter;
  let cancelledShareId;
  let deletedArchiveKey;
  const operation = {
    _id: '507f1f77bcf86cd799439012',
    status: 'pending',
    save: async () => operation,
  };
  app.use('/api/files', createFileRoutes({
    config: { prefix: 'files/', publicBaseUrl: 'https://adimari-db.com' },
    storage: {
      headFile: async () => {
        throw new FileStorageError({ code: 'FILE_NOT_FOUND', message: 'missing', status: 404 });
      },
      moveFile: async () => ({ sourceKey, destinationKey }),
      deleteShareArchive: async ({ key }) => { deletedArchiveKey = key; },
      createShareArchiveKey: ({ shareId, attempt }) => `file-share-archives/${shareId}-${attempt}.zip`,
    },
    FileOperationModel: {
      findOne: async () => null,
      create: async () => operation,
    },
    FileShareModel: {
      updateMany: async (filter) => {
        updateFilters.push(filter);
        return { modifiedCount: 1 };
      },
      find: () => ({
        select: () => ({
          lean: async () => [{
            _id: '507f1f77bcf86cd799439013',
            archive: { s3Key: 'file-share-archives/507f1f77bcf86cd799439013-1.zip', attempts: 1 },
          }],
        }),
      }),
    },
    FileShareEntryModel: {
      distinct: async (_field, filter) => {
        distinctFilter = filter;
        return ['507f1f77bcf86cd799439013'];
      },
    },
    FileAuditEventModel: { create: async () => ({}) },
    archiveService: { cancel: (shareId) => { cancelledShareId = String(shareId); } },
    authenticateMiddleware: (req, res, next) => {
      if (req.header('authorization') !== 'Bearer valid') return res.status(401).json({ error: 'Unauthorized' });
      req.user = { uid: 'test-user', role: 'moderator' };
      return next();
    },
    authorizeMiddleware: (req, res, next) => next(),
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/files/move`, {
      method: 'POST',
      headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({ sourceKey, destinationFolder: 'Archive', destinationFileName: 'brief.pdf' }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(distinctFilter, { s3Key: sourceKey });
    assert.equal(cancelledShareId, '507f1f77bcf86cd799439013');
    assert.equal(deletedArchiveKey, 'file-share-archives/507f1f77bcf86cd799439013-1.zip');
    assert.deepEqual(updateFilters[0], { s3Key: sourceKey, status: 'active' });
    assert.deepEqual(updateFilters[1], {
      _id: { $in: ['507f1f77bcf86cd799439013'] },
      status: 'active',
      shareType: 'folder',
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an empty file upload is completed server-side without starting a multipart upload', async () => {
  const app = express();
  app.use(express.json());
  let putEmptyArguments;
  let multipartStarted = false;
  const auditEvents = [];
  const operation = {
    _id: '507f1f77bcf86cd799439014',
    status: 'pending',
    save: async () => operation,
  };

  app.use('/api/files', createFileRoutes({
    config: { prefix: 'files/', multipartPartSizeBytes: 8 * 1024 * 1024 },
    storage: {
      headFile: async () => {
        throw new FileStorageError({ code: 'FILE_NOT_FOUND', message: 'missing', status: 404 });
      },
      putEmptyFile: async (arguments_) => {
        putEmptyArguments = arguments_;
        return {
          key: arguments_.key,
          ContentLength: 0,
          ETag: 'empty-etag',
          ContentType: arguments_.contentType,
          VersionId: 'empty-version',
        };
      },
      createMultipartUpload: async () => {
        multipartStarted = true;
        return { uploadId: 'should-not-be-used' };
      },
    },
    FileOperationModel: {
      findOne: async () => null,
      create: async (attributes) => {
        Object.assign(operation, attributes);
        return operation;
      },
    },
    FileAuditEventModel: { create: async (event) => { auditEvents.push(event); return event; } },
    authenticateMiddleware: (req, res, next) => {
      if (req.header('authorization') !== 'Bearer valid') return res.status(401).json({ error: 'Unauthorized' });
      req.user = { uid: 'test-user', role: 'moderator' };
      return next();
    },
    authorizeMiddleware: (req, res, next) => next(),
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/files/uploads`, {
      method: 'POST',
      headers: { authorization: 'Bearer valid', 'content-type': 'application/json' },
      body: JSON.stringify({
        folder: 'Projects/2026',
        fileName: 'empty.txt',
        size: 0,
        contentType: 'text/plain',
      }),
    });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.completed, true);
    assert.equal(body.key, 'files/Projects/2026/empty.txt');
    assert.deepEqual(body.file, {
      key: 'files/Projects/2026/empty.txt',
      name: 'empty.txt',
      size: 0,
      eTag: 'empty-etag',
      contentType: 'text/plain',
      versionId: 'empty-version',
    });
    assert.deepEqual(putEmptyArguments, {
      key: 'files/Projects/2026/empty.txt',
      contentType: 'text/plain',
      preventOverwrite: true,
    });
    assert.equal(multipartStarted, false);
    assert.equal(operation.status, 'completed');
    assert.equal(operation.context.uploadMode, 'empty-object');
    assert.deepEqual(auditEvents.map(({ action, result }) => ({ action, result })), [
      { action: 'upload_started', result: 'success' },
      { action: 'upload_completed', result: 'success' },
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('uploads reject reserved folder markers, non-numeric sizes, and configured size limits', async () => {
  const app = express();
  app.use(express.json());
  let storageTouched = false;
  app.use('/api/files', createFileRoutes({
    config: { prefix: 'files/', multipartPartSizeBytes: 8 * 1024 * 1024, maxUploadBytes: 10 },
    storage: {
      headFile: async () => {
        storageTouched = true;
        throw new Error('Storage must not be called for rejected uploads.');
      },
    },
    FileOperationModel: { findOne: async () => null },
    FileAuditEventModel: { create: async () => ({}) },
    authenticateMiddleware: (req, res, next) => {
      req.user = { uid: 'test-user', role: 'moderator' };
      next();
    },
    authorizeMiddleware: (req, res, next) => next(),
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/files/uploads`;

  try {
    const marker = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folder: 'Projects', fileName: '.keep', size: 0 }),
    });
    const stringSize = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folder: 'Projects', fileName: 'empty.txt', size: '0' }),
    });
    const tooLarge = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ folder: 'Projects', fileName: 'large.txt', size: 11 }),
    });

    assert.equal(marker.status, 400);
    assert.equal(stringSize.status, 400);
    assert.equal(tooLarge.status, 413);
    assert.equal(storageTouched, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('multipart lifecycle operations are scoped to the uploading user', async () => {
  const app = express();
  app.use(express.json());
  const filters = [];
  app.use('/api/files', createFileRoutes({
    config: { prefix: 'files/' },
    storage: {},
    FileOperationModel: {
      findOne: async (filter) => {
        filters.push(filter);
        return null;
      },
    },
    FileAuditEventModel: { create: async () => ({}) },
    authenticateMiddleware: (req, res, next) => {
      req.user = { uid: 'test-user', role: 'moderator' };
      next();
    },
    authorizeMiddleware: (req, res, next) => next(),
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });
  const operationId = '507f1f77bcf86cd799439099';
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/files/uploads/${operationId}`;

  try {
    const parts = await fetch(`${baseUrl}/parts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ partNumbers: [1] }),
    });
    const complete = await fetch(`${baseUrl}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parts: [{ partNumber: 1, eTag: 'etag' }] }),
    });
    const abort = await fetch(`${baseUrl}/abort`, { method: 'POST' });

    assert.equal(parts.status, 404);
    assert.equal(complete.status, 404);
    assert.equal(abort.status, 404);
    assert.equal(filters.length, 3);
    assert.ok(filters.every((filter) => filter.actorUid === 'test-user'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
