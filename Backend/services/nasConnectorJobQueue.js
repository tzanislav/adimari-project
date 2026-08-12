'use strict';

const crypto = require('crypto');
const {
  NasConnectorValidationError,
  normalizeConnectorRootId,
} = require('./nasConnectorValidation');

const INDEX_ROOT_JOB_TYPE = 'index_root';
// Phase 4 adds one narrow file operation. It copies one already-indexed file
// to the temporary share cache; it does not expose a NAS path to the backend.
const CACHE_FOR_DOWNLOAD_JOB_TYPE = 'cache_for_download';
const GENERATE_THUMBNAIL_JOB_TYPE = 'generate_thumbnail';
const WRITE_UPLOAD_TO_NAS_JOB_TYPE = 'write_upload_to_nas';
const DELIVERABLE_JOB_TYPES = Object.freeze([
  INDEX_ROOT_JOB_TYPE,
  CACHE_FOR_DOWNLOAD_JOB_TYPE,
  GENERATE_THUMBNAIL_JOB_TYPE,
  WRITE_UPLOAD_TO_NAS_JOB_TYPE,
]);
const ACTIVE_JOB_STATUSES = Object.freeze(['queued', 'assigned', 'accepted']);
// A thumbnail browser request polls while the connector is generating the
// image. Treat that running job as active too, otherwise a second poll races
// the unique idempotency key and incorrectly reports a duplicate-key error.
const ACTIVE_THUMBNAIL_JOB_STATUSES = Object.freeze([...ACTIVE_JOB_STATUSES, 'in_progress']);
const MANUAL_INDEX_ACTIVE_STATUSES = Object.freeze(['queued', 'assigned', 'accepted', 'in_progress']);
const ACKNOWLEDGEMENT_STATUSES = new Set(['accepted', 'duplicate']);
const JOB_ID_PATTERN = /^[0-9a-f]{24}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class NasConnectorJobQueueError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'NasConnectorJobQueueError';
    this.code = code;
    this.status = status;
  }
}

const connectorIdOf = (value) => String(value?._id || value?.id || value || '');

const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const isJobId = (value) => typeof value === 'string' && JOB_ID_PATTERN.test(value);

const isCanonicalUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);

const resolveQuery = async (query) => query;

const jobIdOf = (job) => String(job?._id || job?.id || '');

const toPlainObject = (value) => (typeof value?.toObject === 'function' ? value.toObject() : { ...value });

// Deliberately concise operator diagnostics. These identify the job/control
// flow without printing connector credentials, native paths, or payload data.
const traceIndex = (step, details = {}) => console.info('[NAS index]', step, details);

const serializeTransferJob = (job) => {
  const value = toPlainObject(job);
  return {
    id: jobIdOf(value),
    type: value.type,
    status: value.status,
    connectorId: connectorIdOf(value.connectorId),
    storageRootId: connectorIdOf(value.storageRootId),
    connectorRootId: value.connectorRootId || null,
    requestedBy: value.requestedBy || null,
    attemptCount: Number.isSafeInteger(value.attemptCount) ? value.attemptCount : 0,
    assignedAt: value.assignedAt || null,
    leaseExpiresAt: value.leaseExpiresAt || null,
    acceptedAt: value.acceptedAt || null,
    progressStage: value.progressStage || null,
    // For an index-root job, this is the count of metadata entries accepted
    // by the backend. Other transfer types will continue to use bytes.
    progressBytes: Number.isSafeInteger(value.progressBytes) ? value.progressBytes : 0,
    progressTotalBytes: Number.isSafeInteger(value.progressTotalBytes) ? value.progressTotalBytes : null,
    progressUpdatedAt: value.progressUpdatedAt || null,
    completedAt: value.completedAt || null,
    errorCode: value.errorCode || null,
    createdAt: value.createdAt || null,
    updatedAt: value.updatedAt || null,
  };
};

const normalizeAcknowledgement = (payload) => {
  if (!isPlainObject(payload)
    || Object.keys(payload).length !== 3
    || !Object.prototype.hasOwnProperty.call(payload, 'jobId')
    || !Object.prototype.hasOwnProperty.call(payload, 'deliveryId')
    || !Object.prototype.hasOwnProperty.call(payload, 'status')
    || !isJobId(payload.jobId)
    || !isCanonicalUuid(payload.deliveryId)
    || !ACKNOWLEDGEMENT_STATUSES.has(payload.status)) {
    throw new NasConnectorValidationError('Connector job acknowledgement is invalid.');
  }

  return {
    jobId: payload.jobId,
    deliveryId: payload.deliveryId.toLowerCase(),
    status: payload.status,
  };
};

const normalizeEmptyPayload = (value) => {
  if (!isPlainObject(value) || Object.keys(value).length !== 0) {
    throw new NasConnectorValidationError('Initial index job payload must be empty.');
  }
  return {};
};

const normalizeCacheForDownloadPayload = (value) => {
  if (!isPlainObject(value)
    || Object.keys(value).length !== 2
    || !isJobId(value.fileEntryId)
    || !isJobId(value.fileShareId)) {
    throw new NasConnectorValidationError('Cache-delivery job payload is invalid.');
  }
  return { fileEntryId: value.fileEntryId, fileShareId: value.fileShareId };
};

const normalizeThumbnailPayload = (value) => {
  if (!isPlainObject(value)
    || Object.keys(value).length !== 1
    || !isJobId(value.fileEntryId)) {
    throw new NasConnectorValidationError('Thumbnail job payload is invalid.');
  }
  return { fileEntryId: value.fileEntryId };
};

/**
 * Durable backend queue plus a tiny in-process bridge to the one active WSS
 * session. MongoDB remains the authority: the socket only carries a lease.
 * This service assumes the documented single Node/PM2 process deployment.
 */
class NasConnectorJobQueue {
  constructor({
    NasTransferJobModel,
    leaseSeconds = 90,
    now = () => new Date(),
    createDeliveryId = () => crypto.randomUUID(),
    resolveDeliveryTarget = null,
  } = {}) {
    if (!NasTransferJobModel) {
      throw new Error('NAS connector job queue requires a transfer-job model.');
    }
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 600) {
      throw new Error('NAS connector job queue lease must be between 15 and 600 seconds.');
    }

    this.NasTransferJobModel = NasTransferJobModel;
    this.leaseSeconds = leaseSeconds;
    this.now = now;
    this.createDeliveryId = createDeliveryId;
    this.resolveDeliveryTarget = typeof resolveDeliveryTarget === 'function'
      ? resolveDeliveryTarget
      : null;
    this.deliveryTargets = new Map();
    this.dispatching = new Map();
    this.leaseTimers = new Map();
    // Assignment message IDs are ephemeral socket correlations. They never
    // contain credentials or native paths and live only for the active socket
    // session, so a connector can safely repeat a lost acknowledgement.
    this.assignmentMessageIds = new Map();
  }

  async enqueueIndexRoot({
    connectorId,
    storageRootId,
    connectorRootId,
    requestedBy = null,
    waitForDelivery = true,
  } = {}) {
    const normalizedConnectorId = connectorIdOf(connectorId);
    const normalizedStorageRootId = connectorIdOf(storageRootId);
    const normalizedRootId = normalizeConnectorRootId(connectorRootId);
    if (!normalizedConnectorId || !normalizedStorageRootId) {
      throw new NasConnectorJobQueueError(
        'NAS_CONNECTOR_JOB_TARGET_INVALID',
        'Connector and storage root are required for an index job.',
      );
    }

    const idempotencyKey = `${INDEX_ROOT_JOB_TYPE}:${normalizedConnectorId}:${normalizedRootId}`;
    const existing = await resolveQuery(this.NasTransferJobModel.findOne({
      idempotencyKey,
      status: { $in: ACTIVE_JOB_STATUSES },
    }));
    if (existing) {
      // The same browser action is also a useful explicit retry for a job
      // whose original socket frame was lost. In particular, a server restart
      // loses in-memory lease timers but not the durable `assigned` row.
      await this.triggerDeliveryAfterQueueWrite(normalizedConnectorId, waitForDelivery);
      return { job: existing, created: false };
    }

    let job;
    try {
      job = await this.NasTransferJobModel.create({
        type: INDEX_ROOT_JOB_TYPE,
        status: 'queued',
        connectorId: normalizedConnectorId,
        storageRootId: normalizedStorageRootId,
        connectorRootId: normalizedRootId,
        idempotencyKey,
        requestedBy,
        payload: {},
      });
    } catch (error) {
      // The sparse unique idempotency key makes concurrent requests converge
      // on one pending job. This is the only concurrency machinery needed for
      // the small internal deployment.
      if (error?.code !== 11000) throw error;
      job = await resolveQuery(this.NasTransferJobModel.findOne({
        idempotencyKey,
        status: { $in: ACTIVE_JOB_STATUSES },
      }));
      if (!job) throw error;
      await this.triggerDeliveryAfterQueueWrite(normalizedConnectorId, waitForDelivery);
      return { job, created: false };
    }

    // There is nothing to send until the connector has a live WSS session.
    // Leaving the record queued avoids a short-lived no-target dispatch race;
    // registerDeliveryTarget immediately requests delivery when it connects.
    await this.triggerDeliveryAfterQueueWrite(normalizedConnectorId, waitForDelivery);
    return { job, created: true };
  }

  /**
   * Enqueues one cache copy for one active NAS share. The durable assignment
   * contains only database IDs; the connector later requests the current
   * relative path and a short-lived S3 upload URL over its authenticated API.
   */
  async enqueueCacheForDownload({
    connectorId,
    storageRootId,
    connectorRootId,
    fileEntryId,
    fileShareId,
    requestedBy = null,
    waitForDelivery = false,
  } = {}) {
    const normalizedConnectorId = connectorIdOf(connectorId);
    const normalizedStorageRootId = connectorIdOf(storageRootId);
    const normalizedRootId = normalizeConnectorRootId(connectorRootId);
    if (!normalizedConnectorId || !normalizedStorageRootId
      || !isJobId(String(fileEntryId)) || !isJobId(String(fileShareId))) {
      throw new NasConnectorJobQueueError(
        'NAS_CONNECTOR_JOB_TARGET_INVALID',
        'Connector, NAS root, file entry, and file share are required for cache delivery.',
      );
    }

    const idempotencyKey = `${CACHE_FOR_DOWNLOAD_JOB_TYPE}:${fileShareId}`;
    const existing = await resolveQuery(this.NasTransferJobModel.findOne({
      idempotencyKey,
      status: { $in: ACTIVE_JOB_STATUSES },
    }));
    if (existing) {
      this.triggerDeliveryAfterQueueWrite(normalizedConnectorId, waitForDelivery);
      return { job: existing, created: false };
    }

    const document = {
      type: CACHE_FOR_DOWNLOAD_JOB_TYPE,
      status: 'queued',
      connectorId: normalizedConnectorId,
      storageRootId: normalizedStorageRootId,
      connectorRootId: normalizedRootId,
      idempotencyKey,
      requestedBy,
      payload: { fileEntryId: String(fileEntryId), fileShareId: String(fileShareId) },
    };
    try {
      const job = await this.NasTransferJobModel.create(document);
      this.triggerDeliveryAfterQueueWrite(normalizedConnectorId, waitForDelivery);
      return { job, created: true };
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const job = await resolveQuery(this.NasTransferJobModel.findOne({
        idempotencyKey,
        status: { $in: ACTIVE_JOB_STATUSES },
      }));
      if (!job) throw error;
      this.triggerDeliveryAfterQueueWrite(normalizedConnectorId, waitForDelivery);
      return { job, created: false };
    }
  }

  async enqueueThumbnail({
    connectorId,
    storageRootId,
    connectorRootId,
    fileEntryId,
    versionFingerprint,
    requestedBy = null,
    waitForDelivery = false,
  } = {}) {
    const normalizedConnectorId = connectorIdOf(connectorId);
    const normalizedStorageRootId = connectorIdOf(storageRootId);
    const normalizedRootId = normalizeConnectorRootId(connectorRootId);
    if (!normalizedConnectorId || !normalizedStorageRootId
      || !isJobId(String(fileEntryId))
      || typeof versionFingerprint !== 'string' || !/^[A-Za-z0-9._:-]{1,512}$/.test(versionFingerprint)) {
      throw new NasConnectorJobQueueError(
        'NAS_CONNECTOR_JOB_TARGET_INVALID',
        'Connector, NAS root, image entry, and version are required for thumbnail delivery.',
      );
    }

    const idempotencyKey = `${GENERATE_THUMBNAIL_JOB_TYPE}:${fileEntryId}:${versionFingerprint}`;
    const existing = await resolveQuery(this.NasTransferJobModel.findOne({
      idempotencyKey,
      status: { $in: ACTIVE_THUMBNAIL_JOB_STATUSES },
    }));
    if (existing) {
      this.triggerDeliveryAfterQueueWrite(normalizedConnectorId, waitForDelivery);
      return { job: existing, created: false };
    }
    const document = {
      type: GENERATE_THUMBNAIL_JOB_TYPE,
      status: 'queued',
      connectorId: normalizedConnectorId,
      storageRootId: normalizedStorageRootId,
      connectorRootId: normalizedRootId,
      idempotencyKey,
      requestedBy,
      payload: { fileEntryId: String(fileEntryId) },
    };
    try {
      const job = await this.NasTransferJobModel.create(document);
      this.triggerDeliveryAfterQueueWrite(normalizedConnectorId, waitForDelivery);
      return { job, created: true };
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const job = await resolveQuery(this.NasTransferJobModel.findOne({
        idempotencyKey,
        status: { $in: ACTIVE_THUMBNAIL_JOB_STATUSES },
      }));
      if (!job) throw error;
      this.triggerDeliveryAfterQueueWrite(normalizedConnectorId, waitForDelivery);
      return { job, created: false };
    }
  }

  /**
   * Creates an already accepted index job for the connector's own local
   * Control Center. This intentionally bypasses WSS delivery: the local
   * service that makes this request persists the matching job immediately
   * before it starts scanning. It gives an operator an observable fallback
   * when the browser-to-control-channel dispatch has not yet completed.
   */
  async requestLocalIndexRoot({ connectorId, storageRootId, connectorRootId } = {}) {
    const normalizedConnectorId = connectorIdOf(connectorId);
    const normalizedStorageRootId = connectorIdOf(storageRootId);
    const normalizedRootId = normalizeConnectorRootId(connectorRootId);
    if (!normalizedConnectorId || !normalizedStorageRootId) {
      throw new NasConnectorJobQueueError(
        'NAS_CONNECTOR_JOB_TARGET_INVALID',
        'Connector and storage root are required for an index job.',
      );
    }

    const idempotencyKey = `${INDEX_ROOT_JOB_TYPE}:${normalizedConnectorId}:${normalizedRootId}`;
    const existing = await resolveQuery(this.NasTransferJobModel.findOne({
      idempotencyKey,
      status: { $in: MANUAL_INDEX_ACTIVE_STATUSES },
    }));
    if (existing) {
      return { job: await this.acceptForLocalRequest(existing, normalizedConnectorId), created: false };
    }

    const acceptedAt = this.now();
    try {
      const job = await this.NasTransferJobModel.create({
        type: INDEX_ROOT_JOB_TYPE,
        status: 'accepted',
        connectorId: normalizedConnectorId,
        storageRootId: normalizedStorageRootId,
        connectorRootId: normalizedRootId,
        idempotencyKey,
        payload: {},
        attemptCount: 1,
        acceptedAt,
      });
      return { job, created: true };
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const concurrent = await resolveQuery(this.NasTransferJobModel.findOne({
        idempotencyKey,
        status: { $in: MANUAL_INDEX_ACTIVE_STATUSES },
      }));
      if (!concurrent) throw error;
      return { job: await this.acceptForLocalRequest(concurrent, normalizedConnectorId), created: false };
    }
  }

  async acceptForLocalRequest(job, connectorId) {
    const value = toPlainObject(job);
    if (value.status !== 'queued' && value.status !== 'assigned') return job;

    const accepted = await resolveQuery(this.NasTransferJobModel.findOneAndUpdate(
      {
        _id: jobIdOf(value),
        connectorId,
        type: INDEX_ROOT_JOB_TYPE,
        status: { $in: ['queued', 'assigned'] },
      },
      {
        $set: {
          status: 'accepted',
          acceptedAt: this.now(),
          deliveryId: null,
          leaseExpiresAt: null,
          assignedAt: null,
        },
      },
      { new: true },
    ));
    return accepted || job;
  }

  async listForConnector(connectorId, { limit = 50 } = {}) {
    const safeLimit = Math.min(Math.max(Number.isSafeInteger(limit) ? limit : 50, 1), 100);
    let query = this.NasTransferJobModel.find({ connectorId: connectorIdOf(connectorId) });
    if (typeof query.sort === 'function') query = query.sort({ createdAt: -1 });
    if (typeof query.limit === 'function') query = query.limit(safeLimit);
    return resolveQuery(query);
  }

  async dispatchAfterQueueWrite(connectorId) {
    const key = connectorIdOf(connectorId);
    const delivered = await this.requestDispatch(key);
    if (delivered || !this.hasDeliveryTarget(key)) return delivered;

    // A live connection can register at the exact instant a new job is
    // written. Its first dispatch may have checked Mongo just before the job
    // existed; make one follow-up attempt after that in-flight check settles.
    return this.requestDispatch(key);
  }

  triggerDeliveryAfterQueueWrite(connectorId, waitForDelivery) {
    if (!this.hasDeliveryTarget(connectorId)) return;
    const dispatch = this.dispatchAfterQueueWrite(connectorId);
    if (waitForDelivery) return dispatch;
    void dispatch;
  }

  setDeliveryTargetResolver(resolveDeliveryTarget) {
    this.resolveDeliveryTarget = typeof resolveDeliveryTarget === 'function'
      ? resolveDeliveryTarget
      : null;
  }

  getDeliveryTarget(connectorId) {
    const key = connectorIdOf(connectorId);
    const resolved = this.resolveDeliveryTarget?.(key);
    if (typeof resolved === 'function') {
      return { sendAssignment: resolved, source: 'active_session' };
    }
    const registered = this.deliveryTargets.get(key);
    return registered ? { ...registered, source: 'registered_target' } : null;
  }

  hasDeliveryTarget(connectorId) {
    return Boolean(this.getDeliveryTarget(connectorId));
  }

  /**
   * Registers the current authenticated WSS session as the delivery target.
   * The callback returns the assignment message ID when it actually writes a
   * frame, or null/undefined when the socket is no longer usable.
   */
  registerDeliveryTarget(connectorId, sendAssignment) {
    const key = connectorIdOf(connectorId);
    if (!key || typeof sendAssignment !== 'function') {
      throw new Error('A connector ID and assignment sender are required.');
    }
    const target = { sendAssignment };
    this.deliveryTargets.set(key, target);
    traceIndex('delivery_target_registered', { connectorId: key });
    // A just-finished pre-connection dispatch may have observed no target.
    // Make one follow-up attempt in that narrow case so a queued job is not
    // left waiting until a reconnect or lease timer.
    const wasDispatching = this.dispatching.has(key);
    void this.requestDispatch(key).then((delivered) => {
      if (wasDispatching && !delivered && this.deliveryTargets.get(key) === target) {
        void this.requestDispatch(key);
      }
    });

    return () => {
      if (this.deliveryTargets.get(key) === target) {
        this.deliveryTargets.delete(key);
        traceIndex('delivery_target_removed', { connectorId: key });
        this.clearLeaseTimer(key);
        this.clearCorrelationsForConnector(key);
      }
    };
  }

  async requestDispatch(connectorId) {
    const key = connectorIdOf(connectorId);
    const current = this.dispatching.get(key);
    if (current) return current;

    const dispatch = this.dispatchOne(key)
      .catch((error) => {
        traceIndex('dispatch_failed', { connectorId: key, reason: error?.code || error?.name || 'unknown' });
        return false;
      })
      .finally(() => this.dispatching.delete(key));
    this.dispatching.set(key, dispatch);
    return dispatch;
  }

  async dispatchOne(connectorId) {
    const target = this.getDeliveryTarget(connectorId);
    if (!target) {
      traceIndex('dispatch_skipped_no_target', { connectorId });
      return false;
    }

    const job = await this.claimOrReuseLease(connectorId);
    if (!job) {
      traceIndex('dispatch_skipped_no_job', { connectorId });
      return false;
    }

    const assignment = this.toAssignment(job);
    traceIndex('assignment_sending', {
      connectorId,
      jobId: assignment.jobId,
      deliveryId: assignment.deliveryId,
      target: target.source,
    });
    this.clearCorrelationsForJob(connectorId, assignment.jobId, assignment.deliveryId);
    this.scheduleLeaseDispatch(connectorId, assignment.leaseExpiresAt);
    const messageId = await target.sendAssignment(assignment);
    if (!isCanonicalUuid(messageId)) {
      traceIndex('assignment_not_written', { connectorId, jobId: assignment.jobId });
      return false;
    }

    const correlationKey = this.correlationKey(connectorId, assignment.jobId, assignment.deliveryId);
    const knownMessageIds = this.assignmentMessageIds.get(correlationKey) || new Set();
    knownMessageIds.add(messageId.toLowerCase());
    this.assignmentMessageIds.set(correlationKey, knownMessageIds);
    traceIndex('assignment_written', { connectorId, jobId: assignment.jobId, messageId });
    return true;
  }

  async acknowledge({ connectorId, payload, replyTo } = {}) {
    const acknowledgement = normalizeAcknowledgement(payload);
    if (!isCanonicalUuid(replyTo)) return { accepted: false, replay: false };

    const key = connectorIdOf(connectorId);
    const correlationKey = this.correlationKey(key, acknowledgement.jobId, acknowledgement.deliveryId);
    const knownMessageIds = this.assignmentMessageIds.get(correlationKey);
    if (!knownMessageIds?.has(replyTo.toLowerCase())) {
      traceIndex('ack_rejected_unknown_assignment', { connectorId: key, jobId: acknowledgement.jobId, replyTo });
      return { accepted: false, replay: false };
    }

    const acceptedAt = this.now();
    const updated = await resolveQuery(this.NasTransferJobModel.findOneAndUpdate(
      {
        _id: acknowledgement.jobId,
        connectorId: key,
        type: { $in: DELIVERABLE_JOB_TYPES },
        status: 'assigned',
        deliveryId: acknowledgement.deliveryId,
        leaseExpiresAt: { $gt: acceptedAt },
      },
      {
        $set: {
          status: 'accepted',
          acceptedAt,
          leaseExpiresAt: null,
        },
      },
      { new: true },
    ));

    if (updated) {
      // Retain this bounded correlation while its socket session is active.
      // A connector may resend an acknowledgement after its successful frame
      // was lost; that must stay idempotent rather than become a protocol
      // error.
      this.clearLeaseTimer(key);
      traceIndex('ack_accepted', { connectorId: key, jobId: acknowledgement.jobId, deliveryId: acknowledgement.deliveryId });
      return { accepted: true, replay: acknowledgement.status === 'duplicate', job: updated };
    }

    // The server may have recorded a prior ack before the socket response was
    // lost. Treat an exact repeat as idempotent, never as a second execution.
    const alreadyAccepted = await resolveQuery(this.NasTransferJobModel.findOne({
      _id: acknowledgement.jobId,
      connectorId: key,
      type: { $in: DELIVERABLE_JOB_TYPES },
      status: 'accepted',
      deliveryId: acknowledgement.deliveryId,
    }));
    if (alreadyAccepted) {
      this.clearLeaseTimer(key);
      traceIndex('ack_replayed', { connectorId: key, jobId: acknowledgement.jobId, deliveryId: acknowledgement.deliveryId });
      return { accepted: true, replay: true, job: alreadyAccepted };
    }

    traceIndex('ack_rejected_state_mismatch', { connectorId: key, jobId: acknowledgement.jobId, deliveryId: acknowledgement.deliveryId });
    return { accepted: false, replay: false };
  }

  async claimOrReuseLease(connectorId) {
    const key = connectorIdOf(connectorId);
    const now = this.now();

    const activeLease = await resolveQuery(this.NasTransferJobModel.findOne({
      connectorId: key,
      type: { $in: DELIVERABLE_JOB_TYPES },
      status: 'assigned',
      leaseExpiresAt: { $gt: now },
    }));
    if (activeLease) return activeLease;

    // The connector deliberately owns one serial local queue.  Do not assign
    // the next job while it has already accepted or is executing one; its
    // completion endpoint explicitly requests the next durable dispatch.
    const activeExecution = await resolveQuery(this.NasTransferJobModel.findOne({
      connectorId: key,
      type: { $in: DELIVERABLE_JOB_TYPES },
      status: { $in: ['accepted', 'in_progress'] },
    }));
    if (activeExecution) return null;

    await this.NasTransferJobModel.updateMany(
      {
        connectorId: key,
        type: { $in: DELIVERABLE_JOB_TYPES },
        status: 'assigned',
        leaseExpiresAt: { $lte: now },
      },
      {
        $set: {
          status: 'queued',
          deliveryId: null,
          leaseExpiresAt: null,
          assignedAt: null,
        },
      },
    );

    const deliveryId = this.createDeliveryId().toLowerCase();
    if (!isCanonicalUuid(deliveryId)) {
      throw new Error('Job queue delivery ID generator returned an invalid value.');
    }
    const leaseExpiresAt = new Date(now.getTime() + (this.leaseSeconds * 1000));
    const claimed = await resolveQuery(this.NasTransferJobModel.findOneAndUpdate(
      {
        connectorId: key,
        type: { $in: DELIVERABLE_JOB_TYPES },
        status: 'queued',
      },
      {
        $set: {
          status: 'assigned',
          deliveryId,
          assignedAt: now,
          leaseExpiresAt,
        },
        $inc: { attemptCount: 1 },
      },
      { new: true, sort: { createdAt: 1 } },
    ));
    return claimed || null;
  }

  toAssignment(job) {
    const value = toPlainObject(job);
    const jobId = jobIdOf(value);
    const deliveryId = typeof value.deliveryId === 'string' ? value.deliveryId.toLowerCase() : '';
    const connectorRootId = normalizeConnectorRootId(value.connectorRootId);
    // Mongoose's default `minimize` setting removes an empty Mixed object
    // when persisting it. An omitted payload is therefore the normal stored
    // representation of this first index-root job's required empty payload.
    const payload = value.payload === undefined ? {} : value.payload;
    const leaseExpiresAt = value.leaseExpiresAt instanceof Date
      ? value.leaseExpiresAt
      : new Date(value.leaseExpiresAt);

    if (!isJobId(jobId)
      || !isCanonicalUuid(deliveryId)
      || !DELIVERABLE_JOB_TYPES.includes(value.type)
      || Number.isNaN(leaseExpiresAt.getTime())
      || !isPlainObject(payload)) {
      throw new NasConnectorJobQueueError(
        'NAS_CONNECTOR_JOB_INVALID',
        'Queued job cannot be delivered.',
        500,
      );
    }

    const normalizedPayload = value.type === WRITE_UPLOAD_TO_NAS_JOB_TYPE
      // Browser staging data is backend-private. The connector receives only
      // the job/root IDs and retrieves its relative path + signed download URL
      // through the authenticated upload/start endpoint.
      ? {}
      : value.type === INDEX_ROOT_JOB_TYPE
        ? normalizeEmptyPayload(payload)
      : value.type === CACHE_FOR_DOWNLOAD_JOB_TYPE
        ? normalizeCacheForDownloadPayload(payload)
        : normalizeThumbnailPayload(payload);

    return {
      jobId,
      deliveryId,
      jobType: value.type,
      connectorRootId,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      payload: normalizedPayload,
    };
  }

  correlationKey(connectorId, jobId, deliveryId) {
    return `${connectorIdOf(connectorId)}:${jobId}:${deliveryId}`;
  }

  clearLeaseTimer(connectorId) {
    const key = connectorIdOf(connectorId);
    const timer = this.leaseTimers.get(key);
    if (timer) clearTimeout(timer);
    this.leaseTimers.delete(key);
  }

  scheduleLeaseDispatch(connectorId, leaseExpiresAt) {
    const key = connectorIdOf(connectorId);
    const expiry = new Date(leaseExpiresAt);
    if (Number.isNaN(expiry.getTime())) return;
    this.clearLeaseTimer(key);
    // Keep a tiny boundary cushion so the database comparison observes an
    // expired lease even when timer scheduling is early by a few milliseconds.
    const delay = Math.max(10, expiry.getTime() - this.now().getTime() + 10);
    const timer = setTimeout(() => {
      this.leaseTimers.delete(key);
      void this.requestDispatch(key);
    }, Math.min(delay, 0x7fffffff));
    timer.unref?.();
    this.leaseTimers.set(key, timer);
  }

  clearCorrelationsForConnector(connectorId) {
    const prefix = `${connectorIdOf(connectorId)}:`;
    for (const correlationKey of this.assignmentMessageIds.keys()) {
      if (correlationKey.startsWith(prefix)) this.assignmentMessageIds.delete(correlationKey);
    }
  }

  clearCorrelationsForJob(connectorId, jobId, retainedDeliveryId) {
    const prefix = `${connectorIdOf(connectorId)}:${jobId}:`;
    const retainedKey = this.correlationKey(connectorId, jobId, retainedDeliveryId);
    for (const correlationKey of this.assignmentMessageIds.keys()) {
      if (correlationKey.startsWith(prefix) && correlationKey !== retainedKey) {
        this.assignmentMessageIds.delete(correlationKey);
      }
    }
  }
}

module.exports = {
  ACKNOWLEDGEMENT_STATUSES,
  ACTIVE_JOB_STATUSES,
  CACHE_FOR_DOWNLOAD_JOB_TYPE,
  DELIVERABLE_JOB_TYPES,
  GENERATE_THUMBNAIL_JOB_TYPE,
  INDEX_ROOT_JOB_TYPE,
  MANUAL_INDEX_ACTIVE_STATUSES,
  NasConnectorJobQueue,
  NasConnectorJobQueueError,
  isCanonicalUuid,
  isJobId,
  normalizeAcknowledgement,
  normalizeCacheForDownloadPayload,
  normalizeThumbnailPayload,
  serializeTransferJob,
  WRITE_UPLOAD_TO_NAS_JOB_TYPE,
};
