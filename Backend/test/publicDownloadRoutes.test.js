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
