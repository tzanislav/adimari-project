'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const { createShareToken } = require('../services/fileShareToken');
const { createPublicDownloadRoutes } = require('../routes/publicDownloadRoutes');

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
    s3Key: 'files/Projects/proposal.pdf',
    originalFileName: 'proposal.pdf',
  };
  let updateCalled = false;
  const app = await startApp(createPublicDownloadRoutes({
    config: { prefix: 'files/', publicBaseUrl: 'https://adimari-db.com' },
    storage: {
      headFile: async () => ({ ContentLength: 123 }),
      getDownloadUrl: async () => 'https://signed.example/download',
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
    config: { prefix: 'files/', publicBaseUrl: 'https://adimari-db.com' },
    storage: {
      headFile: async () => { storageCalled = true; },
      getDownloadUrl: async () => { storageCalled = true; },
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

test('a pending NAS share shows preparation status and never queries storage before delivery is ready', async () => {
  const { token, tokenHash } = createShareToken();
  let storageCalled = false;
  const app = await startApp(createPublicDownloadRoutes({
    config: { prefix: 'files/', publicBaseUrl: 'https://adimari-db.com' },
    storage: {
      headFile: async () => { storageCalled = true; },
      getDownloadUrl: async () => { storageCalled = true; },
    },
    FileShareModel: {
      findOne: () => ({
        select: async () => ({
          _id: '507f1f77bcf86cd799439011',
          tokenHash,
          status: 'active',
          sourceType: 'nas_file',
          nasFileEntryId: '607f1f77bcf86cd799439011',
          deliveryStatus: 'preparing',
          s3Key: null,
          originalFileName: 'proposal.pdf',
        }),
      }),
    },
    NasFileEntryModel: {
      findOne: async () => ({ sizeBytes: 456, contentType: 'application/pdf' }),
    },
    FileAuditEventModel: { create: async () => ({}) },
  }));
  try {
    const info = await fetch(`${app.url}/download/${token}/info`);
    assert.equal(info.status, 200);
    const infoBody = await info.json();
    assert.equal(infoBody.deliveryStatus, 'preparing');
    assert.equal(infoBody.file.size, 456);

    const download = await fetch(`${app.url}/download/${token}/download`, { method: 'POST' });
    assert.equal(download.status, 202);
    assert.equal((await download.json()).deliveryStatus, 'preparing');
    assert.equal(storageCalled, false);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});

test('a ready NAS share reads and signs its object through the isolated cache prefix', async () => {
  const { token, tokenHash } = createShareToken();
  const cacheCalls = [];
  const app = await startApp(createPublicDownloadRoutes({
    config: { prefix: 'files/', publicBaseUrl: 'https://adimari-db.com', downloadUrlTtlSeconds: 900 },
    nasConfig: { region: 'eu-west-1', bucketName: 'adimari-private-files-prod', cachePrefix: 'nas-cache/' },
    storage: {
      headFile: async () => { throw new Error('The files/ storage must not be used for a NAS share.'); },
      getDownloadUrl: async () => { throw new Error('The files/ storage must not be used for a NAS share.'); },
    },
    cacheStorage: {
      headFile: async ({ key }) => {
        cacheCalls.push(['head', key]);
        return { ContentLength: 456, ContentType: 'application/pdf' };
      },
      getDownloadUrl: async ({ key, fileName }) => {
        cacheCalls.push(['url', key, fileName]);
        return 'https://signed.example/nas-cache-download';
      },
    },
    FileShareModel: {
      findOne: () => ({
        select: async () => ({
          _id: '507f1f77bcf86cd799439011', tokenHash, status: 'active', sourceType: 'nas_file',
          deliveryStatus: 'ready', s3Key: 'nas-cache/shares/507f1f77bcf86cd799439011/content',
          originalFileName: 'proposal.pdf',
        }),
      }),
      findOneAndUpdate: async () => ({ _id: '507f1f77bcf86cd799439011', s3Key: 'nas-cache/shares/507f1f77bcf86cd799439011/content' }),
    },
    FileAuditEventModel: { create: async () => ({}) },
  }));
  try {
    const info = await fetch(`${app.url}/download/${token}/info`);
    assert.equal(info.status, 200);
    assert.equal((await info.json()).deliveryStatus, 'ready');

    const download = await fetch(`${app.url}/download/${token}/download`, { method: 'POST' });
    assert.equal(download.status, 200);
    assert.equal((await download.json()).downloadUrl, 'https://signed.example/nas-cache-download');
    assert.deepEqual(cacheCalls, [
      ['head', 'nas-cache/shares/507f1f77bcf86cd799439011/content'],
      ['head', 'nas-cache/shares/507f1f77bcf86cd799439011/content'],
      ['url', 'nas-cache/shares/507f1f77bcf86cd799439011/content', 'proposal.pdf'],
    ]);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
});
