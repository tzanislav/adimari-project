'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const { createNasCatalogueRoutes } = require('../routes/nasCatalogueRoutes');

const ROOT_ID = '2'.repeat(24);
const OFFLINE_ROOT_ID = '3'.repeat(24);
const DISABLED_ROOT_ID = '4'.repeat(24);

const clone = (value) => JSON.parse(JSON.stringify(value));

const isMatch = (value, expected) => {
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof RegExp)) {
    if ('$in' in expected) return expected.$in.includes(value);
    if ('$lt' in expected) return value < expected.$lt;
    if ('$gt' in expected) return value > expected.$gt;
    if ('$regex' in expected) return new RegExp(expected.$regex, expected.$options || '').test(value || '');
  }
  return value === expected;
};

const matches = (record, filter) => Object.entries(filter).every(([key, expected]) => {
  if (key === '$or') return expected.some((clause) => matches(record, clause));
  return isMatch(record[key], expected);
});

const compare = (order) => (left, right) => {
  for (const [key, direction] of Object.entries(order)) {
    const leftValue = String(left[key] || '');
    const rightValue = String(right[key] || '');
    if (leftValue < rightValue) return -1 * direction;
    if (leftValue > rightValue) return 1 * direction;
  }
  return 0;
};

const createModels = () => {
  const roots = [
    { _id: ROOT_ID, connectorId: '1'.repeat(24), connectorRootId: 'office-projects', displayName: 'Office projects', status: 'active', uploadsEnabled: true, lastIndexedAt: '2026-08-12T12:00:00.000Z', lastFullScanAt: '2026-08-12T12:00:00.000Z' },
    { _id: OFFLINE_ROOT_ID, displayName: 'Archive', status: 'offline', uploadsEnabled: false },
    { _id: DISABLED_ROOT_ID, displayName: 'Disabled', status: 'disabled', uploadsEnabled: false },
  ];
  const entries = [
    { _id: 'a'.repeat(24), storageRootId: ROOT_ID, relativePath: 'Design', parentPath: '', name: 'Design', entryType: 'folder', sizeBytes: null, modifiedAt: '2026-08-10T12:00:00.000Z', previewKind: 'none', availabilityStatus: 'offline', thumbnailStatus: 'not_requested', lastIndexedAt: '2026-08-12T12:00:00.000Z', deletedAt: null },
    { _id: 'b'.repeat(24), storageRootId: ROOT_ID, relativePath: 'Design/preview.jpg', parentPath: 'Design', name: 'preview.jpg', entryType: 'file', sizeBytes: 1024, modifiedAt: '2026-08-11T12:00:00.000Z', contentType: 'image/jpeg', previewKind: 'image', availabilityStatus: 'offline', thumbnailStatus: 'not_requested', lastIndexedAt: '2026-08-12T12:00:00.000Z', deletedAt: null },
    { _id: 'e'.repeat(24), storageRootId: ROOT_ID, relativePath: 'Design/cover.png', parentPath: 'Design', name: 'cover.png', entryType: 'file', sizeBytes: 512, modifiedAt: '2026-08-10T12:00:00.000Z', contentType: 'image/png', previewKind: 'image', availabilityStatus: 'offline', thumbnailStatus: 'not_requested', lastIndexedAt: '2026-08-12T12:00:00.000Z', deletedAt: null },
    { _id: 'c'.repeat(24), storageRootId: ROOT_ID, relativePath: 'brief.pdf', parentPath: '', name: 'brief.pdf', entryType: 'file', sizeBytes: 2048, modifiedAt: '2026-08-12T12:00:00.000Z', contentType: 'application/pdf', previewKind: 'none', availabilityStatus: 'offline', thumbnailStatus: 'not_requested', lastIndexedAt: '2026-08-12T12:00:00.000Z', deletedAt: null },
    { _id: 'd'.repeat(24), storageRootId: ROOT_ID, relativePath: 'removed.docx', parentPath: '', name: 'removed.docx', entryType: 'file', sizeBytes: 10, modifiedAt: '2026-08-01T12:00:00.000Z', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', previewKind: 'none', availabilityStatus: 'unavailable', thumbnailStatus: 'not_requested', lastIndexedAt: '2026-08-01T12:00:00.000Z', deletedAt: '2026-08-12T12:00:00.000Z' },
  ];
  const makeQuery = (records) => {
    let result = records;
    const query = {
      sort(order) { result = [...result].sort(compare(order)); return query; },
      skip(count) { result = result.slice(count); return query; },
      limit(count) { result = result.slice(0, count); return query; },
      lean: async () => clone(result),
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    };
    return query;
  };
  const makeOneQuery = (record) => ({
    lean: async () => clone(record || null),
    then(resolve, reject) { return Promise.resolve(record || null).then(resolve, reject); },
  });
  return {
    NasStorageRootModel: {
      find(filter) { return makeQuery(roots.filter((root) => matches(root, filter))); },
      findOne(filter) { return makeOneQuery(roots.find((root) => matches(root, filter))); },
    },
    NasFileEntryModel: {
      find(filter) { return makeQuery(entries.filter((entry) => matches(entry, filter))); },
      findOne(filter) { return makeOneQuery(entries.find((entry) => matches(entry, filter))); },
    },
  };
};

const auth = (req, res, next) => {
  const role = req.header('authorization') === 'Bearer admin' ? 'admin'
    : req.header('authorization') === 'Bearer moderator' ? 'moderator' : 'regular';
  req.user = { uid: 'user-id', role };
  next();
};

const authorize = (req, res, next) => (
  ['admin', 'moderator'].includes(req.user.role) ? next() : res.status(403).json({ error: 'Denied' })
);

const startApp = async (dependencies = {}) => {
  const app = express();
  app.use(express.json());
  app.use('/api/nas-catalogue', createNasCatalogueRoutes({
    ...createModels(),
    authenticateMiddleware: auth,
    authorizeMiddleware: authorize,
    ...dependencies,
  }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};

const close = (server) => new Promise((resolve) => server.close(resolve));

test('catalogue lists only browsable roots and indexes only visible folder entries', async () => {
  const app = await startApp();
  try {
    const roots = await fetch(`${app.url}/api/nas-catalogue/roots`, { headers: { authorization: 'Bearer moderator' } });
    assert.equal(roots.status, 200);
    const rootPayload = await roots.json();
    assert.deepEqual(rootPayload.roots.map((root) => root.id), [OFFLINE_ROOT_ID, ROOT_ID]);
    assert.equal('connectorId' in rootPayload.roots[0], false);

    const listing = await fetch(`${app.url}/api/nas-catalogue/roots/${ROOT_ID}/entries?limit=1`, { headers: { authorization: 'Bearer moderator' } });
    assert.equal(listing.status, 200);
    const listingPayload = await listing.json();
    assert.equal(listingPayload.entries.length, 1);
    assert.equal(listingPayload.entries[0].entryType, 'folder');
    assert.equal(listingPayload.entries[0].relativePath, 'Design');
    assert.equal(listingPayload.nextCursor, '1');

    const pageTwo = await fetch(`${app.url}/api/nas-catalogue/roots/${ROOT_ID}/entries?limit=10&cursor=1`, { headers: { authorization: 'Bearer moderator' } });
    const pageTwoPayload = await pageTwo.json();
    assert.deepEqual(pageTwoPayload.entries.map((entry) => entry.name), ['brief.pdf']);
  } finally {
    await close(app.server);
  }
});

test('catalogue search is role-protected and rejects unsafe navigation input', async () => {
  const app = await startApp();
  try {
    const denied = await fetch(`${app.url}/api/nas-catalogue/roots/${ROOT_ID}/entries`, { headers: { authorization: 'Bearer regular' } });
    assert.equal(denied.status, 403);

    const traversal = await fetch(`${app.url}/api/nas-catalogue/roots/${ROOT_ID}/entries?parent=../secret`, { headers: { authorization: 'Bearer moderator' } });
    assert.equal(traversal.status, 400);

    const disabled = await fetch(`${app.url}/api/nas-catalogue/roots/${DISABLED_ROOT_ID}/entries`, { headers: { authorization: 'Bearer moderator' } });
    assert.equal(disabled.status, 404);

    const search = await fetch(`${app.url}/api/nas-catalogue/search?q=preview&rootId=${ROOT_ID}`, { headers: { authorization: 'Bearer moderator' } });
    assert.equal(search.status, 200);
    const searchPayload = await search.json();
    assert.deepEqual(searchPayload.entries.map((entry) => entry.name), ['preview.jpg']);
    assert.equal(searchPayload.entries[0].rootId, ROOT_ID);
  } finally {
    await close(app.server);
  }
});

test('catalogue returns only the adjacent images in the same folder', async () => {
  const app = await startApp();
  try {
    const response = await fetch(`${app.url}/api/nas-catalogue/entries/${'b'.repeat(24)}/image-neighbors`, {
      headers: { authorization: 'Bearer moderator' },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.previous?.name, 'cover.png');
    assert.equal(payload.next, null);
  } finally {
    await close(app.server);
  }
});

test('a moderator can create a preparing share and queue one opaque cache-delivery job', async () => {
  const queued = [];
  const shares = [];
  const app = await startApp({
    nasConfig: { cacheRetentionDays: 10 },
    fileServerConfig: { publicBaseUrl: 'http://localhost:5173' },
    jobQueue: {
      async enqueueCacheForDownload(request) {
        queued.push(request);
        return { created: true, job: { _id: 'f'.repeat(24), status: 'queued' } };
      },
    },
    FileShareModel: {
      async create(document) {
        const share = { _id: 'e'.repeat(24), ...document, createdAt: '2026-08-12T12:00:00.000Z' };
        shares.push(share);
        return share;
      },
      async findOneAndUpdate() { return null; },
    },
  });
  try {
    const response = await fetch(`${app.url}/api/nas-catalogue/entries/${'c'.repeat(24)}/shares`, {
      method: 'POST',
      headers: { authorization: 'Bearer moderator' },
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.match(payload.url, /^http:\/\/localhost:5173\/file-download\//);
    assert.equal(payload.share.deliveryStatus, 'preparing');
    assert.equal(shares[0].sourceType, 'nas_file');
    assert.equal(queued.length, 1);
    assert.deepEqual(queued[0], {
      connectorId: '1'.repeat(24),
      storageRootId: ROOT_ID,
      connectorRootId: 'office-projects',
      fileEntryId: 'c'.repeat(24),
      fileShareId: 'e'.repeat(24),
      requestedBy: 'user-id',
      waitForDelivery: false,
    });
  } finally {
    await close(app.server);
  }
});

test('an authenticated Open action reuses a current NAS cache object and returns an inline URL', async () => {
  const shares = [];
  const signed = [];
  const cachedEntry = {
    _id: 'c'.repeat(24),
    storageRootId: ROOT_ID,
    relativePath: 'brief.pdf',
    parentPath: '',
    name: 'brief.pdf',
    entryType: 'file',
    sizeBytes: 2048,
    versionFingerprint: 'version-1',
    cacheObjectKey: 'nas-cache/shares/old-share/content',
    cacheVersionFingerprint: 'version-1',
    cacheExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    deletedAt: null,
  };
  const matchesShare = (share, filter) => Object.entries(filter).every(([key, expected]) => share[key] === expected);
  const app = await startApp({
    nasConfig: { cacheRetentionDays: 10 },
    fileServerConfig: { publicBaseUrl: 'http://localhost:5173' },
    NasFileEntryModel: {
      findOne(filter) {
        return Promise.resolve(matches(cachedEntry, filter) ? cachedEntry : null);
      },
    },
    FileShareModel: {
      async create(document) {
        const share = {
          _id: 'e'.repeat(24),
          status: 'active',
          downloadCount: 0,
          ...document,
          createdAt: new Date().toISOString(),
        };
        shares.push(share);
        return share;
      },
      findOne(filter) {
        return Promise.resolve(shares.find((share) => matchesShare(share, filter)) || null);
      },
      async findOneAndUpdate() { return null; },
    },
    jobQueue: {
      async enqueueCacheForDownload() {
        throw new Error('A current cache object must not queue another upload.');
      },
    },
    cacheStorage: {
      async getDownloadUrl(request) {
        signed.push(request);
        return 'https://temporary.example/brief.pdf';
      },
    },
  });
  try {
    const open = await fetch(`${app.url}/api/nas-catalogue/entries/${'c'.repeat(24)}/deliveries`, {
      method: 'POST',
      headers: { authorization: 'Bearer moderator', 'content-type': 'application/json' },
      body: JSON.stringify({ disposition: 'inline' }),
    });
    assert.equal(open.status, 200);
    const payload = await open.json();
    assert.equal(payload.delivery.deliveryStatus, 'ready');
    assert.equal(payload.downloadUrl, 'https://temporary.example/brief.pdf');
    assert.equal(shares[0].s3Key, cachedEntry.cacheObjectKey);
    assert.deepEqual(signed[0], {
      key: cachedEntry.cacheObjectKey,
      fileName: 'brief.pdf',
      disposition: 'inline',
    });

    const download = await fetch(`${app.url}/api/nas-catalogue/deliveries/${shares[0]._id}?disposition=attachment`, {
      headers: { authorization: 'Bearer moderator' },
    });
    assert.equal(download.status, 200);
    assert.equal((await download.json()).downloadUrl, 'https://temporary.example/brief.pdf');
    assert.equal(signed[1].disposition, 'attachment');
  } finally {
    await close(app.server);
  }
});

test('opening a folder can queue one persistent thumbnail without exposing an image path', async () => {
  const queued = [];
  const imageEntry = {
    _id: 'b'.repeat(24),
    storageRootId: ROOT_ID,
    relativePath: 'Design/preview.jpg',
    parentPath: 'Design',
    name: 'preview.jpg',
    entryType: 'file',
    previewKind: 'image',
    versionFingerprint: 'version-1',
    thumbnailStatus: 'not_requested',
    deletedAt: null,
  };
  const app = await startApp({
    nasConfig: { cacheRetentionDays: 10, thumbnailPrefix: 'nas-thumbnails/' },
    fileServerConfig: { publicBaseUrl: 'http://localhost:5173' },
    NasFileEntryModel: {
      findOne(filter) { return Promise.resolve(matches(imageEntry, filter) ? imageEntry : null); },
      async findOneAndUpdate() { return imageEntry; },
    },
    jobQueue: {
      async enqueueThumbnail(request) {
        queued.push(request);
        return { created: true, job: { _id: 'f'.repeat(24) } };
      },
    },
  });
  try {
    const response = await fetch(`${app.url}/api/nas-catalogue/entries/${'b'.repeat(24)}/thumbnails`, {
      method: 'POST',
      headers: { authorization: 'Bearer moderator' },
    });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).thumbnailStatus, 'preparing');
    assert.deepEqual(queued, [{
      connectorId: '1'.repeat(24),
      storageRootId: ROOT_ID,
      connectorRootId: 'office-projects',
      fileEntryId: 'b'.repeat(24),
      versionFingerprint: 'version-1',
      requestedBy: 'user-id',
      waitForDelivery: false,
    }]);
  } finally {
    await close(app.server);
  }
});

test('a browser upload stages privately then queues one opaque NAS-write job', async () => {
  const jobs = [];
  const dispatched = [];
  const storageCalls = [];
  const setNested = (target, path, value) => {
    const keys = path.split('.');
    let current = target;
    for (const key of keys.slice(0, -1)) current = current[key] ||= {};
    current[keys.at(-1)] = value;
  };
  const transferJobs = {
    async create(document) {
      const job = { _id: 'f'.repeat(24), ...clone(document) };
      jobs.push(job);
      return job;
    },
    findOne(filter) {
      return Promise.resolve(jobs.find((job) => matches(job, filter)) || null);
    },
    async findOneAndUpdate(filter, update) {
      const job = jobs.find((candidate) => matches(candidate, filter));
      if (!job) return null;
      for (const [key, value] of Object.entries(update.$set || {})) setNested(job, key, value);
      for (const key of Object.keys(update.$unset || {})) {
        const parts = key.split('.');
        const parent = parts.slice(0, -1).reduce((current, part) => current?.[part], job);
        if (parent) delete parent[parts.at(-1)];
      }
      return job;
    },
  };
  const app = await startApp({
    nasConfig: {
      maxUploadBytes: 1_000_000,
      browserUploadUrlTtlSeconds: 60,
      uploadStagingPrefix: 'nas-upload-staging/',
    },
    fileServerConfig: { multipartPartSizeBytes: 5 * 1024 * 1024 },
    NasTransferJobModel: transferJobs,
    stagingStorage: {
      async createMultipartUpload() {
        storageCalls.push('start');
        return { key: 'nas-upload-staging/jobs/' + 'f'.repeat(24) + '/content', uploadId: 'opaque-s3-upload' };
      },
      async createMultipartPartUrls({ partNumbers }) {
        storageCalls.push('parts');
        return { parts: partNumbers.map((partNumber) => ({ partNumber, url: 'https://temporary.example/part/' + partNumber })) };
      },
      async completeMultipartUpload() { storageCalls.push('complete'); },
      async headFile() { return { ContentLength: 7 }; },
      async abortMultipartUpload() { storageCalls.push('abort'); },
    },
    jobQueue: {
      requestDispatch(connectorId) { dispatched.push(String(connectorId)); },
    },
  });
  try {
    const start = await fetch(app.url + '/api/nas-catalogue/roots/' + ROOT_ID + '/uploads', {
      method: 'POST',
      headers: { authorization: 'Bearer moderator', 'content-type': 'application/json' },
      body: JSON.stringify({
        parentPath: 'Design',
        fileName: 'from-browser.txt',
        sizeBytes: 7,
        contentType: 'text/plain',
      }),
    });
    assert.equal(start.status, 201);
    const started = await start.json();
    assert.deepEqual(Object.keys(started).sort(), ['maxParts', 'partSize', 'uploadId']);
    assert.equal(started.uploadId, 'f'.repeat(24));

    const parts = await fetch(app.url + '/api/nas-catalogue/uploads/' + started.uploadId + '/parts', {
      method: 'POST',
      headers: { authorization: 'Bearer moderator', 'content-type': 'application/json' },
      body: JSON.stringify({ partNumbers: [1] }),
    });
    assert.equal(parts.status, 200);
    assert.equal((await parts.json()).parts.length, 1);

    const complete = await fetch(app.url + '/api/nas-catalogue/uploads/' + started.uploadId + '/complete', {
      method: 'POST',
      headers: { authorization: 'Bearer moderator', 'content-type': 'application/json' },
      body: JSON.stringify({ parts: [{ partNumber: 1, eTag: 'etag-1' }] }),
    });
    assert.equal(complete.status, 200);
    const payload = await complete.json();
    assert.equal(payload.job.type, 'write_upload_to_nas');
    assert.equal(payload.job.status, 'queued');
    assert.equal('payload' in payload.job, false);
    assert.deepEqual(dispatched, ['1'.repeat(24)]);
    assert.deepEqual(storageCalls, ['start', 'parts', 'complete']);
  } finally {
    await close(app.server);
  }
});
