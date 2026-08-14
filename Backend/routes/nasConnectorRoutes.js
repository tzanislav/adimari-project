'use strict';

const crypto = require('crypto');
const net = require('net');
const express = require('express');
const { authenticate, authorizeRole } = require('../auth/authMiddleware');
const {
  authenticateConnectorKeyAuthorization,
  createConnectorAuthenticateMiddleware,
} = require('../auth/nasConnectorMiddleware');
const { getFileServerConfig } = require('../config/fileServerConfig');
const { getNasConnectorConfig } = require('../config/nasConnectorConfig');
const NasAuditEvent = require('../models/nasAuditEvent');
const NasRateLimitExemption = require('../models/nasRateLimitExemption');
const NasConnector = require('../models/nasConnector');
const NasFileEntry = require('../models/nasFileEntry');
const FileShare = require('../models/fileShare');
const NasStorageRoot = require('../models/nasStorageRoot');
const NasTransferJob = require('../models/nasTransferJob');
const {
  CACHE_FOR_DOWNLOAD_JOB_TYPE,
  GENERATE_THUMBNAIL_JOB_TYPE,
  INDEX_ROOT_JOB_TYPE,
  WRITE_UPLOAD_TO_NAS_JOB_TYPE,
  NasConnectorJobQueue,
  NasConnectorJobQueueError,
  serializeTransferJob,
} = require('../services/nasConnectorJobQueue');
const { FileStorageError } = require('../services/fileStorageService');
const { createNasStorageService } = require('../services/nasStorageService');
const {
  normalizeCatalogueChangeBatch,
  normalizeIndexBatch,
  normalizeIndexCompletion,
  normalizeIndexStart,
} = require('../services/nasCatalogueValidation');
const {
  NasConnectorValidationError,
  assertObjectId,
  normalizeAgentVersion,
  normalizeConnectorRoot,
  normalizeConnectorRootId,
  normalizeHeartbeatState,
  normalizeInstallationId,
  normalizeQueueLength,
  normalizeThumbnailWorkerCount,
} = require('../services/nasConnectorValidation');

class NasConnectorApiError extends Error {
  constructor({ code, message, status }) {
    super(message);
    this.name = 'NasConnectorApiError';
    this.code = code;
    this.status = status;
  }
}

const currentActorUid = (user) => user?.uid || user?.user_id || user?.email || null;

const normalizeIpAddress = (value) => {
  const candidate = typeof value === 'string' ? value.trim() : '';
  const normalized = candidate.startsWith('::ffff:') ? candidate.slice(7) : candidate;
  if (!net.isIP(normalized)) {
    throw new NasConnectorApiError({
      code: 'NAS_RATE_LIMIT_IP_INVALID',
      message: 'Enter a valid IPv4 or IPv6 address.',
      status: 400,
    });
  }
  return normalized;
};

const queryAsPlainArray = async (query) => {
  if (!query) return [];
  let resolved = query;
  if (typeof resolved.sort === 'function') resolved = resolved.sort({ createdAt: -1 });
  if (typeof resolved.lean === 'function') resolved = resolved.lean();
  return resolved;
};

const toPlainObject = (value) => (typeof value?.toObject === 'function' ? value.toObject() : { ...value });

const connectorIdOf = (connector) => String(connector?._id || connector?.id || '');

const serializeConnector = (connector) => {
  const value = toPlainObject(connector);
  return {
    id: connectorIdOf(value),
    name: value.name,
    installationId: value.installationId,
    status: value.status,
    agentVersion: value.agentVersion || null,
    thumbnailWorkerCount: Number.isSafeInteger(value.thumbnailWorkerCount) ? value.thumbnailWorkerCount : 1,
    lastSeenAt: value.lastSeenAt || null,
    revokedAt: value.revokedAt || null,
    createdAt: value.createdAt || null,
    updatedAt: value.updatedAt || null,
  };
};

const serializeStorageRoot = (root, connector = null) => {
  const value = toPlainObject(root);
  const connectorValue = connector ? toPlainObject(connector) : null;
  return {
    id: String(value._id || value.id || ''),
    connectorId: String(value.connectorId || ''),
    connectorRootId: value.connectorRootId,
    name: value.displayName,
    // Root status is administrative only. Online/offline is one connector
    // heartbeat-derived observation, never a second root liveness state.
    status: value.status,
    availability: connectorValue?.status === 'active'
      ? 'online'
      : connectorValue?.status === 'revoked' || value.status === 'disabled'
        ? 'disabled'
        : 'offline',
    uploadsEnabled: Boolean(value.uploadsEnabled),
    lastIndexedAt: value.lastIndexedAt || null,
    lastFullScanAt: value.lastFullScanAt || null,
    lastScanError: value.lastScanError || null,
  };
};

const genericConnectorFailure = () => new NasConnectorApiError({
  code: 'NAS_CONNECTOR_UNAUTHORIZED',
  message: 'Connector authentication failed.',
  status: 401,
});

// Once connector authentication has already succeeded, an absent/cancelled
// index job is an operational state—not an authentication failure. Returning
// 409 lets the service discard its stale local queue record without marking a
// valid shared key as rejected.
const indexJobUnavailable = () => new NasConnectorApiError({
  code: 'NAS_CONNECTOR_JOB_UNAVAILABLE',
  message: 'The index job is no longer active.',
  status: 409,
});

// A cancelled thumbnail is equivalent to a cancelled index scan from the
// connector's point of view: it must clear the matching durable local record
// rather than retrying an operation the server deliberately stopped.
const thumbnailJobUnavailable = () => new NasConnectorApiError({
  code: 'NAS_CONNECTOR_JOB_UNAVAILABLE',
  message: 'The thumbnail job is no longer active.',
  status: 409,
});

const cacheJobUnavailable = () => new NasConnectorApiError({
  code: 'NAS_CONNECTOR_JOB_UNAVAILABLE',
  message: 'The cache delivery job is no longer active.',
  status: 409,
});

const connectorRootUnavailable = () => new NasConnectorApiError({
  code: 'NAS_CONNECTOR_ROOT_UNAVAILABLE',
  message: 'The configured connector root is no longer active.',
  status: 409,
});

const createTransportGuard = (allowInsecureHttp) => (req, res, next) => {
  if (allowInsecureHttp || req.secure) return next();
  return res.status(400).json({
    code: 'NAS_CONNECTOR_HTTPS_REQUIRED',
    error: 'NAS connector requests require HTTPS.',
  });
};

const passThrough = (req, res, next) => next();

const sendError = (res, error) => {
  if (error instanceof NasConnectorApiError
    || error instanceof NasConnectorValidationError
    || error instanceof NasConnectorJobQueueError) {
    return res.status(error.status || 400).json({ code: error.code, error: error.message });
  }

  if (error?.code === 11000) {
    return res.status(409).json({
      code: 'NAS_CONNECTOR_CONFLICT',
      error: 'A conflicting NAS connector record already exists.',
    });
  }

  if (error?.name === 'CastError' || error?.name === 'ValidationError') {
    return res.status(400).json({
      code: 'NAS_CONNECTOR_REQUEST_INVALID',
      error: 'The NAS connector request is invalid.',
    });
  }

  // Keep connector request failures redacted; they can contain a shared access key.
  console.error('NAS connector route failed:', error?.code || error?.name || 'unknown');
  return res.status(500).json({
    code: 'NAS_CONNECTOR_OPERATION_FAILED',
    error: 'The NAS connector operation failed.',
  });
};

const normalizeSharedConnectionRequest = (body = {}) => ({
  installationId: normalizeInstallationId(body.installationId),
  agentVersion: normalizeAgentVersion(body.agentVersion),
  root: normalizeConnectorRoot(body.root),
  thumbnailWorkerCount: normalizeThumbnailWorkerCount(body.thumbnailWorkerCount),
});

const normalizeHeartbeatRequest = (body = {}) => ({
  installationId: normalizeInstallationId(body.installationId),
  agentVersion: normalizeAgentVersion(body.agentVersion),
  root: normalizeConnectorRoot(body.root),
  state: normalizeHeartbeatState(body.state),
  queueLength: normalizeQueueLength(body.queueLength),
  thumbnailWorkerCount: normalizeThumbnailWorkerCount(body.thumbnailWorkerCount),
});

const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const normalizeEmptyRequest = (body) => {
  if (!isPlainObject(body) || Object.keys(body).length !== 0) {
    throw new NasConnectorValidationError('Connector cache request is invalid.');
  }
  return {};
};

const normalizeCacheCompletion = (body) => {
  if (!isPlainObject(body)
    || Object.keys(body).length !== 2
    || typeof body.versionFingerprint !== 'string'
    || !/^[A-Za-z0-9._:-]{1,512}$/.test(body.versionFingerprint)
    || !Number.isSafeInteger(body.sizeBytes)
    || body.sizeBytes < 0) {
    throw new NasConnectorValidationError('Connector cache completion is invalid.');
  }
  return { versionFingerprint: body.versionFingerprint, sizeBytes: body.sizeBytes };
};

const normalizeWriteUploadCompletion = (body) => {
  if (!isPlainObject(body)
    || Object.keys(body).length !== 1
    || !Number.isSafeInteger(body.sizeBytes)
    || body.sizeBytes < 1) {
    throw new NasConnectorValidationError('Connector NAS upload completion is invalid.');
  }
  return { sizeBytes: body.sizeBytes };
};

const normalizeWriteUploadFailure = (body) => {
  const allowedCodes = new Set(['destination_exists', 'destination_unavailable', 'staging_unavailable', 'write_failed']);
  if (!isPlainObject(body)
    || Object.keys(body).length !== 1
    || typeof body.code !== 'string'
    || !allowedCodes.has(body.code)) {
    throw new NasConnectorValidationError('Connector NAS upload failure is invalid.');
  }
  return { code: body.code };
};

const normalizeDeliveryFailure = (body) => {
  const allowedCodes = new Set(['source_unavailable', 'source_changed', 'image_invalid', 'image_too_large', 'storage_rejected']);
  if (!isPlainObject(body)
    || Object.keys(body).length !== 1
    || typeof body.code !== 'string'
    || !allowedCodes.has(body.code)) {
    throw new NasConnectorValidationError('Connector delivery failure is invalid.');
  }
  return { code: body.code };
};

const createNasConnectorRoutes = (dependencies = {}) => {
  const config = dependencies.config || getNasConnectorConfig();
  const NasConnectorModel = dependencies.NasConnectorModel || NasConnector;
  const NasStorageRootModel = dependencies.NasStorageRootModel || NasStorageRoot;
  const NasFileEntryModel = dependencies.NasFileEntryModel || NasFileEntry;
  const FileShareModel = dependencies.FileShareModel || FileShare;
  const NasTransferJobModel = dependencies.NasTransferJobModel || NasTransferJob;
  const NasAuditEventModel = dependencies.NasAuditEventModel || NasAuditEvent;
  const NasRateLimitExemptionModel = dependencies.NasRateLimitExemptionModel || NasRateLimitExemption;
  const authenticateMiddleware = dependencies.authenticateMiddleware || authenticate;
  const authorizeAdminMiddleware = dependencies.authorizeAdminMiddleware || authorizeRole('admin');
  const requireHttpsMiddleware = dependencies.requireHttpsMiddleware
    || createTransportGuard(config.allowInsecureHttp === true);
  const heartbeatLimiter = dependencies.heartbeatLimiter || passThrough;
  const jobQueue = dependencies.jobQueue || new NasConnectorJobQueue({
    NasTransferJobModel,
    NasConnectorModel,
    leaseSeconds: Number.isSafeInteger(config.jobLeaseSeconds) ? config.jobLeaseSeconds : 90,
    now: dependencies.now || (() => new Date()),
  });
  const connectorAuthenticateMiddleware = dependencies.connectorAuthenticateMiddleware
    || createConnectorAuthenticateMiddleware({ NasConnectorModel });
  const now = dependencies.now || (() => new Date());
  const suppliedFileServerConfig = dependencies.fileServerConfig || null;
  const storageSet = dependencies.storageSet || null;
  let cacheStorage = dependencies.cacheStorage || storageSet?.cache || null;
  let thumbnailStorage = dependencies.thumbnailStorage || storageSet?.thumbnails || null;
  let stagingStorage = dependencies.stagingStorage || storageSet?.staging || null;
  // Create this only when a Phase-4 endpoint is used. It keeps the existing
  // control-plane route unit tests independent of unrelated S3 environment.
  const getCacheStorage = () => {
    if (cacheStorage) return cacheStorage;
    const fileServerConfig = suppliedFileServerConfig || getFileServerConfig();
    cacheStorage = createNasStorageService({
      nasConfig: config,
      fileServerConfig,
      prefix: config.cachePrefix,
      overrides: {
        uploadUrlTtlSeconds: config.connectorTransferUrlTtlSeconds,
        downloadUrlTtlSeconds: config.connectorTransferUrlTtlSeconds,
      },
    });
    return cacheStorage;
  };
  const getThumbnailStorage = () => {
    if (thumbnailStorage) return thumbnailStorage;
    const fileServerConfig = suppliedFileServerConfig || getFileServerConfig();
    thumbnailStorage = createNasStorageService({
      nasConfig: config,
      fileServerConfig,
      prefix: config.thumbnailPrefix,
      overrides: {
        uploadUrlTtlSeconds: config.connectorTransferUrlTtlSeconds,
        downloadUrlTtlSeconds: config.connectorTransferUrlTtlSeconds,
      },
    });
    return thumbnailStorage;
  };
  const getStagingStorage = () => {
    if (stagingStorage) return stagingStorage;
    const fileServerConfig = suppliedFileServerConfig || getFileServerConfig();
    stagingStorage = createNasStorageService({
      nasConfig: config,
      fileServerConfig,
      prefix: config.uploadStagingPrefix,
      overrides: { downloadUrlTtlSeconds: config.connectorTransferUrlTtlSeconds },
    });
    return stagingStorage;
  };
  const router = express.Router();

  const pollForAssignment = async (connectorId, waitSeconds, request) => {
    const deadline = Date.now() + (waitSeconds * 1_000);
    while (!request.aborted) {
      const assignment = await jobQueue.poll(connectorId);
      if (assignment) return assignment;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, remaining)));
    }
    return null;
  };

  const audit = async (event) => {
    try {
      await NasAuditEventModel.create(event);
    } catch (error) {
      // Auditing must not undo a successful connection or revocation.
      console.error('Failed to record NAS connector audit event:', error?.code || error?.name || 'unknown');
    }
  };

  // Liveness is reconciled at read time for the administrator list rather
  // than by trusting a previously written `active` status indefinitely. The
  // database update is conditional on the old lastSeenAt value, so a heartbeat
  // that arrives concurrently cannot be overwritten as offline.
  const heartbeatStaleAfterSeconds = () => (
    Number.isSafeInteger(config.heartbeatStaleAfterSeconds)
      ? config.heartbeatStaleAfterSeconds
      : config.heartbeatIntervalSeconds * 3
  );

  const reconcileStaleConnectorLiveness = async (asOf) => {
    const staleBefore = new Date(asOf.getTime() - (heartbeatStaleAfterSeconds() * 1000));
    await NasConnectorModel.updateMany(
      {
        status: 'active',
        $or: [
          { lastSeenAt: { $lte: staleBefore } },
          { lastSeenAt: null },
        ],
      },
      {
        $set: {
          status: 'offline',
          lastErrorCode: 'heartbeat_stale',
          lastErrorMessage: 'No heartbeat was received within the configured stale interval.',
        },
      },
    );
  };

  const ensureStorageRoot = async ({ connector, root }) => {
    if (typeof NasStorageRootModel.findOneAndUpdate === 'function') {
      return NasStorageRootModel.findOneAndUpdate(
        { connectorId: connector._id, connectorRootId: root.connectorRootId },
        {
          $set: {
            displayName: root.displayName,
            uploadsEnabled: root.uploadsEnabled,
            status: 'active',
          },
        },
        { new: true, upsert: true },
      );
    }

    return NasStorageRootModel.create({
      connectorId: connector._id,
      connectorRootId: root.connectorRootId,
      displayName: root.displayName,
      uploadsEnabled: root.uploadsEnabled,
      status: 'active',
    });
  };

  const requireSharedConnectorKey = (req, res, next) => {
    if (!authenticateConnectorKeyAuthorization({
      authorization: req.header('authorization'),
      sharedSecret: config.sharedSecret,
    })) {
      return res.status(401).json({
        code: 'NAS_CONNECTOR_UNAUTHORIZED',
        error: 'Connector authentication failed.',
      });
    }
    return next();
  };

  // Connector shared access keys are never accepted over cleartext HTTP.
  router.use(requireHttpsMiddleware);

  // The shared key is validated exactly once here. This creates or reuses the
  // connector record identified by the local installation ID; all later
  // heartbeat and job requests use only the returned connector ID.
  router.post('/connect', requireSharedConnectorKey, async (req, res) => {
    try {
      const request = normalizeSharedConnectionRequest(req.body);
      const connectedAt = now();
      let connector = await NasConnectorModel.findOne({ installationId: request.installationId });

      if (connector?.status === 'revoked') {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_DISABLED',
          message: 'This connector has been disabled by an administrator.',
          status: 403,
        });
      }

      if (!connector) {
        try {
          connector = await NasConnectorModel.create({
            name: request.root.displayName,
            installationId: request.installationId,
            status: 'active',
            agentVersion: request.agentVersion,
            thumbnailWorkerCount: request.thumbnailWorkerCount,
            lastSeenAt: connectedAt,
          });
        } catch (error) {
          if (error?.code !== 11000) throw error;
          connector = await NasConnectorModel.findOne({ installationId: request.installationId });
        }
      }

      if (!connector || connector.status === 'revoked') throw genericConnectorFailure();

      connector = await NasConnectorModel.findOneAndUpdate(
        { _id: connector._id, installationId: request.installationId, status: { $in: ['active', 'offline'] } },
        {
          $set: {
            name: request.root.displayName,
            status: 'active',
            agentVersion: request.agentVersion,
            thumbnailWorkerCount: request.thumbnailWorkerCount,
            lastSeenAt: connectedAt,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        },
        { new: true },
      );
      if (!connector) throw genericConnectorFailure();

      await ensureStorageRoot({ connector, root: request.root });
      await audit({
        action: 'connector_connected_with_shared_key',
        result: 'success',
        connectorId: connector._id,
        details: { installationId: request.installationId },
      });
      return res.json({ connector: serializeConnector(connector), heartbeatIntervalSeconds: config.heartbeatIntervalSeconds });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // Phase 3A: an accepted logical index job becomes an authenticated scan
  // session. The connector supplies only relative metadata in bounded batches;
  // no native root path is ever sent to or stored by the backend.
  router.post('/control/jobs/:jobId/index/cancel', connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      const connectorId = connectorIdOf(req.connector);
      const cancelledAt = now();
      let job = await NasTransferJobModel.findOneAndUpdate(
        {
          _id: jobId,
          connectorId,
          type: INDEX_ROOT_JOB_TYPE,
          status: { $in: ['accepted', 'in_progress'] },
        },
        {
          $set: {
            status: 'cancelled',
            completedAt: cancelledAt,
            progressStage: null,
            errorCode: 'cancelled',
            errorMessage: null,
          },
          $unset: { idempotencyKey: 1 },
        },
        { new: true },
      );
      if (!job) {
        job = await NasTransferJobModel.findOne({
          _id: jobId,
          connectorId,
          type: INDEX_ROOT_JOB_TYPE,
          status: 'cancelled',
        });
      }
      if (!job) throw indexJobUnavailable();

      await audit({
        action: 'scan_cancelled',
        result: 'success',
        connectorId,
        storageRootId: job.storageRootId,
        transferJobId: jobId,
        details: { source: 'connector_control_center' },
      });
      return res.json({ job: serializeTransferJob(job) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/control/jobs/:jobId/index/start', connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      const request = normalizeIndexStart(req.body);
      const connectorId = connectorIdOf(req.connector);
      const startedAt = now();
      let job = await NasTransferJobModel.findOneAndUpdate(
        {
          _id: jobId,
          connectorId,
          type: INDEX_ROOT_JOB_TYPE,
          status: 'accepted',
        },
        {
          $set: {
            status: 'in_progress',
            scanId: request.scanId,
            scanStartedAt: startedAt,
            progressStage: 'reading_nas',
            progressBytes: 0,
            progressTotalBytes: null,
            progressUpdatedAt: startedAt,
          },
        },
        { new: true },
      );
      if (!job) {
        job = await NasTransferJobModel.findOne({
          _id: jobId,
          connectorId,
          type: INDEX_ROOT_JOB_TYPE,
          status: 'in_progress',
          scanId: request.scanId,
        });
      }
      if (!job) throw indexJobUnavailable();

      const root = await NasStorageRootModel.findOne({
        _id: job.storageRootId,
        connectorId,
        connectorRootId: job.connectorRootId,
        status: { $in: ['active', 'offline'] },
      });
      if (!root) throw connectorRootUnavailable();
      return res.json({ scanId: request.scanId });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/control/jobs/:jobId/index/batches', connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      const request = normalizeIndexBatch(req.body);
      const connectorId = connectorIdOf(req.connector);
      const job = await NasTransferJobModel.findOne({
        _id: jobId,
        connectorId,
        type: INDEX_ROOT_JOB_TYPE,
        status: 'in_progress',
        scanId: request.scanId,
      });
      if (!job) throw indexJobUnavailable();

      const root = await NasStorageRootModel.findOne({
        _id: job.storageRootId,
        connectorId,
        connectorRootId: job.connectorRootId,
        status: { $in: ['active', 'offline'] },
      });
      if (!root) throw connectorRootUnavailable();

      const indexedAt = now();
      const incomingPaths = request.entries.map((entry) => entry.relativePath);
      const existingEntries = await queryAsPlainArray(NasFileEntryModel.find({
        storageRootId: job.storageRootId,
        relativePath: { $in: incomingPaths },
      }));
      const priorByPath = new Map(existingEntries.map((entry) => [entry.relativePath, entry]));
      await NasFileEntryModel.bulkWrite(request.entries.map((entry) => {
        const existing = priorByPath.get(entry.relativePath);
        const versionChanged = Boolean(existing
          && existing.entryType === 'file'
          && existing.versionFingerprint !== entry.versionFingerprint);
        return ({
        updateOne: {
          filter: { storageRootId: job.storageRootId, relativePath: entry.relativePath },
          update: {
            $set: {
              ...entry,
              lastIndexedAt: indexedAt,
              lastSeenScanId: request.scanId,
              deletedAt: null,
              ...(versionChanged ? {
                availabilityStatus: 'stale',
                thumbnailStatus: 'stale',
              } : {}),
            },
            $setOnInsert: {
              storageRootId: job.storageRootId,
              ...(!versionChanged ? {
                availabilityStatus: 'offline',
                thumbnailStatus: 'not_requested',
              } : {}),
            },
          },
          upsert: true,
        },
      });
      }), { ordered: false });
      await NasTransferJobModel.findOneAndUpdate(
        { _id: jobId, connectorId, status: 'in_progress', scanId: request.scanId },
        { $set: { progressBytes: (job.progressBytes || 0) + request.entries.length, progressUpdatedAt: indexedAt } },
        { new: false },
      );
      return res.status(204).end();
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/control/jobs/:jobId/index/complete', connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      const request = normalizeIndexCompletion(req.body);
      const connectorId = connectorIdOf(req.connector);
      const job = await NasTransferJobModel.findOne({
        _id: jobId,
        connectorId,
        type: INDEX_ROOT_JOB_TYPE,
        status: 'in_progress',
        scanId: request.scanId,
      });
      if (!job) {
        // A successful completion response can be lost after Mongo commits.
        // The service retains its local job until it sees a 2xx, so make the
        // exact same completion report safely retryable.
        const alreadyCompleted = await NasTransferJobModel.findOne({
          _id: jobId,
          connectorId,
          type: INDEX_ROOT_JOB_TYPE,
          status: 'completed',
          scanId: request.scanId,
        });
        if (alreadyCompleted) return res.json({ job: serializeTransferJob(alreadyCompleted) });
        throw indexJobUnavailable();
      }

      const completedAt = now();
      const root = await NasStorageRootModel.findOneAndUpdate(
        {
          _id: job.storageRootId,
          connectorId,
          connectorRootId: job.connectorRootId,
          status: { $in: ['active', 'offline'] },
        },
        { $set: { lastIndexedAt: completedAt, lastFullScanAt: completedAt, lastScanError: null } },
        { new: true },
      );
      if (!root) throw connectorRootUnavailable();

      await NasFileEntryModel.updateMany(
        {
          storageRootId: job.storageRootId,
          lastSeenScanId: { $ne: request.scanId },
          // A watcher update can arrive while a reconciliation scan is in
          // progress. Never let an older scan mark that newer observation as
          // deleted merely because it was not part of its enumeration.
          ...(job.scanStartedAt ? { lastIndexedAt: { $lte: job.scanStartedAt } } : {}),
          deletedAt: null,
        },
        { $set: { deletedAt: completedAt, availabilityStatus: 'unavailable' } },
      );
      const completed = await NasTransferJobModel.findOneAndUpdate(
        { _id: jobId, connectorId, type: INDEX_ROOT_JOB_TYPE, status: 'in_progress', scanId: request.scanId },
        {
          $set: {
            status: 'completed',
            completedAt,
            progressStage: null,
            progressBytes: request.entryCount,
            progressUpdatedAt: completedAt,
          },
          $unset: { idempotencyKey: 1 },
        },
        { new: true },
      );
      if (!completed) throw indexJobUnavailable();
      await audit({
        action: 'scan_completed',
        result: 'success',
        connectorId,
        storageRootId: job.storageRootId,
        transferJobId: jobId,
        details: { entryCount: request.entryCount },
      });
      return res.json({ job: serializeTransferJob(completed) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // Incremental change tracking. The connector coalesces local watcher events
  // and sends only relative file metadata or relative removals. Full scans are
  // still used as a safety net after watcher overflow/directory moves.
  router.post('/control/catalogue/changes', connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const request = normalizeCatalogueChangeBatch(req.body);
      const connectorId = connectorIdOf(req.connector);
      const root = await NasStorageRootModel.findOne({
        connectorId,
        connectorRootId: request.connectorRootId,
        status: { $in: ['active', 'offline'] },
      });
      if (!root) throw genericConnectorFailure();

      const observedAt = now();
      for (const change of request.changes) {
        if (change.operation === 'delete') {
          const escaped = change.relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const filter = change.recursive
            ? { storageRootId: root._id, relativePath: { $regex: `^${escaped}(?:/|$)` }, deletedAt: null }
            : { storageRootId: root._id, relativePath: change.relativePath, deletedAt: null };
          await NasFileEntryModel.updateMany(
            filter,
            { $set: { deletedAt: observedAt, availabilityStatus: 'unavailable', thumbnailStatus: 'stale', lastIndexedAt: observedAt } },
          );
          continue;
        }

        const existing = await NasFileEntryModel.findOne({
          storageRootId: root._id,
          relativePath: change.entry.relativePath,
        });
        const versionChanged = Boolean(existing && existing.versionFingerprint !== change.entry.versionFingerprint);
        const update = {
          $set: {
            ...change.entry,
            lastIndexedAt: observedAt,
            deletedAt: null,
            ...(versionChanged ? {
              availabilityStatus: 'stale',
              thumbnailStatus: 'stale',
            } : {}),
          },
          $setOnInsert: {
            storageRootId: root._id,
            // MongoDB rejects an upsert that changes the same path through
            // both $set and $setOnInsert. A changed existing version sets
            // stale in $set, while a first observation receives its initial
            // offline/not-requested state here.
            ...(!versionChanged ? {
              availabilityStatus: 'offline',
              thumbnailStatus: 'not_requested',
            } : {}),
          },
        };
        await NasFileEntryModel.findOneAndUpdate(
          { storageRootId: root._id, relativePath: change.entry.relativePath },
          update,
          { upsert: true, new: false },
        );
      }

      await NasStorageRootModel.findOneAndUpdate(
        { _id: root._id, connectorId, connectorRootId: request.connectorRootId },
        { $set: { lastIndexedAt: observedAt, lastScanError: null } },
        { new: false },
      );
      return res.status(204).end();
    } catch (error) {
      return sendError(res, error);
    }
  });

  // The connector asks to begin a cache copy only after its durable
  // HTTPS-polled assignment was accepted. The response contains a relative path and a
  // single temporary PUT URL; neither native NAS paths nor AWS credentials
  // ever leave the connector/backend boundary.
  router.post('/control/jobs/:jobId/cache/start', connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      normalizeEmptyRequest(req.body);
      const connectorId = connectorIdOf(req.connector);
      const job = await NasTransferJobModel.findOne({
        _id: jobId,
        connectorId,
        type: CACHE_FOR_DOWNLOAD_JOB_TYPE,
        status: { $in: ['accepted', 'in_progress'] },
      });
      if (!job || !isPlainObject(job.payload)) throw cacheJobUnavailable();
      const fileEntryId = assertObjectId(job.payload.fileEntryId, 'File entry ID');
      const fileShareId = assertObjectId(job.payload.fileShareId, 'File share ID');
      const [entry, share, root] = await Promise.all([
        NasFileEntryModel.findOne({ _id: fileEntryId, storageRootId: job.storageRootId, entryType: 'file', deletedAt: null }),
        FileShareModel.findOne({ _id: fileShareId, sourceType: 'nas_file', nasFileEntryId: fileEntryId, status: 'active', deliveryStatus: 'preparing' }),
        NasStorageRootModel.findOne({
          _id: job.storageRootId,
          connectorId,
          connectorRootId: job.connectorRootId,
          status: { $in: ['active', 'offline'] },
        }),
      ]);
      if (!entry || !share || !root || (share.cacheExpiresAt && share.cacheExpiresAt <= now())) {
        await NasTransferJobModel.findOneAndUpdate(
          { _id: jobId, connectorId, type: CACHE_FOR_DOWNLOAD_JOB_TYPE, status: { $in: ['accepted', 'in_progress'] } },
          { $set: { status: 'failed', completedAt: now(), errorCode: 'source_unavailable', errorMessage: 'The NAS file share is no longer available.' }, $unset: { idempotencyKey: 1 } },
          { new: false },
        );
        if (share?.deliveryStatus === 'preparing') {
          await FileShareModel.findOneAndUpdate({ _id: fileShareId, status: 'active' }, { $set: { deliveryStatus: 'failed' } }, { new: false });
        }
        throw new NasConnectorApiError({ code: 'NAS_CACHE_SOURCE_UNAVAILABLE', message: 'The requested NAS file is no longer available.', status: 409 });
      }

      const cacheKey = `${config.cachePrefix}shares/${fileShareId}/content`;
      const startedAt = now();
      await NasTransferJobModel.findOneAndUpdate(
        { _id: jobId, connectorId, type: CACHE_FOR_DOWNLOAD_JOB_TYPE, status: { $in: ['accepted', 'in_progress'] } },
        {
          $set: {
            status: 'in_progress',
            progressStage: 'uploading_cache',
            progressBytes: 0,
            progressTotalBytes: entry.sizeBytes || 0,
            progressUpdatedAt: startedAt,
          },
        },
        { new: false },
      );
      const uploadUrl = await getCacheStorage().getUploadUrl({
        key: cacheKey,
        contentType: entry.contentType || 'application/octet-stream',
        expiresIn: config.connectorTransferUrlTtlSeconds,
      });
      console.info('[NAS cache] upload_started', { connectorId, jobId, fileEntryId, fileShareId });
      return res.json({
        relativePath: entry.relativePath,
        versionFingerprint: entry.versionFingerprint,
        sizeBytes: entry.sizeBytes || 0,
        contentType: entry.contentType || 'application/octet-stream',
        uploadUrl,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // The browser can abandon a large image while its cache upload is in
  // progress. This compact status probe lets the cache worker cancel its
  // pre-signed PUT quickly instead of occupying the serial file-delivery lane.
  router.get('/control/jobs/:jobId/cache/active', connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      const connectorId = connectorIdOf(req.connector);
      const job = await NasTransferJobModel.findOne({
        _id: jobId,
        connectorId,
        type: CACHE_FOR_DOWNLOAD_JOB_TYPE,
        status: { $in: ['accepted', 'in_progress'] },
      });
      return res.json({ active: Boolean(job) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/control/jobs/:jobId/cache/complete', connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      const completion = normalizeCacheCompletion(req.body);
      const connectorId = connectorIdOf(req.connector);
      const job = await NasTransferJobModel.findOne({
        _id: jobId,
        connectorId,
        type: CACHE_FOR_DOWNLOAD_JOB_TYPE,
        status: { $in: ['in_progress', 'completed'] },
      });
      if (!job || !isPlainObject(job.payload)) throw cacheJobUnavailable();
      const fileEntryId = assertObjectId(job.payload.fileEntryId, 'File entry ID');
      const fileShareId = assertObjectId(job.payload.fileShareId, 'File share ID');
      if (job.status === 'completed') return res.json({ job: serializeTransferJob(job) });

      const [entry, share] = await Promise.all([
        NasFileEntryModel.findOne({ _id: fileEntryId, storageRootId: job.storageRootId, entryType: 'file', deletedAt: null }),
        FileShareModel.findOne({
          _id: fileShareId,
          sourceType: 'nas_file',
          nasFileEntryId: fileEntryId,
          status: 'active',
          deliveryStatus: { $in: ['preparing', 'ready'] },
        }),
      ]);
      if (!entry || !share || entry.versionFingerprint !== completion.versionFingerprint || entry.sizeBytes !== completion.sizeBytes
        || (share.cacheExpiresAt && share.cacheExpiresAt <= now())) {
        throw new NasConnectorApiError({ code: 'NAS_CACHE_SOURCE_CHANGED', message: 'The NAS file changed before cache delivery completed.', status: 409 });
      }
      const cacheKey = `${config.cachePrefix}shares/${fileShareId}/content`;
      const object = await getCacheStorage().headFile({ key: cacheKey });
      if (Number(object.ContentLength) !== completion.sizeBytes) {
        throw new NasConnectorApiError({ code: 'NAS_CACHE_OBJECT_INVALID', message: 'The uploaded cache object does not match the indexed file.', status: 409 });
      }

      const completedAt = now();
      const readyShare = await FileShareModel.findOneAndUpdate(
        {
          _id: fileShareId,
          status: 'active',
          cacheExpiresAt: { $gt: completedAt },
          $or: [
            { deliveryStatus: 'preparing' },
            { deliveryStatus: 'ready', s3Key: cacheKey },
          ],
        },
        { $set: { s3Key: cacheKey, deliveryStatus: 'ready' } },
        { new: true },
      );
      if (!readyShare) throw new NasConnectorApiError({ code: 'NAS_CACHE_SHARE_UNAVAILABLE', message: 'The NAS file share is no longer active.', status: 409 });
      await NasFileEntryModel.findOneAndUpdate(
        { _id: fileEntryId, versionFingerprint: completion.versionFingerprint, deletedAt: null },
        {
          $set: {
            availabilityStatus: 'online',
            cacheObjectKey: cacheKey,
            cacheVersionFingerprint: completion.versionFingerprint,
            cacheExpiresAt: share.cacheExpiresAt,
          },
        },
        { new: false },
      );
      const completed = await NasTransferJobModel.findOneAndUpdate(
        { _id: jobId, connectorId, type: CACHE_FOR_DOWNLOAD_JOB_TYPE, status: 'in_progress' },
        {
          $set: {
            status: 'completed', completedAt, progressStage: null, progressBytes: completion.sizeBytes,
            progressTotalBytes: completion.sizeBytes, progressUpdatedAt: completedAt,
          },
          $unset: { idempotencyKey: 1 },
        },
        { new: true },
      );
      if (!completed) throw cacheJobUnavailable();
      console.info('[NAS cache] upload_completed', { connectorId, jobId, fileEntryId, fileShareId });
      return res.json({ job: serializeTransferJob(completed) });
    } catch (error) {
      if (error instanceof FileStorageError) {
        return res.status(503).json({ code: 'NAS_CACHE_STORAGE_UNAVAILABLE', error: 'Temporary file storage is unavailable.' });
      }
      return sendError(res, error);
    }
  });

  router.post('/control/jobs/:jobId/cache/fail', connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      const failure = normalizeDeliveryFailure(req.body);
      const connectorId = connectorIdOf(req.connector);
      const existing = await NasTransferJobModel.findOne({ _id: jobId, connectorId, type: CACHE_FOR_DOWNLOAD_JOB_TYPE, status: { $in: ['accepted', 'in_progress', 'failed'] } });
      if (!existing || !isPlainObject(existing.payload)) throw connectorRootUnavailable();
      if (existing.status === 'failed') return res.json({ job: serializeTransferJob(existing) });
      const job = await NasTransferJobModel.findOneAndUpdate(
        { _id: jobId, connectorId, type: CACHE_FOR_DOWNLOAD_JOB_TYPE, status: { $in: ['accepted', 'in_progress'] } },
        { $set: { status: 'failed', completedAt: now(), errorCode: failure.code, errorMessage: 'The connector could not prepare the NAS file.' }, $unset: { idempotencyKey: 1 } },
        { new: true },
      );
      if (!job) throw connectorRootUnavailable();
      if (job.payload.fileShareId) await FileShareModel.findOneAndUpdate(
        { _id: job.payload.fileShareId, status: 'active', deliveryStatus: 'preparing' },
        { $set: { deliveryStatus: 'failed' } },
        { new: false },
      );
      await audit({ action: 'cache_failed', result: 'failure', connectorId, storageRootId: job.storageRootId, fileEntryId: job.payload.fileEntryId, transferJobId: jobId, details: { code: failure.code } });
      return res.json({ job: serializeTransferJob(job) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // Phase 5: the browser first uploads into the private staging prefix. The
  // connector receives only an authenticated one-time download URL and the
  // relative destination path, then writes the file under its configured NAS
  // root. No browser or backend request contains a Windows/UNC path.
  router.post('/control/jobs/:jobId/upload/start', connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      normalizeEmptyRequest(req.body);
      const connectorId = connectorIdOf(req.connector);
      const job = await NasTransferJobModel.findOne({
        _id: jobId,
        connectorId,
        type: WRITE_UPLOAD_TO_NAS_JOB_TYPE,
        status: { $in: ['accepted', 'in_progress', 'completed'] },
      });
      if (!job || !isPlainObject(job.payload)
        || typeof job.payload.relativeDestinationPath !== 'string'
        || typeof job.payload.stagingKey !== 'string'
        || !Number.isSafeInteger(job.payload.expectedSize)
        || job.payload.expectedSize < 1
        || typeof job.payload.contentType !== 'string') {
        throw genericConnectorFailure();
      }
      const root = await NasStorageRootModel.findOne({
        _id: job.storageRootId,
        connectorId,
        connectorRootId: job.connectorRootId,
        uploadsEnabled: true,
        status: { $in: ['active', 'offline'] },
      });
      if (!root) throw genericConnectorFailure();
      if (job.status === 'completed') {
        return res.json({
          relativePath: job.payload.relativeDestinationPath,
          contentType: job.payload.contentType,
          sizeBytes: job.payload.expectedSize,
          completed: true,
        });
      }
      const object = await getStagingStorage().headFile({ key: job.payload.stagingKey });
      if (Number(object.ContentLength) !== job.payload.expectedSize) {
        throw new NasConnectorApiError({ code: 'NAS_UPLOAD_STAGING_INVALID', message: 'The staged upload is unavailable.', status: 409 });
      }
      const startedAt = now();
      await NasTransferJobModel.findOneAndUpdate(
        { _id: jobId, connectorId, type: WRITE_UPLOAD_TO_NAS_JOB_TYPE, status: { $in: ['accepted', 'in_progress'] } },
        {
          $set: {
            status: 'in_progress',
            progressStage: 'writing_nas',
            progressBytes: 0,
            progressTotalBytes: job.payload.expectedSize,
            progressUpdatedAt: startedAt,
          },
        },
        { new: false },
      );
      const fileName = job.payload.relativeDestinationPath.split('/').pop();
      const downloadUrl = await getStagingStorage().getDownloadUrl({
        key: job.payload.stagingKey,
        fileName,
        disposition: 'attachment',
        expiresIn: config.connectorTransferUrlTtlSeconds,
      });
      console.info('[NAS upload] connector_write_started', { connectorId, jobId });
      return res.json({
        relativePath: job.payload.relativeDestinationPath,
        contentType: job.payload.contentType,
        sizeBytes: job.payload.expectedSize,
        downloadUrl,
      });
    } catch (error) {
      if (error instanceof FileStorageError) {
        return res.status(503).json({ code: 'NAS_UPLOAD_STAGING_UNAVAILABLE', error: 'Temporary upload storage is unavailable.' });
      }
      return sendError(res, error);
    }
  });

  router.post('/control/jobs/:jobId/upload/complete', connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      const completion = normalizeWriteUploadCompletion(req.body);
      const connectorId = connectorIdOf(req.connector);
      const job = await NasTransferJobModel.findOne({
        _id: jobId,
        connectorId,
        type: WRITE_UPLOAD_TO_NAS_JOB_TYPE,
        status: { $in: ['in_progress', 'completed'] },
      });
      if (!job || !isPlainObject(job.payload) || !Number.isSafeInteger(job.payload.expectedSize)) {
        throw genericConnectorFailure();
      }
      if (job.status === 'completed') return res.json({ job: serializeTransferJob(job) });
      if (completion.sizeBytes !== job.payload.expectedSize) {
        throw new NasConnectorApiError({ code: 'NAS_UPLOAD_SIZE_MISMATCH', message: 'The NAS file does not match the staged upload.', status: 409 });
      }
      const completedAt = now();
      const completed = await NasTransferJobModel.findOneAndUpdate(
        { _id: jobId, connectorId, type: WRITE_UPLOAD_TO_NAS_JOB_TYPE, status: 'in_progress' },
        {
          $set: {
            status: 'completed',
            completedAt,
            progressStage: null,
            progressBytes: completion.sizeBytes,
            progressTotalBytes: completion.sizeBytes,
            progressUpdatedAt: completedAt,
          },
          $unset: { idempotencyKey: 1 },
        },
        { new: true },
      );
      if (!completed) throw genericConnectorFailure();
      await getStagingStorage().deleteFile({ key: job.payload.stagingKey }).catch(() => {});
      await audit({ action: 'upload_completed', result: 'success', connectorId, storageRootId: job.storageRootId, transferJobId: jobId, details: {} });
      console.info('[NAS upload] connector_write_completed', { connectorId, jobId, sizeBytes: completion.sizeBytes });
      return res.json({ job: serializeTransferJob(completed) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/control/jobs/:jobId/upload/fail', connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      const failure = normalizeWriteUploadFailure(req.body);
      const connectorId = connectorIdOf(req.connector);
      const existing = await NasTransferJobModel.findOne({
        _id: jobId,
        connectorId,
        type: WRITE_UPLOAD_TO_NAS_JOB_TYPE,
        status: { $in: ['accepted', 'in_progress', 'failed'] },
      });
      if (!existing) throw connectorRootUnavailable();
      // The connector retains terminal reports until this endpoint confirms
      // them. A lost response therefore replays cleanly instead of leaving a
      // local failure acknowledgement permanently pending.
      if (existing.status === 'failed') return res.json({ job: serializeTransferJob(existing) });
      const job = await NasTransferJobModel.findOneAndUpdate(
        {
          _id: jobId,
          connectorId,
          type: WRITE_UPLOAD_TO_NAS_JOB_TYPE,
          status: { $in: ['accepted', 'in_progress'] },
        },
        {
          $set: {
            status: 'failed',
            completedAt: now(),
            errorCode: failure.code,
            errorMessage: 'The connector could not write the staged upload to the NAS.',
          },
          $unset: { idempotencyKey: 1 },
        },
        { new: true },
      );
      if (!job) throw genericConnectorFailure();
      if (job.payload?.stagingKey) await getStagingStorage().deleteFile({ key: job.payload.stagingKey }).catch(() => {});
      await audit({ action: 'upload_failed', result: 'failure', connectorId, storageRootId: job.storageRootId, transferJobId: jobId, details: { code: failure.code } });
      console.info('[NAS upload] connector_write_failed', { connectorId, jobId, code: failure.code });
      return res.json({ job: serializeTransferJob(job) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/control/jobs/:jobId/thumbnail/start', connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      normalizeEmptyRequest(req.body);
      const connectorId = connectorIdOf(req.connector);
      const job = await NasTransferJobModel.findOne({
        _id: jobId,
        connectorId,
        type: GENERATE_THUMBNAIL_JOB_TYPE,
        status: { $in: ['accepted', 'in_progress'] },
      });
      if (!job || !isPlainObject(job.payload)) throw thumbnailJobUnavailable();
      const fileEntryId = assertObjectId(job.payload.fileEntryId, 'File entry ID');
      const [entry, root] = await Promise.all([
        NasFileEntryModel.findOne({
          _id: fileEntryId,
          storageRootId: job.storageRootId,
          entryType: 'file',
          previewKind: 'image',
          deletedAt: null,
        }),
        NasStorageRootModel.findOne({
          _id: job.storageRootId,
          connectorId,
          connectorRootId: job.connectorRootId,
          status: { $in: ['active', 'offline'] },
        }),
      ]);
      if (!entry || !root) {
        throw new NasConnectorApiError({ code: 'NAS_THUMBNAIL_SOURCE_UNAVAILABLE', message: 'The requested image is no longer available.', status: 409 });
      }
      const versionHash = crypto.createHash('sha256').update(entry.versionFingerprint).digest('hex');
      const thumbnailKey = `${config.thumbnailPrefix}entries/${fileEntryId}/${versionHash}.jpg`;
      const startedAt = now();
      await NasTransferJobModel.findOneAndUpdate(
        { _id: jobId, connectorId, type: GENERATE_THUMBNAIL_JOB_TYPE, status: { $in: ['accepted', 'in_progress'] } },
        { $set: { status: 'in_progress', progressStage: 'generating_thumbnail', progressBytes: 0, progressTotalBytes: entry.sizeBytes || 0, progressUpdatedAt: startedAt } },
        { new: false },
      );
      const uploadUrl = await getThumbnailStorage().getUploadUrl({
        key: thumbnailKey,
        contentType: 'image/jpeg',
        expiresIn: config.connectorTransferUrlTtlSeconds,
      });
      console.info('[NAS thumbnail] started', { connectorId, jobId, fileEntryId });
      return res.json({
        relativePath: entry.relativePath,
        versionFingerprint: entry.versionFingerprint,
        contentType: entry.contentType,
        maxDimension: config.thumbnailMaxDimension,
        uploadUrl,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/control/jobs/:jobId/thumbnail/complete', connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      const completion = normalizeCacheCompletion(req.body);
      const connectorId = connectorIdOf(req.connector);
      const job = await NasTransferJobModel.findOne({
        _id: jobId,
        connectorId,
        type: GENERATE_THUMBNAIL_JOB_TYPE,
        status: { $in: ['in_progress', 'completed'] },
      });
      if (!job || !isPlainObject(job.payload)) throw thumbnailJobUnavailable();
      if (job.status === 'completed') return res.json({ job: serializeTransferJob(job) });
      const fileEntryId = assertObjectId(job.payload.fileEntryId, 'File entry ID');
      const entry = await NasFileEntryModel.findOne({
        _id: fileEntryId,
        storageRootId: job.storageRootId,
        entryType: 'file',
        previewKind: 'image',
        deletedAt: null,
      });
      if (!entry || entry.versionFingerprint !== completion.versionFingerprint) {
        throw new NasConnectorApiError({ code: 'NAS_THUMBNAIL_SOURCE_CHANGED', message: 'The image changed before thumbnail creation completed.', status: 409 });
      }
      const previousThumbnailKey = entry.thumbnailObjectKey || null;
      const versionHash = crypto.createHash('sha256').update(entry.versionFingerprint).digest('hex');
      const thumbnailKey = `${config.thumbnailPrefix}entries/${fileEntryId}/${versionHash}.jpg`;
      const object = await getThumbnailStorage().headFile({ key: thumbnailKey });
      if (!Number.isSafeInteger(Number(object.ContentLength)) || Number(object.ContentLength) !== completion.sizeBytes || completion.sizeBytes < 1) {
        throw new NasConnectorApiError({ code: 'NAS_THUMBNAIL_OBJECT_INVALID', message: 'The generated thumbnail is invalid.', status: 409 });
      }
      const completedAt = now();
      const updatedEntry = await NasFileEntryModel.findOneAndUpdate(
        { _id: fileEntryId, versionFingerprint: completion.versionFingerprint, deletedAt: null },
        { $set: { thumbnailStatus: 'ready', thumbnailObjectKey: thumbnailKey, thumbnailVersionFingerprint: completion.versionFingerprint, thumbnailUpdatedAt: completedAt } },
        { new: true },
      );
      if (!updatedEntry) throw new NasConnectorApiError({ code: 'NAS_THUMBNAIL_SOURCE_CHANGED', message: 'The image changed before thumbnail creation completed.', status: 409 });
      const completed = await NasTransferJobModel.findOneAndUpdate(
        { _id: jobId, connectorId, type: GENERATE_THUMBNAIL_JOB_TYPE, status: 'in_progress' },
        { $set: { status: 'completed', completedAt, progressStage: null, progressBytes: completion.sizeBytes, progressTotalBytes: completion.sizeBytes, progressUpdatedAt: completedAt }, $unset: { idempotencyKey: 1 } },
        { new: true },
      );
      if (!completed) throw thumbnailJobUnavailable();
      await audit({ action: 'thumbnail_completed', result: 'success', connectorId, storageRootId: job.storageRootId, fileEntryId, transferJobId: jobId, details: {} });
      if (previousThumbnailKey && previousThumbnailKey !== thumbnailKey) {
        await getThumbnailStorage().deleteFile({ key: previousThumbnailKey }).catch((error) => {
          console.warn('[NAS thumbnail] previous_object_cleanup_failed', {
            connectorId,
            fileEntryId,
            reason: error?.code || error?.name || 'unknown',
          });
        });
      }
      console.info('[NAS thumbnail] completed', { connectorId, jobId, fileEntryId, sizeBytes: completion.sizeBytes });
      return res.json({ job: serializeTransferJob(completed) });
    } catch (error) {
      if (error instanceof FileStorageError) {
        return res.status(503).json({ code: 'NAS_THUMBNAIL_STORAGE_UNAVAILABLE', error: 'Thumbnail storage is unavailable.' });
      }
      return sendError(res, error);
    }
  });

  router.post('/control/jobs/:jobId/thumbnail/fail', connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      const failure = normalizeDeliveryFailure(req.body);
      const connectorId = connectorIdOf(req.connector);
      const existing = await NasTransferJobModel.findOne({ _id: jobId, connectorId, type: GENERATE_THUMBNAIL_JOB_TYPE, status: { $in: ['accepted', 'in_progress', 'failed'] } });
      if (!existing || !isPlainObject(existing.payload)) throw thumbnailJobUnavailable();
      if (existing.status === 'failed') return res.json({ job: serializeTransferJob(existing) });
      const job = await NasTransferJobModel.findOneAndUpdate(
        { _id: jobId, connectorId, type: GENERATE_THUMBNAIL_JOB_TYPE, status: { $in: ['accepted', 'in_progress'] } },
        { $set: { status: 'failed', completedAt: now(), errorCode: failure.code, errorMessage: 'The connector could not prepare the image thumbnail.' }, $unset: { idempotencyKey: 1 } },
        { new: true },
      );
      if (!job) throw thumbnailJobUnavailable();
      if (job.payload.fileEntryId) await NasFileEntryModel.findOneAndUpdate(
        { _id: job.payload.fileEntryId, storageRootId: job.storageRootId, thumbnailStatus: 'preparing' },
        { $set: { thumbnailStatus: 'failed' } },
        { new: false },
      );
      await audit({ action: 'thumbnail_failed', result: 'failure', connectorId, storageRootId: job.storageRootId, fileEntryId: job.payload.fileEntryId, transferJobId: jobId, details: { code: failure.code } });
      return res.json({ job: serializeTransferJob(job) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // The local Windows Control Center can start a scan directly. This is not a
  // browser-facing action: it is authenticated with the connector credential
  // and gives the operator immediate local feedback without waiting for a
  // remote assignment poll.
  router.post('/control/index-requests', requireHttpsMiddleware, connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const connectorRootId = normalizeConnectorRootId(req.body?.connectorRootId);
      const connectorId = connectorIdOf(req.connector);
      const root = await NasStorageRootModel.findOne({
        connectorId,
        connectorRootId,
        status: { $in: ['active', 'offline'] },
      });
      if (!root) throw genericConnectorFailure();

      const requested = await jobQueue.requestLocalIndexRoot({
        connectorId,
        storageRootId: root._id || root.id,
        connectorRootId,
      });
      await audit({
        action: 'scan_requested_locally',
        result: 'success',
        connectorId,
        storageRootId: root._id || root.id,
        transferJobId: requested.job._id || requested.job.id,
        details: { connectorRootId, created: requested.created },
      });
      return res.status(requested.created ? 201 : 200).json({
        created: requested.created,
        job: serializeTransferJob(requested.job),
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // This is deliberately unavailable unless an operator explicitly enables it
  // in a disposable environment. It clears only the authenticated connector's
  // backend state. Because object prefixes are deployment-wide, it also clears
  // every temporary NAS object in those prefixes. It never accesses NAS source
  // files.
  router.post('/control/reset-all', requireHttpsMiddleware, connectorAuthenticateMiddleware, async (req, res) => {
    try {
      if (config.developmentResetEnabled !== true) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_DEVELOPMENT_RESET_DISABLED',
          message: 'Development reset is disabled.',
          status: 404,
        });
      }

      const connectorId = connectorIdOf(req.connector);
      const roots = await queryAsPlainArray(NasStorageRootModel.find({ connectorId }));
      const rootIds = roots.map((root) => root._id || root.id);
      const entries = rootIds.length
        ? await queryAsPlainArray(NasFileEntryModel.find({ storageRootId: { $in: rootIds } }))
        : [];
      const entryIds = entries.map((entry) => entry._id || entry.id);
      const shares = entryIds.length
        ? await queryAsPlainArray(FileShareModel.find({ sourceType: 'nas_file', nasFileEntryId: { $in: entryIds } }))
        : [];

      await Promise.all([
        getCacheStorage().deleteAllManagedFiles(),
        getThumbnailStorage().deleteAllManagedFiles(),
        getStagingStorage().deleteAllManagedFiles(),
      ]);

      await Promise.all([
        NasTransferJobModel.deleteMany({ connectorId }),
        rootIds.length ? NasFileEntryModel.deleteMany({ storageRootId: { $in: rootIds } }) : Promise.resolve(),
        entryIds.length ? FileShareModel.deleteMany({ sourceType: 'nas_file', nasFileEntryId: { $in: entryIds } }) : Promise.resolve(),
        NasStorageRootModel.deleteMany({ connectorId }),
        NasConnectorModel.deleteOne({ _id: connectorId }),
      ]);

      return res.status(204).end();
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/control/heartbeat', heartbeatLimiter, connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const request = normalizeHeartbeatRequest(req.body);
      const connectorId = connectorIdOf(req.connector);
      if (!connectorId || req.connector.installationId !== request.installationId) {
        throw genericConnectorFailure();
      }

      const seenAt = now();
      const connector = await NasConnectorModel.findOneAndUpdate(
        {
          _id: connectorId,
          installationId: request.installationId,
          status: { $in: ['active', 'offline'] },
        },
        {
          $set: {
            status: 'active',
            agentVersion: request.agentVersion,
            thumbnailWorkerCount: request.thumbnailWorkerCount,
            lastSeenAt: seenAt,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        },
        { new: true },
      );
      if (!connector) throw genericConnectorFailure();

      await NasStorageRootModel.findOneAndUpdate(
        { connectorId, connectorRootId: request.root.connectorRootId },
        {
          $set: {
            displayName: request.root.displayName,
            uploadsEnabled: request.root.uploadsEnabled,
            status: 'active',
          },
        },
        { new: true, upsert: true },
      );

      // Heartbeat is the one reliable periodic backend-to-connector touch.
      // It also gives the durable queue watchdog a chance to release a job
      // abandoned by a crash, without adding another process or scheduler.

      return res.json({
        connector: serializeConnector(connector),
        state: request.state,
        queueLength: request.queueLength,
        heartbeatIntervalSeconds: config.heartbeatIntervalSeconds,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/control/jobs/poll', heartbeatLimiter, connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const waitSeconds = req.body?.waitSeconds === undefined ? 20 : Number(req.body.waitSeconds);
      if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 25) {
        throw genericConnectorFailure();
      }
      const connectorId = connectorIdOf(req.connector);
      const assignment = await pollForAssignment(connectorId, waitSeconds, req);
      if (!assignment) return res.status(204).end();
      return res.json({ assignment });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/control/jobs/ack', heartbeatLimiter, connectorAuthenticateMiddleware, async (req, res) => {
    try {
      const acknowledgement = await jobQueue.acknowledgePolled({
        connectorId: connectorIdOf(req.connector),
        payload: req.body,
      });
      if (!acknowledgement.accepted) throw genericConnectorFailure();
      return res.json({ accepted: true, replay: acknowledgement.replay });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
    try {
      await reconcileStaleConnectorLiveness(now());
      const connectors = await queryAsPlainArray(NasConnectorModel.find({}));
      return res.json({ connectors: connectors.map(serializeConnector) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/rate-limit-exemptions', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
    try {
      const exemptions = await queryAsPlainArray(NasRateLimitExemptionModel.find({}));
      return res.json({ exemptions: exemptions.map((entry) => ({
        id: String(entry._id || entry.id || ''),
        ipAddress: entry.ipAddress,
        createdAt: entry.createdAt || null,
      })) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/rate-limit-exemptions', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
    try {
      const ipAddress = normalizeIpAddress(req.body?.ipAddress);
      let exemption;
      try {
        exemption = await NasRateLimitExemptionModel.create({ ipAddress, createdBy: currentActorUid(req.user) });
      } catch (error) {
        if (error?.code === 11000) {
          throw new NasConnectorApiError({ code: 'NAS_RATE_LIMIT_IP_EXISTS', message: 'That IP address is already exempt.', status: 409 });
        }
        throw error;
      }
      return res.status(201).json({ exemption: {
        id: String(exemption._id || exemption.id || ''),
        ipAddress: exemption.ipAddress,
        createdAt: exemption.createdAt || null,
      } });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.delete('/rate-limit-exemptions/:exemptionId', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
    try {
      const exemptionId = assertObjectId(req.params.exemptionId, 'Rate-limit exemption ID');
      const deleted = await NasRateLimitExemptionModel.findByIdAndDelete(exemptionId);
      if (!deleted) {
        throw new NasConnectorApiError({ code: 'NAS_RATE_LIMIT_IP_NOT_FOUND', message: 'The IP exemption no longer exists.', status: 404 });
      }
      return res.status(204).end();
    } catch (error) {
      return sendError(res, error);
    }
  });

  // A deliberately small recovery surface: it identifies only jobs whose
  // backend progress has been unchanged for a conservative interval. The
  // accompanying action stops a job; it never blindly replays NAS work.
  router.get('/recovery/jobs', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
    try {
      const observedAt = now();
      const stuckBefore = new Date(observedAt.getTime() - (config.recoveryStuckAfterMinutes * 60 * 1_000));
      let query = NasTransferJobModel.find({
        status: { $in: ['staging', 'assigned', 'accepted', 'in_progress'] },
        updatedAt: { $lte: stuckBefore },
      });
      if (typeof query.sort === 'function') query = query.sort({ updatedAt: 1 });
      if (typeof query.limit === 'function') query = query.limit(100);
      const jobs = await queryAsPlainArray(query);
      return res.json({
        observedAt,
        stuckAfterMinutes: config.recoveryStuckAfterMinutes,
        jobs: jobs.map(serializeTransferJob),
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/:id/jobs/:jobId/recovery/stop', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
    const actorUid = currentActorUid(req.user);
    try {
      if (!actorUid) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_ACTOR_REQUIRED',
          message: 'Authenticated administrator identity is required.',
          status: 401,
        });
      }
      normalizeEmptyRequest(req.body);
      const connectorId = assertObjectId(req.params.id, 'Connector ID');
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      const stoppedAt = now();
      const stuckBefore = new Date(stoppedAt.getTime() - (config.recoveryStuckAfterMinutes * 60 * 1_000));
      const job = await NasTransferJobModel.findOneAndUpdate(
        {
          _id: jobId,
          connectorId,
          status: { $in: ['staging', 'assigned', 'accepted', 'in_progress'] },
          updatedAt: { $lte: stuckBefore },
        },
        {
          $set: {
            status: 'failed',
            completedAt: stoppedAt,
            progressStage: null,
            deliveryId: null,
            leaseExpiresAt: null,
            assignedAt: null,
            acceptedAt: null,
            errorCode: 'operator_recovery_stopped',
            errorMessage: 'Stopped by an administrator after backend progress was stale.',
          },
          $unset: { idempotencyKey: 1 },
        },
        { new: true },
      );
      if (!job) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_JOB_NOT_STUCK',
          message: 'The job is not old enough or is no longer active.',
          status: 409,
        });
      }

      if (job.type === CACHE_FOR_DOWNLOAD_JOB_TYPE && job.payload?.fileShareId) {
        await FileShareModel.findOneAndUpdate(
          { _id: job.payload.fileShareId, status: 'active', deliveryStatus: 'preparing' },
          { $set: { deliveryStatus: 'failed' } },
          { new: false },
        );
      }
      if (job.type === GENERATE_THUMBNAIL_JOB_TYPE && job.payload?.fileEntryId) {
        await NasFileEntryModel.findOneAndUpdate(
          { _id: job.payload.fileEntryId, storageRootId: job.storageRootId, thumbnailStatus: 'preparing' },
          { $set: { thumbnailStatus: 'failed' } },
          { new: false },
        );
      }
      await audit({
        action: 'job_recovery_stopped',
        result: 'success',
        actorUid,
        connectorId,
        storageRootId: job.storageRootId,
        transferJobId: job._id || job.id,
        details: { jobType: job.type },
      });
      return res.json({ job: serializeTransferJob(job) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // The admin console needs the opaque connector-root identifier to request a
  // scan. Keep this on the connector-admin API rather than exposing it to the
  // normal catalogue browsing API.
  router.get('/:id/roots', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
    try {
      const connectorId = assertObjectId(req.params.id, 'Connector ID');
      const connector = await NasConnectorModel.findOne({ _id: connectorId });
      if (!connector) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_NOT_FOUND',
          message: 'Connector not found.',
          status: 404,
        });
      }

      const roots = await queryAsPlainArray(NasStorageRootModel.find({
        connectorId,
        status: { $in: ['active', 'offline'] },
      }));
      return res.json({ roots: roots.map((root) => serializeStorageRoot(root, connector)) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // An administrator can request a full metadata scan. The connector receives
  // the opaque root identifier only, then resolves it to its configured root
  // locally before sending metadata batches.
  router.post('/:id/roots/:connectorRootId/index-jobs', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
    const actorUid = currentActorUid(req.user);
    try {
      if (!actorUid) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_ACTOR_REQUIRED',
          message: 'Authenticated administrator identity is required.',
          status: 401,
        });
      }

      const connectorId = assertObjectId(req.params.id, 'Connector ID');
      const connectorRootId = normalizeConnectorRootId(req.params.connectorRootId);
      console.info('[NAS index] web_queue_requested', { connectorId, connectorRootId });
      const connector = await NasConnectorModel.findOne({
        _id: connectorId,
        status: { $in: ['active', 'offline'] },
      });
      if (!connector) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_NOT_FOUND',
          message: 'Active connector not found.',
          status: 404,
        });
      }

      const root = await NasStorageRootModel.findOne({
        connectorId,
        connectorRootId,
        status: { $in: ['active', 'offline'] },
      });
      if (!root) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_ROOT_NOT_FOUND',
          message: 'Enabled connector root not found.',
          status: 404,
        });
      }

      const queued = await jobQueue.enqueueIndexRoot({
        connectorId,
        storageRootId: root._id || root.id,
        connectorRootId,
        requestedBy: actorUid,
      });
      console.info('[NAS index] web_queue_result', {
        connectorId,
        connectorRootId,
        jobId: String(queued.job._id || queued.job.id),
        created: queued.created,
        status: queued.job.status,
        attemptCount: queued.job.attemptCount || 0,
      });
      await audit({
        action: 'scan_queued',
        result: 'success',
        actorUid,
        connectorId,
        storageRootId: root._id || root.id,
        transferJobId: queued.job._id || queued.job.id,
        details: { jobType: INDEX_ROOT_JOB_TYPE, connectorRootId, created: queued.created },
      });
      return res.status(queued.created ? 201 : 200).json({
        created: queued.created,
        job: serializeTransferJob(queued.job),
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/:id/jobs', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
    try {
      const connectorId = assertObjectId(req.params.id, 'Connector ID');
      const jobs = await jobQueue.listForConnector(connectorId);
      return res.json({ jobs: jobs.map(serializeTransferJob) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // An administrator can stop an index scan or thumbnail at any active queue
  // stage. The connector sees the cancelled state on its next bounded API
  // call and clears its matching local job before it retries the operation.
  router.post('/:id/jobs/:jobId/cancel', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
    const actorUid = currentActorUid(req.user);
    try {
      if (!actorUid) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_ACTOR_REQUIRED',
          message: 'Authenticated administrator identity is required.',
          status: 401,
        });
      }

      const connectorId = assertObjectId(req.params.id, 'Connector ID');
      const jobId = assertObjectId(req.params.jobId, 'Job ID');
      const cancelledAt = now();
      const job = await NasTransferJobModel.findOneAndUpdate(
        {
          _id: jobId,
          connectorId,
          type: { $in: [INDEX_ROOT_JOB_TYPE, GENERATE_THUMBNAIL_JOB_TYPE] },
          status: { $in: ['queued', 'assigned', 'accepted', 'in_progress'] },
        },
        {
          $set: {
            status: 'cancelled',
            deliveryId: null,
            leaseExpiresAt: null,
            assignedAt: null,
            acceptedAt: null,
            completedAt: cancelledAt,
            errorCode: 'cancelled',
            errorMessage: null,
          },
          $unset: { idempotencyKey: 1 },
        },
        { new: true },
      );
      if (!job) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_JOB_CANNOT_CANCEL',
          message: 'The connector job is no longer active and cannot be cancelled.',
          status: 409,
        });
      }

      if (job.type === GENERATE_THUMBNAIL_JOB_TYPE && job.payload?.fileEntryId) {
        await NasFileEntryModel.findOneAndUpdate(
          { _id: job.payload.fileEntryId, storageRootId: job.storageRootId, thumbnailStatus: 'preparing' },
          { $set: { thumbnailStatus: 'failed' } },
          { new: false },
        );
      }
      await audit({
        action: job.type === GENERATE_THUMBNAIL_JOB_TYPE ? 'thumbnail_cancelled' : 'scan_cancelled',
        result: 'success',
        actorUid,
        connectorId,
        storageRootId: job.storageRootId,
        transferJobId: job._id || job.id,
        details: { jobType: job.type },
      });
      return res.json({ job: serializeTransferJob(job) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // In the shared-key setup an administrator can bring back a connector that
  // was disabled accidentally. It resumes as offline until its existing local
  // service proves it still has the configured shared key with a heartbeat.
  router.post('/:id/enable', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
    const actorUid = currentActorUid(req.user);
    try {
      if (!actorUid) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_ACTOR_REQUIRED',
          message: 'Authenticated administrator identity is required.',
          status: 401,
        });
      }
      const connectorId = assertObjectId(req.params.id, 'Connector ID');
      const connector = await NasConnectorModel.findOneAndUpdate(
        { _id: connectorId, status: 'revoked' },
        {
          $set: {
            status: 'offline',
            revokedAt: null,
            revokedBy: null,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        },
        { new: true },
      );
      if (!connector) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_NOT_FOUND',
          message: 'Disabled connector not found.',
          status: 404,
        });
      }

      await NasStorageRootModel.updateMany(
        { connectorId, status: 'disabled' },
        { $set: { status: 'active' } },
      );

      await audit({
        action: 'connector_enabled',
        result: 'success',
        actorUid,
        connectorId,
      });
      return res.json({ connector: serializeConnector(connector) });
    } catch (error) {
      await audit({
        action: 'connector_enabled',
        result: 'failure',
        actorUid,
        details: { code: error?.code || error?.name || 'unknown' },
      });
      return sendError(res, error);
    }
  });

  router.post('/:id/revoke', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
    const actorUid = currentActorUid(req.user);
    try {
      if (!actorUid) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_ACTOR_REQUIRED',
          message: 'Authenticated administrator identity is required.',
          status: 401,
        });
      }
      const connectorId = assertObjectId(req.params.id, 'Connector ID');
      const revokedAt = now();
      const connector = await NasConnectorModel.findOneAndUpdate(
        { _id: connectorId, status: { $ne: 'revoked' } },
        { $set: { status: 'revoked', revokedAt, revokedBy: actorUid } },
        { new: true },
      );
      if (!connector) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_NOT_FOUND',
          message: 'Active connector not found.',
          status: 404,
        });
      }

      try {
        await NasStorageRootModel.updateMany(
          { connectorId },
          { $set: { status: 'disabled' } },
        );
      } catch (error) {
        console.error('Failed to disable NAS roots for revoked connector:', error?.code || error?.name || 'unknown');
      }

      await audit({
        action: 'connector_revoked',
        result: 'success',
        actorUid,
        connectorId,
      });
      return res.json({ connector: serializeConnector(connector) });
    } catch (error) {
      await audit({
        action: 'connector_revoked',
        result: 'failure',
        actorUid,
        details: { code: error?.code || error?.name || 'unknown' },
      });
      return sendError(res, error);
    }
  });

  return router;
};

module.exports = {
  NasConnectorApiError,
  createTransportGuard,
  createNasConnectorRoutes,
  serializeConnector,
};
