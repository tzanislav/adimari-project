const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createProjectDirectoryRoutes } = require('../routes/projectDirectoryRoutes');
const { createProjectDirectoryStore, validateProject } = require('../services/projectDirectoryStore');
const { createProjectDirectoryHealth, isPublicAddress, requestStatus } = require('../services/projectDirectoryHealth');

test('project directory seeds once, persists edits, and keeps the existing order', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adimari-project-directory-'));
  try {
    const store = createProjectDirectoryStore({ dataDir });
    const seeded = await store.read();
    assert.equal(seeded.length, 12);
    assert.equal(seeded[0].title, 'Server Folder Explorer');
    assert.equal(seeded[0].access, 'mod');
    await store.update((projects) => { projects.unshift(projects.pop()); });
    const saved = await createProjectDirectoryStore({ dataDir }).read();
    assert.equal(saved[0].title, 'Email');
    assert.equal(saved.length, 12);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('project validation preserves internal and external links and rejects unsafe schemes', () => {
  const base = { title: 'Example', description: '', thumbnail: '', thumbnailAlt: '', access: 'admin', healthUrl: '' };
  assert.equal(validateProject({ ...base, link: { type: 'internal', value: '/projects/selection' } }).link.value, '/projects/selection');
  assert.equal(validateProject({ ...base, link: { type: 'external', value: 'https://example.com' } }).link.value, 'https://example.com');
  assert.throws(() => validateProject({ ...base, link: { type: 'external', value: 'javascript:alert(1)' } }));
  assert.throws(() => validateProject({ ...base, link: { type: 'internal', value: '//other-site.test' } }));
});

test('health worker checks external cards and leaves unconfigured internal cards untested', async () => {
  const projects = [
    { id: 'external', link: { type: 'external', value: 'https://example.com' }, healthUrl: '' },
    { id: 'internal', link: { type: 'internal', value: '/items' }, healthUrl: '' },
  ];
  const calls = [];
  const health = createProjectDirectoryHealth({ store: { read: async () => projects }, check: async (url) => { calls.push(url); return 200; } });
  await health.refresh();
  assert.deepEqual(calls, ['https://example.com']);
  assert.equal(health.get(projects[0]).state, 'live');
  assert.equal(health.get(projects[1]).state, 'not_checked');
});

test('health checks cannot connect to loopback or cloud metadata addresses', async () => {
  assert.equal(isPublicAddress('127.0.0.1'), false);
  assert.equal(isPublicAddress('169.254.169.254'), false);
  assert.equal(isPublicAddress('10.0.0.1'), false);
  assert.equal(isPublicAddress('54.76.118.84'), true);
  await assert.rejects(requestStatus('http://127.0.0.1:12345'), /Private or reserved address/);
});

test('directory API filters access, restricts edits, saves order, and serves uploaded thumbnails', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adimari-project-api-'));
  const verifyToken = async (token) => {
    if (['regular', 'moderator', 'admin'].includes(token)) return { role: token };
    throw Object.assign(new Error('Invalid token'), { code: 'auth/id-token-expired' });
  };
  const store = createProjectDirectoryStore({ dataDir });
  const app = express();
  app.use(express.json());
  app.use('/api/project-directory', createProjectDirectoryRoutes({
    store,
    health: { get: () => ({ state: 'not_checked', checkedAt: null }), invalidate: () => {} },
    verifyToken,
    authenticateMiddleware: async (req, res, next) => {
      try {
        req.user = await verifyToken(req.headers.authorization?.replace(/^Bearer /, ''));
        next();
      } catch { res.sendStatus(401); }
    },
    authorizeMiddleware: (req, res, next) => req.user.role === 'admin' ? next() : res.sendStatus(403),
  }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/project-directory`;
  const headers = (role) => ({ authorization: `Bearer ${role}`, 'content-type': 'application/json' });
  try {
    const publicList = await (await fetch(base)).json();
    const modList = await (await fetch(base, { headers: headers('moderator') })).json();
    const adminList = await (await fetch(base, { headers: headers('admin') })).json();
    assert.equal(publicList.length, 8);
    assert.equal(modList.length, 12);
    assert.equal(adminList.length, 12);
    assert.equal((await fetch(`${base}/manage`, { headers: headers('moderator') })).status, 403);
    assert.equal((await fetch(base, { headers: headers('expired') })).status, 401);

    const payload = {
      title: 'Private app', description: 'Admin destination',
      link: { type: 'external', value: 'https://example.com' },
      thumbnail: '', thumbnailAlt: '', access: 'admin', healthUrl: '',
    };
    assert.equal((await fetch(base, { method: 'POST', headers: headers('moderator'), body: JSON.stringify(payload) })).status, 403);
    const createdResponse = await fetch(base, { method: 'POST', headers: headers('admin'), body: JSON.stringify(payload) });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal((await (await fetch(base)).json()).length, 8);
    assert.equal((await (await fetch(base, { headers: headers('admin') })).json()).length, 13);

    const ids = (await store.read()).map((project) => project.id);
    const orderResponse = await fetch(`${base}/order`, {
      method: 'PUT', headers: headers('admin'),
      body: JSON.stringify({ ids: [created.id, ...ids.filter((id) => id !== created.id)] }),
    });
    assert.equal(orderResponse.status, 204);
    assert.equal((await store.read())[0].id, created.id);

    const image = await fs.readFile(path.join(__dirname, '../../front-end/public/file.png'));
    const form = new FormData();
    form.append('image', new Blob([image], { type: 'image/png' }), 'file.png');
    const uploadResponse = await fetch(`${base}/images`, { method: 'POST', headers: { authorization: 'Bearer admin' }, body: form });
    assert.equal(uploadResponse.status, 201);
    const uploaded = await uploadResponse.json();
    const served = await fetch(`http://127.0.0.1:${server.address().port}${uploaded.path}`);
    assert.equal(served.status, 200);
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), image);

    const updateResponse = await fetch(`${base}/${created.id}`, {
      method: 'PUT', headers: headers('admin'),
      body: JSON.stringify({ ...payload, thumbnail: uploaded.path }),
    });
    assert.equal(updateResponse.status, 200);

    assert.equal((await fetch(`${base}/${created.id}`, { method: 'DELETE', headers: headers('admin') })).status, 204);
    assert.equal((await store.read()).length, 12);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${uploaded.path}`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
