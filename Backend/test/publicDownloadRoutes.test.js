'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const { createShareToken } = require('../services/fileShareToken');
const { createPublicDownloadRoutes } = require('../routes/publicDownloadRoutes');
const { FileStorageError } = require('../services/fileStorageService');

const startApp = async (router) => {
  const app = express();
  app.use('/download', router);
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};

test('a valid public link exposes metadata without counting, then returns a signed URL and increments on download', async () => {
  const { token, tokenHash } = createShareToken();
  const share = {
    _id: '507f1f77bcf86cd799439011',
    tokenHash,
    status: 'active',
    s3Key: 'files-sync/nas/proposal.pdf',
    originalFileName: 'proposal.pdf',
  };
  let updateCalled = false;
  const app = await startApp(createPublicDownloadRoutes({
    config: { prefix: 'files/', shareablePrefixes: ['files/', 'files-sync/'], publicBaseUrl: 'https://adimari-db.com' },
    storage: {
      headShareableFile: async () => ({ ContentLength: 123 }),
      getShareableDownloadUrl: async () => 'https://signed.example/download',
    },
    FileShareModel: {
      findOne: () => ({ select: async () => share }),
      findOneAndUpdate: async () => {
        updateCalled = true;
        return share;
      },
    },
    FileAuditEventModel: { create: async () => ({}) },
  }));
  try {
    const info = await fetch(`${app.url}/download/${token}/info`);
    assert.equal(info.status, 200);
    assert.equal((await info.json()).file.size, 123);
    assert.equal(info.headers.get('cache-control'), 'no-store, private');
    assert.equal(info.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(updateCalled, false);

    const response = await fetch(`${app.url}/download/${token}/download`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).downloadUrl, 'https://signed.example/download');
    assert.equal(response.headers.get('cache-control'), 'no-store, private');
    assert.equal(updateCalled, true);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test('an invalid public link returns a generic not-found response without querying S3', async () => {
  let storageCalled = false;
  const app = await startApp(createPublicDownloadRoutes({
    config: { prefix: 'files/', shareablePrefixes: ['files/'], publicBaseUrl: 'https://adimari-db.com' },
    storage: {
      headShareableFile: async () => { storageCalled = true; },
      getShareableDownloadUrl: async () => { storageCalled = true; },
    },
    FileShareModel: {},
    FileAuditEventModel: { create: async () => ({}) },
  }));
  try {
    const response = await fetch(`${app.url}/download/not-a-valid-token`);
    assert.equal(response.status, 404);
    assert.equal(storageCalled, false);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test('a folder share lists its snapshot and starts one signed ZIP download when ready', async () => {
  const { token, tokenHash } = createShareToken();
  const share = {
    _id: '507f1f77bcf86cd799439011',
    tokenHash,
    status: 'active',
    shareType: 'folder',
    s3Key: 'files/Projects/2026/',
    originalFileName: '2026',
    fileCount: 2,
    totalBytes: 30,
    archive: {
      status: 'ready',
      s3Key: 'file-share-archives/507f1f77bcf86cd799439011.zip',
      fileName: '2026.zip',
      size: 72,
      processedFiles: 2,
      processedBytes: 30,
    },
  };
  let counted = false;
  const app = await startApp(createPublicDownloadRoutes({
    config: { prefix: 'files/', shareablePrefixes: ['files/'], publicBaseUrl: 'https://adimari-db.com' },
    storage: {
      headShareArchive: async () => ({ ContentLength: 72 }),
      getShareArchiveDownloadUrl: async () => 'https://signed.example/folder.zip',
    },
    FileShareModel: {
      findOne: () => ({ select: async () => share }),
      findOneAndUpdate: async () => {
        counted = true;
        return share;
      },
    },
    FileShareEntryModel: {
      find: () => ({
        sort: () => ({
          lean: async () => [
            { archivePath: 'brief.pdf', size: 12 },
            { archivePath: 'Plans/floor.pdf', size: 18 },
          ],
        }),
      }),
    },
    FileAuditEventModel: { create: async () => ({}) },
  }));
  try {
    const info = await fetch(`${app.url}/download/${token}/info`);
    assert.equal(info.status, 200);
    assert.equal(info.headers.get('cache-control'), 'no-store, private');
    assert.deepEqual(await info.json(), {
      type: 'folder',
      folder: {
        name: '2026',
        fileCount: 2,
        totalBytes: 30,
        archive: { status: 'ready', fileName: '2026.zip', size: 72, processedFiles: 2, processedBytes: 30 },
        files: [
          { path: 'brief.pdf', name: 'brief.pdf', size: 12 },
          { path: 'Plans/floor.pdf', name: 'floor.pdf', size: 18 },
        ],
      },
    });
    assert.equal(counted, false);

    const download = await fetch(`${app.url}/download/${token}/download`, { method: 'POST' });
    assert.equal(download.status, 200);
    assert.equal((await download.json()).downloadUrl, 'https://signed.example/folder.zip');
    assert.equal(counted, true);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test('a queued folder archive returns a progress response and asks the worker to resume', async () => {
  const { token, tokenHash } = createShareToken();
  const share = {
    _id: '507f1f77bcf86cd799439011',
    tokenHash,
    status: 'active',
    shareType: 'folder',
    s3Key: 'files/Projects/2026/',
    originalFileName: '2026',
    fileCount: 2,
    totalBytes: 30,
    archive: { status: 'queued', processedFiles: 0, processedBytes: 0 },
  };
  let enqueueCount = 0;
  const app = await startApp(createPublicDownloadRoutes({
    config: { prefix: 'files/', shareablePrefixes: ['files/'], publicBaseUrl: 'https://adimari-db.com' },
    storage: {},
    FileShareModel: { findOne: () => ({ select: async () => share }) },
    FileShareEntryModel: {
      find: () => ({ sort: () => ({ lean: async () => [] }) }),
    },
    FileAuditEventModel: { create: async () => ({}) },
    archiveService: { enqueue: () => { enqueueCount += 1; } },
  }));
  try {
    const download = await fetch(`${app.url}/download/${token}/download`, { method: 'POST' });
    assert.equal(download.status, 202);
    assert.deepEqual((await download.json()).archive, {
      status: 'queued',
      fileName: null,
      size: null,
      processedFiles: 0,
      processedBytes: 0,
    });
    assert.equal(enqueueCount, 1);
    assert.equal(download.headers.get('retry-after'), '3');
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test('a missing ready folder archive is marked failed so the owner can recover it', async () => {
  const { token, tokenHash } = createShareToken();
  const share = {
    _id: '507f1f77bcf86cd799439014',
    tokenHash,
    status: 'active',
    shareType: 'folder',
    s3Key: 'files/Projects/Recovered/',
    originalFileName: 'Recovered',
    fileCount: 1,
    totalBytes: 12,
    archive: {
      status: 'ready',
      s3Key: 'file-share-archives/507f1f77bcf86cd799439014-1.zip',
      fileName: 'Recovered.zip',
      size: 12,
    },
  };
  let updateCalled = false;
  const app = await startApp(createPublicDownloadRoutes({
    config: { prefix: 'files/', shareablePrefixes: ['files/'], publicBaseUrl: 'https://adimari-db.com' },
    storage: {
      headShareArchive: async () => {
        throw new FileStorageError({ code: 'FILE_NOT_FOUND', message: 'missing', status: 404 });
      },
    },
    FileShareModel: {
      findOne: () => ({ select: async () => share }),
      updateOne: async (_query, update) => {
        updateCalled = true;
        Object.assign(share.archive, {
          status: update.$set['archive.status'],
          errorCode: update.$set['archive.errorCode'],
        });
      },
    },
    FileShareEntryModel: {
      find: () => ({ sort: () => ({ lean: async () => [{ archivePath: 'brief.pdf', size: 12 }] }) }),
    },
    FileAuditEventModel: { create: async () => ({}) },
  }));
  try {
    const response = await fetch(`${app.url}/download/${token}/info`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.folder.archive.status, 'failed');
    assert.equal(updateCalled, true);
    assert.equal(share.archive.errorCode, 'FOLDER_SHARE_ARCHIVE_MISSING');
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});
