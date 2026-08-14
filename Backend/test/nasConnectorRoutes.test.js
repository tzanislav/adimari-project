'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const { createNasConnectorRoutes } = require('../routes/nasConnectorRoutes');
const { NasConnectorJobQueue } = require('../services/nasConnectorJobQueue');

const INSTALLATION_ID = 'a9d24d65-1a96-4f65-aa06-40c74c5934ac';
const ROOT = { connectorRootId: 'office-projects', displayName: 'Office Projects', uploadsEnabled: true };
const SHARED_ACCESS_KEY = 'Z2VuZXJhdGVkLWRldmljZS1zZWNyZXQtMzItYnl0ZXM';

const clone = (value) => JSON.parse(JSON.stringify(value));

const valueMatches = (actual, expected) => {
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    if ('$in' in expected) return expected.$in.includes(actual);
    if ('$ne' in expected) return actual !== expected.$ne;
    if ('$gt' in expected) return actual > expected.$gt;
    if ('$lte' in expected) return actual <= expected.$lte;
    if ('$regex' in expected) return new RegExp(expected.$regex).test(actual);
  }
  return actual === expected;
};

const matchesFilter = (record, filter) => Object.entries(filter)
  .every(([key, expected]) => (key === '$or'
    ? expected.some((clause) => matchesFilter(record, clause))
    : valueMatches(record[key], expected)));

const createInMemoryModels = () => {
  const connectors = [];
  const roots = [];
  const jobs = [];
  const fileEntries = [];
  const shares = [];
  const audits = [];
  let connectorSequence = 1;
  let jobSequence = 1;

  const applyUpdate = (record, update = {}) => {
    if (update.$set) Object.assign(record, update.$set);
    if (update.$unset) {
      Object.keys(update.$unset).forEach((key) => { delete record[key]; });
    }
    if (update.$inc) {
      Object.entries(update.$inc).forEach(([key, increment]) => {
        record[key] = (record[key] || 0) + increment;
      });
    }
    record.updatedAt = new Date();
    return record;
  };

  const ConnectorModel = {
    async create(document) {
      if (connectors.some((entry) => entry.installationId === document.installationId)) {
        const error = new Error('duplicate installation');
        error.code = 11000;
        throw error;
      }
      const record = {
        _id: `1${String(connectorSequence++).padStart(23, '0')}`,
        revokedAt: null,
        revokedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...document,
      };
      connectors.push(record);
      return record;
    },
    async findOne(filter) {
      return connectors.find((entry) => matchesFilter(entry, filter)) || null;
    },
    async findOneAndUpdate(filter, update) {
      const record = connectors.find((entry) => matchesFilter(entry, filter));
      if (!record) return null;
      Object.assign(record, update.$set, { updatedAt: new Date() });
      return record;
    },
    async updateMany(filter, update) {
      const matching = connectors.filter((entry) => matchesFilter(entry, filter));
      matching.forEach((entry) => Object.assign(entry, update.$set, { updatedAt: new Date() }));
      return { matchedCount: matching.length };
    },
    async deleteOne(filter) {
      const index = connectors.findIndex((entry) => entry._id === filter._id);
      if (index >= 0) connectors.splice(index, 1);
    },
    find() {
      return {
        sort() {
          return { lean: async () => clone(connectors) };
        },
      };
    },
  };

  const StorageRootModel = {
    async create(document) {
      const record = { _id: `2${String(roots.length + 1).padStart(23, '0')}`, ...document };
      roots.push(record);
      return record;
    },
    async findOneAndUpdate(filter, update) {
      let record = roots.find((entry) => entry.connectorId === filter.connectorId
        && entry.connectorRootId === filter.connectorRootId);
      if (!record && update && roots && filter && true) {
        record = { _id: `2${String(roots.length + 1).padStart(23, '0')}`, ...filter };
        roots.push(record);
      }
      Object.assign(record, update.$set);
      return record;
    },
    async findOne(filter) {
      return roots.find((entry) => matchesFilter(entry, filter)) || null;
    },
    find(filter) {
      const matching = roots.filter((entry) => matchesFilter(entry, filter));
      return {
        sort() {
          return { lean: async () => clone(matching) };
        },
      };
    },
    async updateMany(filter, update) {
      roots.filter((entry) => entry.connectorId === filter.connectorId)
        .forEach((entry) => Object.assign(entry, update.$set));
      return {};
    },
  };

  const TransferJobModel = {
    async create(document) {
      if (document.idempotencyKey
        && jobs.some((entry) => entry.idempotencyKey === document.idempotencyKey)) {
        const error = new Error('duplicate transfer-job idempotency key');
        error.code = 11000;
        throw error;
      }
      const createdAt = new Date();
      const record = {
        _id: `3${String(jobSequence++).padStart(23, '0')}`,
        attemptCount: 0,
        assignedAt: null,
        deliveryId: null,
        leaseExpiresAt: null,
        acceptedAt: null,
        createdAt,
        updatedAt: createdAt,
        ...document,
      };
      jobs.push(record);
      return record;
    },
    async findOne(filter) {
      return jobs.find((entry) => matchesFilter(entry, filter)) || null;
    },
    async findOneAndUpdate(filter, update, options = {}) {
      let matching = jobs.filter((entry) => matchesFilter(entry, filter));
      if (options.sort?.createdAt) {
        matching = matching.sort((left, right) => (
          options.sort.createdAt * (left.createdAt.getTime() - right.createdAt.getTime())
        ));
      }
      const record = matching[0] || null;
      return record ? applyUpdate(record, update) : null;
    },
    async updateMany(filter, update) {
      const matching = jobs.filter((entry) => matchesFilter(entry, filter));
      matching.forEach((entry) => applyUpdate(entry, update));
      return { matchedCount: matching.length };
    },
    find(filter) {
      let matching = jobs.filter((entry) => matchesFilter(entry, filter));
      const query = {
        sort(order) {
          if (order?.createdAt) {
            matching = [...matching].sort((left, right) => (
              order.createdAt * (left.createdAt.getTime() - right.createdAt.getTime())
            ));
          }
          return query;
        },
        limit(count) {
          matching = matching.slice(0, count);
          return query;
        },
        then(resolve, reject) {
          return Promise.resolve(matching).then(resolve, reject);
        },
      };
      return query;
    },
  };

  const FileEntryModel = {
    find(filter) {
      const matching = fileEntries.filter((entry) => matchesFilter(entry, filter));
      return {
        sort() {
          return { lean: async () => clone(matching) };
        },
      };
    },
    async bulkWrite(operations) {
      operations.forEach(({ updateOne }) => {
        let record = fileEntries.find((entry) => matchesFilter(entry, updateOne.filter));
        if (!record) {
          record = { ...updateOne.filter, ...(updateOne.update.$setOnInsert || {}) };
          fileEntries.push(record);
        }
        Object.assign(record, updateOne.update.$set || {});
      });
      return { modifiedCount: operations.length };
    },
    async updateMany(filter, update) {
      const matching = fileEntries.filter((entry) => matchesFilter(entry, filter));
      matching.forEach((entry) => applyUpdate(entry, update));
      return { matchedCount: matching.length };
    },
    async findOne(filter) {
      return fileEntries.find((entry) => matchesFilter(entry, filter)) || null;
    },
    async findOneAndUpdate(filter, update, options = {}) {
      if (update.$set && update.$setOnInsert
        && Object.keys(update.$set).some((key) => Object.hasOwn(update.$setOnInsert, key))) {
        const error = new Error('conflicting update operators');
        error.code = 40;
        throw error;
      }
      let record = fileEntries.find((entry) => matchesFilter(entry, filter));
      if (!record && options.upsert) {
        record = { ...filter, ...(update.$setOnInsert || {}) };
        fileEntries.push(record);
      }
      return record ? applyUpdate(record, update) : null;
    },
  };

  const FileShareModel = {
    async create(document) {
      const record = { _id: `5${String(shares.length + 1).padStart(23, '0')}`, ...document };
      shares.push(record);
      return record;
    },
    async findOne(filter) {
      return shares.find((entry) => matchesFilter(entry, filter)) || null;
    },
    async findOneAndUpdate(filter, update) {
      const record = shares.find((entry) => matchesFilter(entry, filter));
      return record ? applyUpdate(record, update) : null;
    },
  };

  return {
    ConnectorModel,
    StorageRootModel,
    TransferJobModel,
    FileEntryModel,
    FileShareModel,
    AuditEventModel: { async create(event) { audits.push(clone(event)); return event; } },
    state: { connectors, roots, jobs, fileEntries, shares, audits },
  };
};

const adminAuthentication = (req, res, next) => {
  if (req.header('authorization') === 'Bearer admin') {
    req.user = { uid: 'firebase-admin-id', role: 'admin' };
    return next();
  }
  if (req.header('authorization') === 'Bearer regular') {
    req.user = { uid: 'firebase-regular-id', role: 'regular' };
    return next();
  }
  return res.status(401).json({ code: 'UNAUTHORIZED' });
};

const adminAuthorization = (req, res, next) => (req.user?.role === 'admin'
  ? next()
  : res.status(403).json({ code: 'FORBIDDEN' }));

const startApp = async ({
  models,
  requireHttpsMiddleware,
  configOverrides = {},
  now,
  jobQueue,
  cacheStorage,
} = {}) => {
  const app = express();
  app.use(express.json());
  const dependencies = {
    config: {
      sharedSecret: SHARED_ACCESS_KEY,
      heartbeatIntervalSeconds: 30,
      recoveryStuckAfterMinutes: 30,
      ...configOverrides,
    },
    NasConnectorModel: models.ConnectorModel,
    NasStorageRootModel: models.StorageRootModel,
    NasTransferJobModel: models.TransferJobModel,
    NasFileEntryModel: models.FileEntryModel,
    FileShareModel: models.FileShareModel,
    NasAuditEventModel: models.AuditEventModel,
    authenticateMiddleware: adminAuthentication,
    authorizeAdminMiddleware: adminAuthorization,
  };
  if (jobQueue) dependencies.jobQueue = jobQueue;
  if (requireHttpsMiddleware) dependencies.requireHttpsMiddleware = requireHttpsMiddleware;
  if (now) dependencies.now = now;
  if (cacheStorage) dependencies.cacheStorage = cacheStorage;
  app.use('/api/nas-connectors', createNasConnectorRoutes(dependencies));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, () => resolve(listeningServer));
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};

const close = (server) => new Promise((resolve) => server.close(resolve));

const json = async (url, options = {}) => fetch(url, {
  ...options,
  headers: { 'content-type': 'application/json', ...(options.headers || {}) },
}).then(async (response) => ({
  response,
  body: response.status === 204 ? null : await response.json(),
}));

const connectSharedConnector = async (app, {
  installationId = INSTALLATION_ID,
  agentVersion = '0.1.0',
  root = ROOT,
} = {}) => {
  const response = await json(`${app.url}/api/nas-connectors/connect`, {
    method: 'POST',
    headers: { authorization: `ConnectorKey ${SHARED_ACCESS_KEY}` },
    body: JSON.stringify({ installationId, agentVersion, root }),
  });
  assert.equal(response.response.status, 200);
  return response.body.connector;
};

test('a shared connector key creates or reconnects an installation', async () => {
  const models = createInMemoryModels();
  const app = await startApp({
    models,
    requireHttpsMiddleware: (req, res, next) => next(),
  });
  try {
    const payload = {
      installationId: INSTALLATION_ID,
      agentVersion: '1.0.0',
      root: ROOT,
    };
    const denied = await json(`${app.url}/api/nas-connectors/connect`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert.equal(denied.response.status, 401);

    const connected = await json(`${app.url}/api/nas-connectors/connect`, {
      method: 'POST',
      headers: { authorization: `ConnectorKey ${SHARED_ACCESS_KEY}` },
      body: JSON.stringify(payload),
    });
    assert.equal(connected.response.status, 200);
    assert.equal(connected.body.connector.status, 'active');
    assert.equal(models.state.connectors.length, 1);
    assert.equal(models.state.roots.length, 1);

    const connectorId = connected.body.connector.id;
    const heartbeat = await json(`${app.url}/api/nas-connectors/control/heartbeat`, {
      method: 'POST',
      headers: { authorization: `Connector ${connectorId}` },
      body: JSON.stringify({ ...payload, state: 'ready', queueLength: 0 }),
    });
    assert.equal(heartbeat.response.status, 200);

    const reconnected = await json(`${app.url}/api/nas-connectors/connect`, {
      method: 'POST',
      headers: { authorization: `ConnectorKey ${SHARED_ACCESS_KEY}` },
      body: JSON.stringify({ ...payload, root: { ...ROOT, displayName: 'Updated Office Projects' } }),
    });
    assert.equal(reconnected.response.status, 200);
    assert.equal(reconnected.body.connector.id, connectorId);
    assert.equal(models.state.connectors.length, 1);
    assert.equal(models.state.roots[0].displayName, 'Updated Office Projects');
  } finally {
    await close(app.server);
  }
});

test('an authenticated connector receives and acknowledges one job over HTTPS polling', async () => {
  const models = createInMemoryModels();
  const jobQueue = new NasConnectorJobQueue({ NasTransferJobModel: models.TransferJobModel, leaseSeconds: 90 });
  const app = await startApp({ models, jobQueue, requireHttpsMiddleware: (req, res, next) => next() });
  try {
    const connection = await json(`${app.url}/api/nas-connectors/connect`, {
      method: 'POST',
      headers: { authorization: `ConnectorKey ${SHARED_ACCESS_KEY}` },
      body: JSON.stringify({ installationId: INSTALLATION_ID, agentVersion: '1.0.0', root: ROOT }),
    });
    const connectorId = connection.body.connector.id;
    const root = models.state.roots[0];
    const queued = await models.TransferJobModel.create({
      connectorId,
      storageRootId: root._id,
      connectorRootId: ROOT.connectorRootId,
      type: 'index_root',
      status: 'queued',
      payload: {},
    });
    const directPoll = await jobQueue.poll(connectorId);
    assert.equal(directPoll.jobId, queued._id);

    const polled = await json(`${app.url}/api/nas-connectors/control/jobs/poll`, {
      method: 'POST',
      headers: { authorization: `Connector ${connectorId}` },
      body: JSON.stringify({ waitSeconds: 0 }),
    });
    assert.equal(polled.response.status, 200);
    assert.equal(polled.body.assignment.jobId, queued._id);
    assert.equal(polled.body.assignment.jobType, 'index_root');
    assert.equal(models.state.jobs[0].status, 'assigned');

    const acknowledged = await json(`${app.url}/api/nas-connectors/control/jobs/ack`, {
      method: 'POST',
      headers: { authorization: `Connector ${connectorId}` },
      body: JSON.stringify({
        jobId: polled.body.assignment.jobId,
        deliveryId: polled.body.assignment.deliveryId,
        status: 'accepted',
      }),
    });
    assert.equal(acknowledged.response.status, 200);
    assert.deepEqual(acknowledged.body, { accepted: true, replay: false });
    assert.equal(models.state.jobs[0].status, 'accepted');
  } finally {
    await close(app.server);
  }
});

test('an administrator can re-enable a disabled shared-key connector without issuing a token', async () => {
  const models = createInMemoryModels();
  const app = await startApp({ models, requireHttpsMiddleware: (req, res, next) => next() });
  try {
    const payload = { installationId: INSTALLATION_ID, agentVersion: '1.0.0', root: ROOT };
    const connected = await json(`${app.url}/api/nas-connectors/connect`, {
      method: 'POST',
      headers: { authorization: `ConnectorKey ${SHARED_ACCESS_KEY}` },
      body: JSON.stringify(payload),
    });
    const connectorId = connected.body.connector.id;

    const disabled = await json(`${app.url}/api/nas-connectors/${connectorId}/revoke`, {
      method: 'POST', headers: { authorization: 'Bearer admin' }, body: '{}',
    });
    assert.equal(disabled.response.status, 200);
    assert.equal(models.state.connectors[0].status, 'revoked');
    assert.equal(models.state.roots[0].status, 'disabled');

    const enabled = await json(`${app.url}/api/nas-connectors/${connectorId}/enable`, {
      method: 'POST', headers: { authorization: 'Bearer admin' }, body: '{}',
    });
    assert.equal(enabled.response.status, 200);
    assert.equal(enabled.body.connector.status, 'offline');
    assert.equal(models.state.roots[0].status, 'active');

    const heartbeat = await json(`${app.url}/api/nas-connectors/control/heartbeat`, {
      method: 'POST',
      headers: { authorization: `Connector ${connectorId}` },
      body: JSON.stringify({ ...payload, state: 'ready', queueLength: 0 }),
    });
    assert.equal(heartbeat.response.status, 200);
    assert.equal(models.state.connectors[0].status, 'active');
  } finally {
    await close(app.server);
  }
});

test('heartbeat authenticates an enrolled connector ID and is refused after admin revocation', async () => {
  const models = createInMemoryModels();
  const app = await startApp({
    models,
    requireHttpsMiddleware: (req, res, next) => next(),
  });
  try {
    const connector = await connectSharedConnector(app);
    const connectorId = connector.id;
    const heartbeatPayload = {
      installationId: INSTALLATION_ID,
      agentVersion: '0.1.1',
      root: { ...ROOT, displayName: 'Renamed NAS Root', uploadsEnabled: false },
      state: 'ready',
      queueLength: 0,
    };
    const heartbeat = await json(`${app.url}/api/nas-connectors/control/heartbeat`, {
      method: 'POST',
      headers: { authorization: `Connector ${connectorId}` },
      body: JSON.stringify(heartbeatPayload),
    });
    assert.equal(heartbeat.response.status, 200);
    assert.equal(heartbeat.body.connector.agentVersion, '0.1.1');
    assert.equal(models.state.roots[0].uploadsEnabled, false);

    const wrongSecret = await json(`${app.url}/api/nas-connectors/control/heartbeat`, {
      method: 'POST',
      headers: { authorization: `Connector ${connectorId}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` },
      body: JSON.stringify(heartbeatPayload),
    });
    assert.equal(wrongSecret.response.status, 401);
    assert.equal(wrongSecret.body.code, 'NAS_CONNECTOR_UNAUTHORIZED');

    const revoked = await json(`${app.url}/api/nas-connectors/${connectorId}/revoke`, {
      method: 'POST', headers: { authorization: 'Bearer admin' }, body: '{}',
    });
    assert.equal(revoked.response.status, 200);
    assert.equal(revoked.body.connector.status, 'revoked');
    assert.equal(models.state.roots[0].status, 'disabled');

    const afterRevocation = await json(`${app.url}/api/nas-connectors/control/heartbeat`, {
      method: 'POST',
      headers: { authorization: `Connector ${connectorId}` },
      body: JSON.stringify(heartbeatPayload),
    });
    assert.equal(afterRevocation.response.status, 401);
  } finally {
    await close(app.server);
  }
});

test('an administrator can identify and stop a genuinely stale recovery job without replaying it', async () => {
  const models = createInMemoryModels();
  const currentTime = new Date('2026-08-13T12:00:00.000Z');
  const connectorId = '1'.repeat(24);
  const shareId = '5'.repeat(24);
  models.state.jobs.push({
    _id: '3'.repeat(24),
    connectorId,
    storageRootId: '2'.repeat(24),
    connectorRootId: ROOT.connectorRootId,
    type: 'cache_for_download',
    status: 'in_progress',
    payload: { fileEntryId: 'a'.repeat(24), fileShareId: shareId },
    updatedAt: new Date(currentTime.getTime() - (31 * 60 * 1_000)),
    createdAt: new Date(currentTime.getTime() - (31 * 60 * 1_000)),
  });
  models.state.shares.push({
    _id: shareId,
    status: 'active',
    deliveryStatus: 'preparing',
  });
  const app = await startApp({
    models,
    now: () => new Date(currentTime),
    requireHttpsMiddleware: (req, res, next) => next(),
  });
  try {
    const listed = await json(`${app.url}/api/nas-connectors/recovery/jobs`, {
      headers: { authorization: 'Bearer admin' },
    });
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.jobs.length, 1);
    assert.equal(listed.body.jobs[0].id, '3'.repeat(24));

    const stopped = await json(`${app.url}/api/nas-connectors/${connectorId}/jobs/${'3'.repeat(24)}/recovery/stop`, {
      method: 'POST', headers: { authorization: 'Bearer admin' }, body: '{}',
    });
    assert.equal(stopped.response.status, 200);
    assert.equal(stopped.body.job.status, 'failed');
    assert.equal(models.state.jobs[0].errorCode, 'operator_recovery_stopped');
    assert.equal(models.state.shares[0].deliveryStatus, 'failed');
    assert.equal(models.state.audits.at(-1).action, 'job_recovery_stopped');

    const repeated = await json(`${app.url}/api/nas-connectors/${connectorId}/jobs/${'3'.repeat(24)}/recovery/stop`, {
      method: 'POST', headers: { authorization: 'Bearer admin' }, body: '{}',
    });
    assert.equal(repeated.response.status, 409);
    assert.equal(repeated.body.code, 'NAS_CONNECTOR_JOB_NOT_STUCK');
  } finally {
    await close(app.server);
  }
});

test('admin listing persists a stale active connector as offline and a valid heartbeat restores it', async () => {
  const models = createInMemoryModels();
  let currentTime = new Date('2026-08-12T12:00:00.000Z');
  const app = await startApp({
    models,
    requireHttpsMiddleware: (req, res, next) => next(),
    configOverrides: { heartbeatStaleAfterSeconds: 90 },
    now: () => new Date(currentTime),
  });
  try {
    const connector = await connectSharedConnector(app);
    const connectorId = connector.id;
    assert.equal(models.state.connectors[0].status, 'active');

    currentTime = new Date(currentTime.getTime() + (91 * 1000));
    const staleList = await json(`${app.url}/api/nas-connectors`, {
      headers: { authorization: 'Bearer admin' },
    });
    assert.equal(staleList.response.status, 200);
    assert.equal(staleList.body.connectors[0].status, 'offline');
    assert.equal(models.state.connectors[0].status, 'offline');
    assert.equal(models.state.connectors[0].lastErrorCode, 'heartbeat_stale');

    const recovered = await json(`${app.url}/api/nas-connectors/control/heartbeat`, {
      method: 'POST',
      headers: { authorization: `Connector ${connectorId}` },
      body: JSON.stringify({
        installationId: INSTALLATION_ID,
        agentVersion: '0.1.1',
        root: ROOT,
        state: 'ready',
        queueLength: 0,
      }),
    });
    assert.equal(recovered.response.status, 200);
    assert.equal(recovered.body.connector.status, 'active');
    assert.equal(models.state.connectors[0].status, 'active');
    assert.equal(models.state.connectors[0].lastErrorCode, null);

    const freshList = await json(`${app.url}/api/nas-connectors`, {
      headers: { authorization: 'Bearer admin' },
    });
    assert.equal(freshList.response.status, 200);
    assert.equal(freshList.body.connectors[0].status, 'active');
  } finally {
    await close(app.server);
  }
});

test('admin can queue one idempotent index-root delivery job for an enabled connector root', async () => {
  const models = createInMemoryModels();
  const app = await startApp({ models, requireHttpsMiddleware: (req, res, next) => next() });
  try {
    const connector = await connectSharedConnector(app);
    const connectorId = connector.id;
    const jobUrl = `${app.url}/api/nas-connectors/${connectorId}/roots/${ROOT.connectorRootId}/index-jobs`;

    const denied = await json(jobUrl, {
      method: 'POST', headers: { authorization: 'Bearer regular' }, body: '{}',
    });
    assert.equal(denied.response.status, 403);

    const created = await json(jobUrl, {
      method: 'POST', headers: { authorization: 'Bearer admin' }, body: '{}',
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.created, true);
    assert.equal(created.body.job.type, 'index_root');
    assert.equal(created.body.job.status, 'queued');
    assert.equal(created.body.job.connectorRootId, ROOT.connectorRootId);
    assert.equal(models.state.jobs.length, 1);

    const repeated = await json(jobUrl, {
      method: 'POST', headers: { authorization: 'Bearer admin' }, body: '{}',
    });
    assert.equal(repeated.response.status, 200);
    assert.equal(repeated.body.created, false);
    assert.equal(repeated.body.job.id, created.body.job.id);
    assert.equal(models.state.jobs.length, 1);

    const listed = await json(`${app.url}/api/nas-connectors/${connectorId}/jobs`, {
      headers: { authorization: 'Bearer admin' },
    });
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.jobs.length, 1);
    assert.equal(listed.body.jobs[0].id, created.body.job.id);

    // An administrator can stop a scan even after the connector has accepted
    // and started it, after which a fresh scan can be requested.
    models.state.jobs[0].status = 'in_progress';
    const cancelled = await json(`${app.url}/api/nas-connectors/${connectorId}/jobs/${created.body.job.id}/cancel`, {
      method: 'POST', headers: { authorization: 'Bearer admin' }, body: '{}',
    });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.job.status, 'cancelled');
    assert.equal(models.state.jobs[0].idempotencyKey, undefined);

    const replacement = await json(jobUrl, {
      method: 'POST', headers: { authorization: 'Bearer admin' }, body: '{}',
    });
    assert.equal(replacement.response.status, 201);
    assert.notEqual(replacement.body.job.id, created.body.job.id);

    models.state.roots[0].status = 'disabled';
    const disabledRoot = await json(jobUrl, {
      method: 'POST', headers: { authorization: 'Bearer admin' }, body: '{}',
    });
    assert.equal(disabledRoot.response.status, 404);
  } finally {
    await close(app.server);
  }
});

test('admin can cancel an active thumbnail job without letting browser polling recreate it', async () => {
  const models = createInMemoryModels();
  const app = await startApp({ models, requireHttpsMiddleware: (req, res, next) => next() });
  try {
    const connector = await connectSharedConnector(app);
    const fileEntryId = '6'.repeat(24);
    const storageRootId = models.state.roots[0]._id;
    models.state.fileEntries.push({
      _id: fileEntryId,
      storageRootId,
      thumbnailStatus: 'preparing',
    });
    const thumbnail = await models.TransferJobModel.create({
      type: 'generate_thumbnail',
      status: 'in_progress',
      connectorId: connector.id,
      storageRootId,
      connectorRootId: ROOT.connectorRootId,
      idempotencyKey: `generate_thumbnail:${fileEntryId}:version-1`,
      payload: { fileEntryId },
    });

    const cancelled = await json(`${app.url}/api/nas-connectors/${connector.id}/jobs/${thumbnail._id}/cancel`, {
      method: 'POST', headers: { authorization: 'Bearer admin' }, body: '{}',
    });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.job.status, 'cancelled');
    assert.equal(models.state.jobs[0].idempotencyKey, undefined);
    assert.equal(models.state.fileEntries[0].thumbnailStatus, 'failed');
    assert.equal(models.state.audits.at(-1).action, 'thumbnail_cancelled');
  } finally {
    await close(app.server);
  }
});

test('a shared-key connector can request and immediately accept its own local index scan', async () => {
  const models = createInMemoryModels();
  const app = await startApp({ models, requireHttpsMiddleware: (req, res, next) => next() });
  try {
    const connector = await connectSharedConnector(app);
    const connectorId = connector.id;
    const request = () => json(`${app.url}/api/nas-connectors/control/index-requests`, {
      method: 'POST',
      headers: { authorization: `Connector ${connectorId}` },
      body: JSON.stringify({ connectorRootId: ROOT.connectorRootId }),
    });

    const first = await request();
    assert.equal(first.response.status, 201);
    assert.equal(first.body.created, true);
    assert.equal(first.body.job.status, 'accepted');
    assert.match(first.body.job.id, /^[0-9a-f]{24}$/);

    const repeated = await request();
    assert.equal(repeated.response.status, 200);
    assert.equal(repeated.body.created, false);
    assert.equal(repeated.body.job.id, first.body.job.id);
    assert.equal(models.state.jobs.length, 1);
  } finally {
    await close(app.server);
  }
});

test('an authenticated connector turns an accepted index job into a completed relative-path catalogue scan', async () => {
  const models = createInMemoryModels();
  const app = await startApp({ models, requireHttpsMiddleware: (req, res, next) => next() });
  const scanId = 'b9d24d65-1a96-4f65-aa06-40c74c5934ac';
  try {
    const connector = await connectSharedConnector(app);
    const connectorId = connector.id;
    const jobResponse = await json(
      `${app.url}/api/nas-connectors/${connectorId}/roots/${ROOT.connectorRootId}/index-jobs`,
      { method: 'POST', headers: { authorization: 'Bearer admin' }, body: '{}' },
    );
    const jobId = jobResponse.body.job.id;
    // Durable polling acknowledgement is separately covered; this route test
    // starts at the point where that acknowledgement has committed.
    models.state.jobs[0].status = 'accepted';
    const connectorHeaders = { authorization: `Connector ${connectorId}` };

    const started = await json(`${app.url}/api/nas-connectors/control/jobs/${jobId}/index/start`, {
      method: 'POST', headers: connectorHeaders, body: JSON.stringify({ scanId }),
    });
    assert.equal(started.response.status, 200);
    assert.equal(models.state.jobs[0].status, 'in_progress');
    assert.equal(models.state.jobs[0].scanId, scanId);

    // A full scan must make the same cache/thumbnail transition as a watcher
    // update when it observes a new version of an existing file.
    models.state.fileEntries.push({
      _id: '4'.repeat(24),
      storageRootId: models.state.roots[0]._id,
      relativePath: 'design/preview.jpg',
      parentPath: 'design',
      name: 'preview.jpg',
      entryType: 'file',
      sizeBytes: 1024,
      versionFingerprint: 'old-version',
      availabilityStatus: 'online',
      thumbnailStatus: 'ready',
      deletedAt: null,
    });

    const batch = await json(`${app.url}/api/nas-connectors/control/jobs/${jobId}/index/batches`, {
      method: 'POST',
      headers: connectorHeaders,
      body: JSON.stringify({
        scanId,
        entries: [{
          relativePath: 'design/preview.jpg',
          parentPath: 'design',
          name: 'preview.jpg',
          entryType: 'file',
          sizeBytes: 1024,
          modifiedAt: '2026-08-12T12:00:00.000Z',
          versionFingerprint: '8de0f1:400',
          contentType: 'image/jpeg',
          previewKind: 'image',
        }],
      }),
    });
    assert.equal(batch.response.status, 204);
    assert.equal(models.state.fileEntries.length, 1);
    assert.equal(models.state.fileEntries[0].relativePath, 'design/preview.jpg');
    assert.equal(models.state.fileEntries[0].lastSeenScanId, scanId);
    assert.equal(models.state.fileEntries[0].availabilityStatus, 'stale');
    assert.equal(models.state.fileEntries[0].thumbnailStatus, 'stale');

    const completed = await json(`${app.url}/api/nas-connectors/control/jobs/${jobId}/index/complete`, {
      method: 'POST', headers: connectorHeaders, body: JSON.stringify({ scanId, entryCount: 1 }),
    });
    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.job.status, 'completed');
    assert.equal(models.state.jobs[0].idempotencyKey, undefined);
    assert.ok(models.state.roots[0].lastFullScanAt);
    assert.equal(models.state.fileEntries[0].deletedAt, null);

    const completionRetry = await json(`${app.url}/api/nas-connectors/control/jobs/${jobId}/index/complete`, {
      method: 'POST', headers: connectorHeaders, body: JSON.stringify({ scanId, entryCount: 1 }),
    });
    assert.equal(completionRetry.response.status, 200);
    assert.equal(completionRetry.body.job.status, 'completed');
  } finally {
    await close(app.server);
  }
});

test('cache completion replays after the share became ready but the entry update failed', async () => {
  const models = createInMemoryModels();
  const cacheStorage = { async headFile() { return { ContentLength: 42 }; } };
  const app = await startApp({
    models,
    cacheStorage,
    requireHttpsMiddleware: (req, res, next) => next(),
    configOverrides: { cachePrefix: 'nas-cache/' },
  });
  try {
    const connector = await connectSharedConnector(app, { agentVersion: '1.0.0' });
    const connectorId = connector.id;
    const root = models.state.roots[0];
    const fileEntryId = 'a'.repeat(24);
    const fileShareId = 'b'.repeat(24);
    models.state.fileEntries.push({
      _id: fileEntryId,
      storageRootId: root._id,
      relativePath: 'design/preview.jpg',
      entryType: 'file',
      sizeBytes: 42,
      versionFingerprint: 'version-1',
      availabilityStatus: 'offline',
      thumbnailStatus: 'not_requested',
      deletedAt: null,
    });
    models.state.shares.push({
      _id: fileShareId,
      sourceType: 'nas_file',
      nasFileEntryId: fileEntryId,
      status: 'active',
      deliveryStatus: 'preparing',
      cacheExpiresAt: new Date(Date.now() + 60_000),
    });
    const job = await models.TransferJobModel.create({
      type: 'cache_for_download',
      status: 'in_progress',
      connectorId,
      storageRootId: root._id,
      connectorRootId: ROOT.connectorRootId,
      idempotencyKey: 'cache:replay',
      payload: { fileEntryId, fileShareId },
    });
    const originalUpdateEntry = models.FileEntryModel.findOneAndUpdate;
    let failEntryUpdateOnce = true;
    models.FileEntryModel.findOneAndUpdate = async (...args) => {
      if (failEntryUpdateOnce) {
        failEntryUpdateOnce = false;
        throw new Error('injected entry update failure');
      }
      return originalUpdateEntry(...args);
    };
    const request = {
      method: 'POST',
      headers: { authorization: `Connector ${connectorId}` },
      body: JSON.stringify({ versionFingerprint: 'version-1', sizeBytes: 42 }),
    };

    const failedAttempt = await json(`${app.url}/api/nas-connectors/control/jobs/${job._id}/cache/complete`, request);
    assert.equal(failedAttempt.response.status, 500);
    assert.equal(models.state.shares[0].deliveryStatus, 'ready');
    assert.equal(models.state.jobs[0].status, 'in_progress');

    const replay = await json(`${app.url}/api/nas-connectors/control/jobs/${job._id}/cache/complete`, request);
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.job.status, 'completed');
    assert.equal(models.state.fileEntries[0].availabilityStatus, 'online');
    assert.equal(models.state.fileEntries[0].cacheVersionFingerprint, 'version-1');
  } finally {
    await close(app.server);
  }
});

test('an authenticated connector applies small relative watcher updates without a full scan', async () => {
  const models = createInMemoryModels();
  const app = await startApp({ models, requireHttpsMiddleware: (req, res, next) => next() });
  try {
    const connector = await connectSharedConnector(app);
    const connectorId = connector.id;
    const headers = { authorization: `Connector ${connectorId}` };
    const send = (changes) => json(app.url + '/api/nas-connectors/control/catalogue/changes', {
      method: 'POST',
      headers,
      body: JSON.stringify({ connectorRootId: ROOT.connectorRootId, changes }),
    });
    const entry = (fingerprint, sizeBytes) => ({
      relativePath: 'design/live.txt',
      parentPath: 'design',
      name: 'live.txt',
      entryType: 'file',
      sizeBytes,
      modifiedAt: '2026-08-12T12:00:00.000Z',
      versionFingerprint: fingerprint,
      contentType: 'text/plain',
      previewKind: 'none',
    });

    const created = await send([{ operation: 'upsert', entry: entry('100:1', 1) }]);
    assert.equal(created.response.status, 204);
    assert.equal(models.state.fileEntries.length, 1);
    assert.equal(models.state.fileEntries[0].availabilityStatus, 'offline');

    const modified = await send([{ operation: 'upsert', entry: entry('101:2', 2) }]);
    assert.equal(modified.response.status, 204);
    assert.equal(models.state.fileEntries[0].availabilityStatus, 'stale');
    assert.equal(models.state.fileEntries[0].versionFingerprint, '101:2');

    const deleted = await send([{ operation: 'delete', relativePath: 'design', recursive: true }]);
    assert.equal(deleted.response.status, 204);
    assert.ok(models.state.fileEntries[0].deletedAt);

    const rejected = await send([{ operation: 'delete', relativePath: 'C:\\secret.txt', recursive: false }]);
    assert.equal(rejected.response.status, 400);
  } finally {
    await close(app.server);
  }
});

test('admin list remains protected and retired enrollment routes are absent', async () => {
  const models = createInMemoryModels();
  const app = await startApp({ models, requireHttpsMiddleware: (req, res, next) => next() });
  try {
    const denied = await json(`${app.url}/api/nas-connectors`, { headers: { authorization: 'Bearer regular' } });
    assert.equal(denied.response.status, 403);

    const retiredPaths = [
      '/api/nas-connectors/enrollment-tokens',
      '/api/nas-connectors/enroll',
      `/api/nas-connectors/${'1'.repeat(24)}/re-enrollment-tokens`,
    ];
    for (const path of retiredPaths) {
      const response = await fetch(`${app.url}${path}`, {
        method: 'POST', headers: { authorization: 'Bearer admin' }, body: '{}',
      });
      assert.equal(response.status, 404);
    }

    const list = await json(`${app.url}/api/nas-connectors`, { headers: { authorization: 'Bearer admin' } });
    assert.equal(list.response.status, 200);
    assert.deepEqual(list.body.connectors, []);
  } finally {
    await close(app.server);
  }
});

test('default connector transport guard refuses non-HTTPS connection requests', async () => {
  const models = createInMemoryModels();
  const app = await startApp({ models });
  try {
    const response = await json(`${app.url}/api/nas-connectors/connect`, { method: 'POST', body: '{}' });
    assert.equal(response.response.status, 400);
    assert.equal(response.body.code, 'NAS_CONNECTOR_HTTPS_REQUIRED');
  } finally {
    await close(app.server);
  }
});

test('an explicitly private HTTP connector setting bypasses only the transport guard', async () => {
  const models = createInMemoryModels();
  const app = await startApp({ models, configOverrides: { allowInsecureHttp: true } });
  try {
    const response = await json(`${app.url}/api/nas-connectors/connect`, { method: 'POST', body: '{}' });
    assert.equal(response.response.status, 401);
    assert.notEqual(response.body.code, 'NAS_CONNECTOR_HTTPS_REQUIRED');
  } finally {
    await close(app.server);
  }
});
