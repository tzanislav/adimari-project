'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const { createFileRoutes } = require('../routes/fileRoutes');

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
