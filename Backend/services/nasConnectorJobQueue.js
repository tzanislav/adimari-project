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
// A person waiting to open/download a file should never sit behind a large
// background thumbnail backlog. The connector still processes one job at a
// time; this only decides which queued job gets that next slot.
const DELIVERY_PRIORITY = Object.freeze([
  CACHE_FOR_DOWNLOAD_JOB_TYPE,
  WRITE_UPLOAD_TO_NAS_JOB_TYPE,
  GENERATE_THUMBNAIL_JOB_TYPE,
  INDEX_ROOT_JOB_TYPE,
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
 * Durable backend queue for one serial connector. MongoDB remains the
 * authority; authenticated HTTPS polling reads only a short-lived lease.
 */
class NasConnectorJobQueue {
  constructor({
    NasTransferJobModel,
    leaseSeconds = 90,
    acceptedJobTimeoutSeconds = 120,
    inProgressJobTimeoutSeconds = 20 * 60,
    now = () => new Date(),
    createDeliveryId = () => crypto.randomUUID(),
  } = {}) {
    if (!NasTransferJobModel) {
      throw new Error('NAS connector job queue requires a transfer-job model.');
    }
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 600) {
      throw new Error('NAS connector job queue lease must be between 15 and 600 seconds.');
    }
    if (!Number.isSafeInteger(acceptedJobTimeoutSeconds) || acceptedJobTimeoutSeconds < 30 || acceptedJobTimeoutSeconds > 3_600) {
      throw new Error('NAS connector accepted-job timeout must be between 30 and 3600 seconds.');
    }
    if (!Number.isSafeInteger(inProgressJobTimeoutSeconds) || inProgressJobTimeoutSeconds < 60 || inProgressJobTimeoutSeconds > 86_400) {
      throw new Error('NAS connector in-progress-job timeout must be between 60 and 86400 seconds.');
    }

    this.NasTransferJobModel = NasTransferJobModel;
    this.leaseSeconds = leaseSeconds;
    this.acceptedJobTimeoutSeconds = acceptedJobTimeoutSeconds;
    this.inProgressJobTimeoutSeconds = inProgressJobTimeoutSeconds;
    this.now = now;
    this.createDeliveryId = createDeliveryId;
  }

  async enqueueIndexRoot({
    connectorId,
    storageRootId,
    connectorRootId,
    requestedBy = null,
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
      status: { $in: MANUAL_INDEX_ACTIVE_STATUSES },
    }));
    if (existing) {
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
        status: { $in: MANUAL_INDEX_ACTIVE_STATUSES },
      }));
      if (!job) throw error;
      return { job, created: false };
    }

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
      return { job, created: true };
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const job = await resolveQuery(this.NasTransferJobModel.findOne({
        idempotencyKey,
        status: { $in: ACTIVE_JOB_STATUSES },
      }));
      if (!job) throw error;
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
      return { job, created: true };
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const job = await resolveQuery(this.NasTransferJobModel.findOne({
        idempotencyKey,
        status: { $in: ACTIVE_THUMBNAIL_JOB_STATUSES },
      }));
      if (!job) throw error;
      return { job, created: false };
    }
  }

  /**
   * Creates an already accepted index job for the connector's own local
   * Control Center. This intentionally bypasses remote delivery: the local
   * service that makes this request persists the matching job immediately
   * before it starts scanning. It gives an operator an observable fallback
   * when a browser-requested remote delivery has not yet completed.
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

  // HTTPS polling owns delivery in the simplified transport. Reusing the
  // existing lease means a lost HTTP response is harmless: the next poll sees
  // the same assignment until the connector durably acknowledges it.
  async poll(connectorId) {
    const job = await this.claimOrReuseLease(connectorId);
    return job ? this.toAssignment(job) : null;
  }

  async acknowledgePolled({ connectorId, payload } = {}) {
    const acknowledgement = normalizeAcknowledgement(payload);
    const key = connectorIdOf(connectorId);
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
      traceIndex('poll_ack_accepted', { connectorId: key, jobId: acknowledgement.jobId, deliveryId: acknowledgement.deliveryId });
      return { accepted: true, replay: acknowledgement.status === 'duplicate', job: updated };
    }

    const alreadyAccepted = await resolveQuery(this.NasTransferJobModel.findOne({
      _id: acknowledgement.jobId,
      connectorId: key,
      type: { $in: DELIVERABLE_JOB_TYPES },
      status: 'accepted',
      deliveryId: acknowledgement.deliveryId,
    }));
    if (alreadyAccepted) {
      traceIndex('poll_ack_replayed', { connectorId: key, jobId: acknowledgement.jobId, deliveryId: acknowledgement.deliveryId });
      return { accepted: true, replay: true, job: alreadyAccepted };
    }

    traceIndex('poll_ack_rejected_state_mismatch', { connectorId: key, jobId: acknowledgement.jobId, deliveryId: acknowledgement.deliveryId });
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

    // Persisting the acknowledgement before execution protects against a
    // lost poll response. A service crash in the small gap immediately after
    // that acknowledgement used to leave the job "accepted" forever, which
    // blocked every later delivery. Workers change to in_progress before
    // doing real work, so an old accepted state is safe to retry.
    const acceptedBefore = new Date(now.getTime() - (this.acceptedJobTimeoutSeconds * 1000));
    const recovered = await this.NasTransferJobModel.updateMany(
      {
        connectorId: key,
        type: { $in: DELIVERABLE_JOB_TYPES },
        status: 'accepted',
        acceptedAt: { $lte: acceptedBefore },
      },
      {
        $set: {
          status: 'queued',
          deliveryId: null,
          leaseExpiresAt: null,
          assignedAt: null,
          acceptedAt: null,
        },
      },
    );
    if (recovered?.matchedCount) {
      traceIndex('recovered_abandoned_accepted_jobs', { connectorId: key, count: recovered.matchedCount });
    }

    // A connector can be powered off or lose its local state while a job is
    // running.  Treat an unchanged in-progress record as a terminal remote
    // failure after a generous window so one bad cache/thumbnail/upload cannot
    // monopolize the connector forever. A later Phase 2 runner will replace
    // this with per-handler retry policy; this watchdog is the safe floor.
    const inProgressBefore = new Date(now.getTime() - (this.inProgressJobTimeoutSeconds * 1000));
    const abandoned = await this.NasTransferJobModel.updateMany(
      {
        connectorId: key,
        type: { $in: DELIVERABLE_JOB_TYPES },
        status: 'in_progress',
        $or: [
          { progressUpdatedAt: { $lte: inProgressBefore } },
          { progressUpdatedAt: null, updatedAt: { $lte: inProgressBefore } },
        ],
      },
      {
        $set: {
          status: 'failed',
          completedAt: now,
          errorCode: 'connector_job_watchdog_timeout',
          errorMessage: 'The connector stopped reporting progress before the job completed.',
        },
        $unset: { idempotencyKey: 1 },
      },
    );
    if (abandoned?.matchedCount) {
      traceIndex('failed_abandoned_in_progress_jobs', { connectorId: key, count: abandoned.matchedCount });
    }

    // The connector deliberately owns one serial local queue.  Do not assign
    // the next job while it has already accepted or is executing one; its
    // completion endpoint lets the next poll claim subsequent work.
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
    for (const type of DELIVERY_PRIORITY) {
      const claimed = await resolveQuery(this.NasTransferJobModel.findOneAndUpdate(
        {
          connectorId: key,
          type,
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
        // Cache jobs are created by an active browser action; use the newest
        // one first so an old abandoned request cannot make the person who is
        // currently waiting for a file appear stuck. Background work remains
        // FIFO within its own class.
        { new: true, sort: { createdAt: type === CACHE_FOR_DOWNLOAD_JOB_TYPE ? -1 : 1 } },
      ));
      if (claimed) return claimed;
    }
    return null;
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

}

module.exports = {
  ACKNOWLEDGEMENT_STATUSES,
  ACTIVE_JOB_STATUSES,
  CACHE_FOR_DOWNLOAD_JOB_TYPE,
  DELIVERABLE_JOB_TYPES,
  DELIVERY_PRIORITY,
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
