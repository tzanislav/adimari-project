'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  NasConnectorJobQueue,
  WRITE_UPLOAD_TO_NAS_JOB_TYPE,
} = require('../services/nasConnectorJobQueue');

const CONNECTOR_ID = '100000000000000000000001';
const STORAGE_ROOT_ID = '200000000000000000000001';
const ROOT_ID = 'office-projects';

const matchesValue = (actual, expected) => {
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    if ('$in' in expected) return expected.$in.includes(actual);
    if ('$gt' in expected) return actual > expected.$gt;
    if ('$lte' in expected) return actual <= expected.$lte;
  }
  return actual === expected;
};

const matches = (record, filter) => Object.entries(filter)
  .every(([key, expected]) => (key === '$or'
    ? expected.some((clause) => matches(record, clause))
    : matchesValue(record[key], expected)));

const createJobModel = () => {
  const records = [];
  let sequence = 1;

  const applyUpdate = (record, update = {}) => {
    if (update.$set) Object.assign(record, update.$set);
    if (update.$unset) Object.keys(update.$unset).forEach((key) => { delete record[key]; });
    if (update.$inc) {
      Object.entries(update.$inc).forEach(([key, amount]) => {
        record[key] = (record[key] || 0) + amount;
      });
    }
    record.updatedAt = new Date();
    return record;
  };

  return {
    records,
    async create(document) {
      if (document.idempotencyKey
        && records.some((entry) => entry.idempotencyKey === document.idempotencyKey)) {
        const error = new Error('duplicate idempotency key');
        error.code = 11000;
        throw error;
      }
      const createdAt = new Date();
      const record = {
        _id: sequence.toString(16).padStart(24, '0'),
        attemptCount: 0,
        assignedAt: null,
        deliveryId: null,
        leaseExpiresAt: null,
        acceptedAt: null,
        createdAt,
        updatedAt: createdAt,
        ...document,
      };
      sequence += 1;
      records.push(record);
      return record;
    },
    async findOne(filter) {
      return records.find((entry) => matches(entry, filter)) || null;
    },
    async findOneAndUpdate(filter, update, options = {}) {
      let matching = records.filter((entry) => matches(entry, filter));
      if (options.sort?.createdAt) {
        matching = matching.sort((left, right) => (
          options.sort.createdAt * (left.createdAt.getTime() - right.createdAt.getTime())
        ));
      }
      const record = matching[0] || null;
      return record ? applyUpdate(record, update) : null;
    },
    async updateMany(filter, update) {
      const matching = records.filter((entry) => matches(entry, filter));
      matching.forEach((entry) => applyUpdate(entry, update));
      return { matchedCount: matching.length };
    },
  };
};

const deliveryUuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

test('polling persists an index-root lease before accepting its acknowledgement and accepts an exact retry', async () => {
  const model = createJobModel();
  let currentTime = new Date('2026-08-12T12:00:00.000Z');
  let deliverySequence = 1;
  const queue = new NasConnectorJobQueue({
    NasTransferJobModel: model,
    leaseSeconds: 15,
    now: () => new Date(currentTime),
    createDeliveryId: () => deliveryUuid(deliverySequence++),
  });

  const first = await queue.enqueueIndexRoot({
    connectorId: CONNECTOR_ID,
    storageRootId: STORAGE_ROOT_ID,
    connectorRootId: ROOT_ID,
    requestedBy: 'admin-user',
  });
  const repeatedEnqueue = await queue.enqueueIndexRoot({
    connectorId: CONNECTOR_ID,
    storageRootId: STORAGE_ROOT_ID,
    connectorRootId: ROOT_ID,
    requestedBy: 'admin-user',
  });
  assert.equal(first.created, true);
  assert.equal(repeatedEnqueue.created, false);
  assert.equal(first.job._id, repeatedEnqueue.job._id);

  const firstAssignment = await queue.poll(CONNECTOR_ID);
  assert.deepEqual(Object.keys(firstAssignment).sort(), [
    'connectorRootId', 'deliveryId', 'jobId', 'jobType', 'leaseExpiresAt', 'payload',
  ]);
  assert.equal(model.records[0].status, 'assigned');

  const retriedAssignment = await queue.poll(CONNECTOR_ID);
  assert.equal(retriedAssignment.jobId, firstAssignment.jobId);
  assert.equal(retriedAssignment.deliveryId, firstAssignment.deliveryId);

  const acknowledgement = {
    jobId: firstAssignment.jobId,
    deliveryId: firstAssignment.deliveryId,
    status: 'accepted',
  };
  const accepted = await queue.acknowledgePolled({
    connectorId: CONNECTOR_ID,
    payload: acknowledgement,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.replay, false);
  assert.equal(model.records[0].status, 'accepted');
  assert.ok(model.records[0].acceptedAt);

  const replay = await queue.acknowledgePolled({
    connectorId: CONNECTOR_ID,
    payload: { ...acknowledgement, status: 'duplicate' },
  });
  assert.equal(replay.accepted, true);
  assert.equal(replay.replay, true);
});

test('HTTPS polling reuses a durable lease until its local receipt is acknowledged', async () => {
  const model = createJobModel();
  const queue = new NasConnectorJobQueue({
    NasTransferJobModel: model,
    leaseSeconds: 15,
    createDeliveryId: () => deliveryUuid(700),
  });
  const queued = await queue.enqueueIndexRoot({
    connectorId: CONNECTOR_ID,
    storageRootId: STORAGE_ROOT_ID,
    connectorRootId: ROOT_ID,
  });

  const first = await queue.poll(CONNECTOR_ID);
  const retry = await queue.poll(CONNECTOR_ID);
  assert.equal(first.jobId, queued.job._id);
  assert.equal(retry.jobId, first.jobId);
  assert.equal(retry.deliveryId, first.deliveryId);
  assert.equal(model.records[0].status, 'assigned');

  const accepted = await queue.acknowledgePolled({
    connectorId: CONNECTOR_ID,
    payload: { jobId: first.jobId, deliveryId: first.deliveryId, status: 'accepted' },
  });
  assert.equal(accepted.accepted, true);
  assert.equal(model.records[0].status, 'accepted');

  const replay = await queue.acknowledgePolled({
    connectorId: CONNECTOR_ID,
    payload: { jobId: first.jobId, deliveryId: first.deliveryId, status: 'duplicate' },
  });
  assert.equal(replay.accepted, true);
  assert.equal(replay.replay, true);
});

test('recovers an abandoned accepted job and prioritizes a requested file delivery', async () => {
  const model = createJobModel();
  const currentTime = new Date('2026-08-13T00:10:00.000Z');
  const queue = new NasConnectorJobQueue({
    NasTransferJobModel: model,
    leaseSeconds: 15,
    acceptedJobTimeoutSeconds: 120,
    now: () => new Date(currentTime),
    createDeliveryId: () => deliveryUuid(1),
  });

  const abandoned = await model.create({
    type: 'generate_thumbnail',
    status: 'accepted',
    connectorId: CONNECTOR_ID,
    storageRootId: STORAGE_ROOT_ID,
    connectorRootId: ROOT_ID,
    payload: { fileEntryId: 'a'.repeat(24) },
    acceptedAt: new Date(currentTime.getTime() - (5 * 60 * 1000)),
    deliveryId: deliveryUuid(99),
  });
  const requested = await model.create({
    type: 'cache_for_download',
    status: 'queued',
    connectorId: CONNECTOR_ID,
    storageRootId: STORAGE_ROOT_ID,
    connectorRootId: ROOT_ID,
    payload: { fileEntryId: 'b'.repeat(24), fileShareId: 'c'.repeat(24) },
  });

  const assignment = await queue.poll(CONNECTOR_ID);

  assert.equal(abandoned.status, 'queued');
  assert.equal(abandoned.acceptedAt, null);
  assert.equal(assignment.jobId, requested._id);
  assert.equal(assignment.jobType, 'cache_for_download');
});

test('watchdog fails an abandoned in-progress job and releases the next queued job', async () => {
  const model = createJobModel();
  const currentTime = new Date('2026-08-13T00:30:00.000Z');
  const queue = new NasConnectorJobQueue({
    NasTransferJobModel: model,
    leaseSeconds: 15,
    inProgressJobTimeoutSeconds: 60,
    now: () => new Date(currentTime),
    createDeliveryId: () => deliveryUuid(55),
  });
  const stuck = await model.create({
    type: 'generate_thumbnail',
    status: 'in_progress',
    connectorId: CONNECTOR_ID,
    storageRootId: STORAGE_ROOT_ID,
    connectorRootId: ROOT_ID,
    idempotencyKey: 'generate_thumbnail:stuck',
    payload: { fileEntryId: 'a'.repeat(24) },
    progressUpdatedAt: new Date(currentTime.getTime() - (2 * 60 * 1000)),
  });
  const next = await model.create({
    type: 'cache_for_download',
    status: 'queued',
    connectorId: CONNECTOR_ID,
    storageRootId: STORAGE_ROOT_ID,
    connectorRootId: ROOT_ID,
    payload: { fileEntryId: 'b'.repeat(24), fileShareId: 'c'.repeat(24) },
  });
  const assignment = await queue.poll(CONNECTOR_ID);

  assert.equal(stuck.status, 'failed');
  assert.equal(stuck.errorCode, 'connector_job_watchdog_timeout');
  assert.equal(stuck.idempotencyKey, undefined);
  assert.equal(assignment.jobId, next._id);
});

test('an expired delivery receives a new lease and an old acknowledgement cannot change it', async () => {
  const model = createJobModel();
  let currentTime = new Date('2026-08-12T12:00:00.000Z');
  let deliverySequence = 1;
  const queue = new NasConnectorJobQueue({
    NasTransferJobModel: model,
    leaseSeconds: 15,
    now: () => new Date(currentTime),
    createDeliveryId: () => deliveryUuid(deliverySequence++),
  });
  await queue.enqueueIndexRoot({
    connectorId: CONNECTOR_ID,
    storageRootId: STORAGE_ROOT_ID,
    connectorRootId: ROOT_ID,
  });

  const first = await queue.poll(CONNECTOR_ID);
  assert.ok(first);

  currentTime = new Date(currentTime.getTime() + (16 * 1000));
  const second = await queue.poll(CONNECTOR_ID);
  assert.ok(second);
  assert.notEqual(second.deliveryId, first.deliveryId);
  assert.equal(model.records[0].attemptCount, 2);

  const oldAcknowledgement = await queue.acknowledgePolled({
    connectorId: CONNECTOR_ID,
    payload: { jobId: first.jobId, deliveryId: first.deliveryId, status: 'accepted' },
  });
  assert.equal(oldAcknowledgement.accepted, false);
  assert.equal(model.records[0].status, 'assigned');

  const currentAcknowledgement = await queue.acknowledgePolled({
    connectorId: CONNECTOR_ID,
    payload: { jobId: second.jobId, deliveryId: second.deliveryId, status: 'duplicate' },
  });
  assert.equal(currentAcknowledgement.accepted, true);
  assert.equal(model.records[0].status, 'accepted');
});

test('delivers an index job when Mongoose has minimized its required empty payload', async () => {
  const model = createJobModel();
  const queue = new NasConnectorJobQueue({
    NasTransferJobModel: model,
    leaseSeconds: 15,
    createDeliveryId: () => deliveryUuid(99),
  });
  await queue.enqueueIndexRoot({
    connectorId: CONNECTOR_ID,
    storageRootId: STORAGE_ROOT_ID,
    connectorRootId: ROOT_ID,
  });
  // Mongoose removes empty Mixed fields with its default `minimize` option.
  delete model.records[0].payload;

  const assignment = await queue.poll(CONNECTOR_ID);

  assert.deepEqual(assignment.payload, {});
  assert.equal(model.records[0].status, 'assigned');
});

test('delivers one cache-for-download job with opaque file and share IDs', async () => {
  const model = createJobModel();
  const queue = new NasConnectorJobQueue({
    NasTransferJobModel: model,
    leaseSeconds: 15,
    createDeliveryId: () => deliveryUuid(77),
  });
  const fileEntryId = 'a'.repeat(24);
  const fileShareId = 'b'.repeat(24);
  const created = await queue.enqueueCacheForDownload({
    connectorId: CONNECTOR_ID,
    storageRootId: STORAGE_ROOT_ID,
    connectorRootId: ROOT_ID,
    fileEntryId,
    fileShareId,
  });
  assert.equal(created.created, true);

  const assignment = await queue.poll(CONNECTOR_ID);
  assert.equal(assignment.jobType, 'cache_for_download');
  assert.deepEqual(assignment.payload, { fileEntryId, fileShareId });

  const acknowledgement = await queue.acknowledgePolled({
    connectorId: CONNECTOR_ID,
    payload: {
      jobId: assignment.jobId,
      deliveryId: assignment.deliveryId,
      status: 'accepted',
    },
  });
  assert.equal(acknowledgement.accepted, true);
  assert.equal(model.records[0].status, 'accepted');
});

test('reuses a thumbnail job while its image generation is in progress', async () => {
  const model = createJobModel();
  const queue = new NasConnectorJobQueue({ NasTransferJobModel: model });
  const request = {
    connectorId: CONNECTOR_ID,
    storageRootId: STORAGE_ROOT_ID,
    connectorRootId: ROOT_ID,
    fileEntryId: 'a'.repeat(24),
    versionFingerprint: '20260812:123',
  };

  const first = await queue.enqueueThumbnail(request);
  model.records[0].status = 'in_progress';
  const repeated = await queue.enqueueThumbnail(request);

  assert.equal(first.created, true);
  assert.equal(repeated.created, false);
  assert.equal(repeated.job._id, first.job._id);
  assert.equal(model.records.length, 1);
});

test('reuses a manual index job while its scan is in progress', async () => {
  const model = createJobModel();
  const queue = new NasConnectorJobQueue({ NasTransferJobModel: model });
  const request = {
    connectorId: CONNECTOR_ID,
    storageRootId: STORAGE_ROOT_ID,
    connectorRootId: ROOT_ID,
  };

  const first = await queue.enqueueIndexRoot(request);
  model.records[0].status = 'in_progress';
  const repeated = await queue.enqueueIndexRoot(request);

  assert.equal(first.created, true);
  assert.equal(repeated.created, false);
  assert.equal(repeated.job._id, first.job._id);
  assert.equal(model.records.length, 1);
});

test('delivers an upload job without its backend-private staging payload', async () => {
  const model = createJobModel();
  const queue = new NasConnectorJobQueue({
    NasTransferJobModel: model,
    leaseSeconds: 15,
    createDeliveryId: () => deliveryUuid(88),
  });
  await model.create({
    type: WRITE_UPLOAD_TO_NAS_JOB_TYPE,
    status: 'queued',
    connectorId: CONNECTOR_ID,
    storageRootId: STORAGE_ROOT_ID,
    connectorRootId: ROOT_ID,
    requestedBy: 'browser-user',
    payload: {
      relativeDestinationPath: 'Design/from-browser.txt',
      expectedSize: 123,
      contentType: 'text/plain',
      stagingKey: 'nas-upload-staging/private/object',
    },
  });
  const assignment = await queue.poll(CONNECTOR_ID);

  assert.equal(assignment.jobType, WRITE_UPLOAD_TO_NAS_JOB_TYPE);
  assert.deepEqual(assignment.payload, {});
  assert.equal('stagingKey' in assignment.payload, false);
});
