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
  .every(([key, expected]) => matchesValue(record[key], expected));

const createJobModel = () => {
  const records = [];
  let sequence = 1;

  const applyUpdate = (record, update = {}) => {
    if (update.$set) Object.assign(record, update.$set);
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

test('persists an index-root assignment before accepting its acknowledgement and accepts an exact retry', async () => {
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

  const assignments = [];
  const unregister = queue.registerDeliveryTarget(CONNECTOR_ID, async (assignment) => {
    assignments.push(assignment);
    return deliveryUuid(100 + assignments.length);
  });
  await queue.requestDispatch(CONNECTOR_ID);
  assert.equal(assignments.length, 1);
  assert.deepEqual(Object.keys(assignments[0]).sort(), [
    'connectorRootId', 'deliveryId', 'jobId', 'jobType', 'leaseExpiresAt', 'payload',
  ]);
  assert.equal(model.records[0].status, 'assigned');

  // Repeating the admin request is an explicit delivery retry, not merely a
  // passive duplicate response. It keeps the same durable lease/job but sends
  // another correlated assignment frame to the live Connector session.
  const retriedEnqueue = await queue.enqueueIndexRoot({
    connectorId: CONNECTOR_ID,
    storageRootId: STORAGE_ROOT_ID,
    connectorRootId: ROOT_ID,
    requestedBy: 'admin-user',
  });
  assert.equal(retriedEnqueue.created, false);
  assert.equal(assignments.length, 2);
  assert.equal(assignments[1].jobId, assignments[0].jobId);
  assert.equal(assignments[1].deliveryId, assignments[0].deliveryId);

  const acknowledgement = {
    jobId: assignments[0].jobId,
    deliveryId: assignments[0].deliveryId,
    status: 'accepted',
  };
  const replyTo = deliveryUuid(101);
  const accepted = await queue.acknowledge({
    connectorId: CONNECTOR_ID,
    payload: acknowledgement,
    replyTo,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.replay, false);
  assert.equal(model.records[0].status, 'accepted');
  assert.ok(model.records[0].acceptedAt);

  const replay = await queue.acknowledge({
    connectorId: CONNECTOR_ID,
    payload: { ...acknowledgement, status: 'duplicate' },
    replyTo,
  });
  assert.equal(replay.accepted, true);
  assert.equal(replay.replay, true);
  unregister();
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

  const assignments = [];
  const unregister = queue.registerDeliveryTarget(CONNECTOR_ID, async (assignment) => {
    assignments.push(assignment);
    return deliveryUuid(200 + assignments.length);
  });
  await queue.requestDispatch(CONNECTOR_ID);
  const first = assignments[0];
  assert.ok(first);

  currentTime = new Date(currentTime.getTime() + (16 * 1000));
  await queue.requestDispatch(CONNECTOR_ID);
  const second = assignments[1];
  assert.ok(second);
  assert.notEqual(second.deliveryId, first.deliveryId);
  assert.equal(model.records[0].attemptCount, 2);

  const oldAcknowledgement = await queue.acknowledge({
    connectorId: CONNECTOR_ID,
    payload: { jobId: first.jobId, deliveryId: first.deliveryId, status: 'accepted' },
    replyTo: deliveryUuid(201),
  });
  assert.equal(oldAcknowledgement.accepted, false);
  assert.equal(model.records[0].status, 'assigned');

  const currentAcknowledgement = await queue.acknowledge({
    connectorId: CONNECTOR_ID,
    payload: { jobId: second.jobId, deliveryId: second.deliveryId, status: 'duplicate' },
    replyTo: deliveryUuid(202),
  });
  assert.equal(currentAcknowledgement.accepted, true);
  assert.equal(model.records[0].status, 'accepted');
  unregister();
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

  const assignments = [];
  const unregister = queue.registerDeliveryTarget(CONNECTOR_ID, async (assignment) => {
    assignments.push(assignment);
    return deliveryUuid(299);
  });
  await queue.requestDispatch(CONNECTOR_ID);

  assert.equal(assignments.length, 1);
  assert.deepEqual(assignments[0].payload, {});
  assert.equal(model.records[0].status, 'assigned');
  unregister();
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

  const assignments = [];
  const unregister = queue.registerDeliveryTarget(CONNECTOR_ID, async (assignment) => {
    assignments.push(assignment);
    return deliveryUuid(377);
  });
  await queue.requestDispatch(CONNECTOR_ID);
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].jobType, 'cache_for_download');
  assert.deepEqual(assignments[0].payload, { fileEntryId, fileShareId });

  const acknowledgement = await queue.acknowledge({
    connectorId: CONNECTOR_ID,
    payload: {
      jobId: assignments[0].jobId,
      deliveryId: assignments[0].deliveryId,
      status: 'accepted',
    },
    replyTo: deliveryUuid(377),
  });
  assert.equal(acknowledgement.accepted, true);
  assert.equal(model.records[0].status, 'accepted');
  unregister();
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
  const assignments = [];
  const unregister = queue.registerDeliveryTarget(CONNECTOR_ID, async (assignment) => {
    assignments.push(assignment);
    return deliveryUuid(388);
  });
  await queue.requestDispatch(CONNECTOR_ID);

  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].jobType, WRITE_UPLOAD_TO_NAS_JOB_TYPE);
  assert.deepEqual(assignments[0].payload, {});
  assert.equal('stagingKey' in assignments[0].payload, false);
  unregister();
});
