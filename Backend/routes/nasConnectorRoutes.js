'use strict';

const crypto = require('crypto');
const express = require('express');
const { authenticate, authorizeRole } = require('../auth/authMiddleware');
const {
  authenticateConnectorKeyAuthorization,
  createConnectorAuthenticateMiddleware,
} = require('../auth/nasConnectorMiddleware');
const { getFileServerConfig } = require('../config/fileServerConfig');
const { getNasConnectorConfig } = require('../config/nasConnectorConfig');
const NasAuditEvent = require('../models/nasAuditEvent');
const NasConnector = require('../models/nasConnector');
const NasEnrollmentToken = require('../models/nasEnrollmentToken');
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
const { createFileStorageService, FileStorageError } = require('../services/fileStorageService');
const {
  normalizeCatalogueChangeBatch,
  normalizeIndexBatch,
  normalizeIndexCompletion,
  normalizeIndexStart,
} = require('../services/nasCatalogueValidation');
const {
  NasConnectorSecretError,
  createEnrollmentToken,
  hashDeviceSecret,
  hashEnrollmentToken,
  normalizeDeviceSecret,
  safelyCompareHashes,
} = require('../services/nasConnectorSecrets');
const {
  NasConnectorValidationError,
  assertObjectId,
  normalizeAgentVersion,
  normalizeConnectorRoot,
  normalizeConnectorRootId,
  normalizeDisplayName,
  normalizeHeartbeatState,
  normalizeInstallationId,
  normalizeQueueLength,
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

const queryWithSelection = async (query, selection) => {
  if (!query) return query;
  return typeof query.select === 'function' ? query.select(selection) : query;
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
    lastSeenAt: value.lastSeenAt || null,
    revokedAt: value.revokedAt || null,
    createdAt: value.createdAt || null,
    updatedAt: value.updatedAt || null,
  };
};

const serializeStorageRoot = (root) => {
  const value = toPlainObject(root);
  return {
    id: String(value._id || value.id || ''),
    connectorId: String(value.connectorId || ''),
    connectorRootId: value.connectorRootId,
    name: value.displayName,
    status: value.status,
    uploadsEnabled: Boolean(value.uploadsEnabled),
    lastIndexedAt: value.lastIndexedAt || null,
    lastFullScanAt: value.lastFullScanAt || null,
    lastScanError: value.lastScanError || null,
  };
};

const serializeEnrollment = (enrollment) => {
  const value = toPlainObject(enrollment);
  return {
    id: String(value._id || value.id || ''),
    name: value.name,
    expiresAt: value.expiresAt,
  };
};

const genericEnrollmentFailure = () => new NasConnectorApiError({
  code: 'NAS_CONNECTOR_ENROLLMENT_INVALID',
  message: 'Enrollment token is invalid or expired.',
  status: 401,
});

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

const connectorRootUnavailable = () => new NasConnectorApiError({
  code: 'NAS_CONNECTOR_ROOT_UNAVAILABLE',
  message: 'The configured connector root is no longer active.',
  status: 409,
});

const ENROLLMENT_SECRET_SELECTION = '+tokenHash +targetCredentialHash +consumedDeviceSecretHash';
const CONNECTOR_CREDENTIAL_SELECTION = '+credentialHash';

const sameCredentialHash = (left, right) => safelyCompareHashes(left, right);

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
    || error instanceof NasConnectorSecretError
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

  // Keep errors redacted: route inputs can contain enrollment tokens and device secrets.
  console.error('NAS connector route failed:', error?.code || error?.name || 'unknown');
  return res.status(500).json({
    code: 'NAS_CONNECTOR_OPERATION_FAILED',
    error: 'The NAS connector operation failed.',
  });
};

const normalizeEnrollmentRequest = (body = {}) => ({
  installationId: normalizeInstallationId(body.installationId),
  deviceSecret: normalizeDeviceSecret(body.deviceSecret),
  agentVersion: normalizeAgentVersion(body.agentVersion),
  root: normalizeConnectorRoot(body.root),
});

const normalizeSharedConnectionRequest = (body = {}) => ({
  installationId: normalizeInstallationId(body.installationId),
  agentVersion: normalizeAgentVersion(body.agentVersion),
  root: normalizeConnectorRoot(body.root),
});

const normalizeHeartbeatRequest = (body = {}) => ({
  installationId: normalizeInstallationId(body.installationId),
  agentVersion: normalizeAgentVersion(body.agentVersion),
  root: normalizeConnectorRoot(body.root),
  state: normalizeHeartbeatState(body.state),
  queueLength: normalizeQueueLength(body.queueLength),
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

const createNasConnectorRoutes = (dependencies = {}) => {
  const config = dependencies.config || getNasConnectorConfig();
  const NasConnectorModel = dependencies.NasConnectorModel || NasConnector;
  const NasEnrollmentTokenModel = dependencies.NasEnrollmentTokenModel || NasEnrollmentToken;
  const NasStorageRootModel = dependencies.NasStorageRootModel || NasStorageRoot;
  const NasFileEntryModel = dependencies.NasFileEntryModel || NasFileEntry;
  const FileShareModel = dependencies.FileShareModel || FileShare;
  const NasTransferJobModel = dependencies.NasTransferJobModel || NasTransferJob;
  const NasAuditEventModel = dependencies.NasAuditEventModel || NasAuditEvent;
  const authenticateMiddleware = dependencies.authenticateMiddleware || authenticate;
  const authorizeAdminMiddleware = dependencies.authorizeAdminMiddleware || authorizeRole('admin');
  const requireHttpsMiddleware = dependencies.requireHttpsMiddleware
    || createTransportGuard(config.allowInsecureHttp === true);
  const enrollmentLimiter = dependencies.enrollmentLimiter || passThrough;
  const heartbeatLimiter = dependencies.heartbeatLimiter || passThrough;
  const controlSessionRegistry = dependencies.controlSessionRegistry || null;
  const jobQueue = dependencies.jobQueue || new NasConnectorJobQueue({
    NasTransferJobModel,
    leaseSeconds: Number.isSafeInteger(config.jobLeaseSeconds) ? config.jobLeaseSeconds : 90,
    now: dependencies.now || (() => new Date()),
  });
  const connectorAuthenticateMiddleware = dependencies.connectorAuthenticateMiddleware
    || createConnectorAuthenticateMiddleware({ NasConnectorModel, sharedSecret: config.sharedSecret });
  const now = dependencies.now || (() => new Date());
  const suppliedFileServerConfig = dependencies.fileServerConfig || null;
  let cacheStorage = dependencies.cacheStorage || null;
  let thumbnailStorage = dependencies.thumbnailStorage || null;
  let stagingStorage = dependencies.stagingStorage || null;
  // Create this only when a Phase-4 endpoint is used. It keeps the existing
  // control-plane route unit tests independent of unrelated S3 environment.
  const getCacheStorage = () => {
    if (cacheStorage) return cacheStorage;
    const fileServerConfig = suppliedFileServerConfig || getFileServerConfig();
    cacheStorage = createFileStorageService({
      config: {
        ...fileServerConfig,
        region: config.region,
        bucketName: config.bucketName,
        prefix: config.cachePrefix,
        credentials: config.credentials || fileServerConfig.credentials,
        uploadUrlTtlSeconds: config.connectorTransferUrlTtlSeconds,
        downloadUrlTtlSeconds: config.connectorTransferUrlTtlSeconds,
      },
    });
    return cacheStorage;
  };
  const getThumbnailStorage = () => {
    if (thumbnailStorage) return thumbnailStorage;
    const fileServerConfig = suppliedFileServerConfig || getFileServerConfig();
    thumbnailStorage = createFileStorageService({
      config: {
        ...fileServerConfig,
        region: config.region,
        bucketName: config.bucketName,
        prefix: config.thumbnailPrefix,
        credentials: config.credentials || fileServerConfig.credentials,
        uploadUrlTtlSeconds: config.connectorTransferUrlTtlSeconds,
        downloadUrlTtlSeconds: config.connectorTransferUrlTtlSeconds,
      },
    });
    return thumbnailStorage;
  };
  const getStagingStorage = () => {
    if (stagingStorage) return stagingStorage;
    const fileServerConfig = suppliedFileServerConfig || getFileServerConfig();
    stagingStorage = createFileStorageService({
      config: {
        ...fileServerConfig,
        region: config.region,
        bucketName: config.bucketName,
        prefix: config.uploadStagingPrefix,
        credentials: config.credentials || fileServerConfig.credentials,
        downloadUrlTtlSeconds: config.connectorTransferUrlTtlSeconds,
      },
    });
    return stagingStorage;
  };
  const router = express.Router();

  // Closing a persistent control session is a best-effort side effect after a
  // credential state change has committed. A registry failure must never turn
  // a successfully persisted revocation or credential rotation into an API
  // error, and it never receives a raw device credential.
  const closeControlSession = (connectorId, options = undefined) => {
    try {
      if (connectorId && typeof controlSessionRegistry?.closeConnector === 'function') {
        controlSessionRegistry.closeConnector(connectorId, options);
      }
    } catch {
      // The periodic channel credential check remains a defense in depth if a
      // process-local session registry is unexpectedly unavailable.
    }
  };

  const audit = async (event) => {
    try {
      await NasAuditEventModel.create(event);
    } catch (error) {
      // Auditing must not undo a successful enrollment or revocation.
      console.error('Failed to record NAS connector audit event:', error?.code || error?.name || 'unknown');
    }
  };

  const dispatchNextJob = (connectorId) => {
    if (typeof jobQueue?.requestDispatch === 'function') {
      void jobQueue.requestDispatch(connectorId);
    }
  };

  const findConnectorWithCredential = async (filter) => queryWithSelection(
    NasConnectorModel.findOne(filter),
    CONNECTOR_CREDENTIAL_SELECTION,
  );

  const findEnrollmentWithSecrets = async (filter) => queryWithSelection(
    NasEnrollmentTokenModel.findOne(filter),
    ENROLLMENT_SECRET_SELECTION,
  );

  const enrollmentRecoveryWindowSeconds = () => (
    Number.isSafeInteger(config.enrollmentRecoveryTtlSeconds)
      ? config.enrollmentRecoveryTtlSeconds
      : 60 * 60
  );

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

  const issueEnrollmentToken = async ({
    name,
    actorUid,
    purpose = 'initial_enrollment',
    targetConnectorId = null,
    targetCredentialHash = null,
  }) => {
    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + (config.enrollmentTokenTtlSeconds * 1000));
    const recoveryExpiresAt = new Date(
      expiresAt.getTime() + (enrollmentRecoveryWindowSeconds() * 1000),
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { token, tokenHash } = createEnrollmentToken(config.authHmacSecret);
      try {
        const enrollment = await NasEnrollmentTokenModel.create({
          name,
          tokenHash,
          createdBy: actorUid,
          expiresAt,
          recoveryExpiresAt,
          purpose,
          targetConnectorId,
          targetCredentialHash,
        });
        return { enrollment, token };
      } catch (error) {
        if (error?.code !== 11000 || attempt === 2) throw error;
      }
    }

    throw new NasConnectorApiError({
      code: 'NAS_CONNECTOR_OPERATION_FAILED',
      message: 'The NAS connector operation failed.',
      status: 500,
    });
  };

  const enrollmentMatchesRecoveryRequest = ({ enrollment, request, deviceSecretHash, at }) => {
    if (!enrollment?.consumedAt || enrollment.revokedAt || !enrollment.recoveryExpiresAt) return false;
    if (new Date(enrollment.recoveryExpiresAt).getTime() <= at.getTime()) return false;
    return enrollment.consumedInstallationId === request.installationId
      && sameCredentialHash(enrollment.consumedDeviceSecretHash, deviceSecretHash);
  };

  // Claiming is atomic. If the same Service retries after a lost response, the
  // stored HMAC binding lets it resume only the exact same request; a raw token
  // alone remains insufficient to replay or discover a connector.
  const claimEnrollment = async ({ tokenHash, request, deviceSecretHash, redeemedAt }) => {
    const claimed = await queryWithSelection(NasEnrollmentTokenModel.findOneAndUpdate(
      {
        tokenHash,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { $gt: redeemedAt },
      },
      {
        $set: {
          consumedAt: redeemedAt,
          consumedInstallationId: request.installationId,
          consumedDeviceSecretHash: deviceSecretHash,
        },
      },
      { new: true },
    ), ENROLLMENT_SECRET_SELECTION);
    if (claimed) return { enrollment: claimed, recovered: false };

    const prior = await findEnrollmentWithSecrets({ tokenHash });
    if (!enrollmentMatchesRecoveryRequest({
      enrollment: prior,
      request,
      deviceSecretHash,
      at: redeemedAt,
    })) {
      throw genericEnrollmentFailure();
    }
    return { enrollment: prior, recovered: true };
  };

  const connectorMatchesEnrollment = ({ connector, request, deviceSecretHash }) => (
    connector
    && connector.installationId === request.installationId
    && connector.status !== 'revoked'
    && sameCredentialHash(connector.credentialHash, deviceSecretHash)
  );

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

  const activateInitialConnector = async ({ connector, enrollment, request, deviceSecretHash, redeemedAt }) => {
    const activated = await queryWithSelection(NasConnectorModel.findOneAndUpdate(
      {
        _id: connector._id,
        installationId: request.installationId,
        enrollmentId: enrollment._id,
        credentialHash: deviceSecretHash,
        status: { $ne: 'revoked' },
      },
      {
        $set: {
          status: 'active',
          agentVersion: request.agentVersion,
          lastSeenAt: redeemedAt,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      },
      { new: true },
    ), CONNECTOR_CREDENTIAL_SELECTION);
    if (activated) return activated;

    const current = await findConnectorWithCredential({
      _id: connector._id,
      installationId: request.installationId,
      enrollmentId: enrollment._id,
    });
    if (!connectorMatchesEnrollment({ connector: current, request, deviceSecretHash })
      || current.status !== 'active') {
      throw genericEnrollmentFailure();
    }
    return current;
  };

  const attachEnrollmentToConnector = async ({ enrollment, request, deviceSecretHash, connector }) => {
    if (typeof NasEnrollmentTokenModel.updateOne !== 'function') return;
    await NasEnrollmentTokenModel.updateOne(
      {
        _id: enrollment._id,
        consumedInstallationId: request.installationId,
        consumedDeviceSecretHash: deviceSecretHash,
      },
      { $set: { consumedByConnectorId: connector._id } },
    );
  };

  const completeInitialEnrollment = async ({ enrollment, request, deviceSecretHash, redeemedAt }) => {
    if (enrollment.consumedByConnectorId) {
      const connector = await findConnectorWithCredential({
        _id: enrollment.consumedByConnectorId,
        installationId: request.installationId,
      });
      if (!connectorMatchesEnrollment({ connector, request, deviceSecretHash })) {
        throw genericEnrollmentFailure();
      }
      return { connector, completedNow: false };
    }

    let connector = await findConnectorWithCredential({
      installationId: request.installationId,
      enrollmentId: enrollment._id,
    });
    if (!connector) {
      try {
        connector = await NasConnectorModel.create({
          name: enrollment.name,
          installationId: request.installationId,
          enrollmentId: enrollment._id,
          credentialHash: deviceSecretHash,
          // Do not make a newly-created connector usable until its root is
          // persisted. A retry with the same bound request resumes this state.
          status: 'enrolling',
          agentVersion: request.agentVersion,
          lastSeenAt: redeemedAt,
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        connector = await findConnectorWithCredential({
          installationId: request.installationId,
          enrollmentId: enrollment._id,
        });
      }
    }

    if (!connectorMatchesEnrollment({ connector, request, deviceSecretHash })) {
      throw genericEnrollmentFailure();
    }

    await ensureStorageRoot({ connector, root: request.root });
    connector = await activateInitialConnector({
      connector,
      enrollment,
      request,
      deviceSecretHash,
      redeemedAt,
    });
    await attachEnrollmentToConnector({ enrollment, request, deviceSecretHash, connector });
    return { connector, completedNow: true };
  };

  const completeReEnrollment = async ({ enrollment, request, deviceSecretHash, redeemedAt }) => {
    if (!enrollment.targetConnectorId || !enrollment.targetCredentialHash) {
      throw genericEnrollmentFailure();
    }

    if (enrollment.consumedByConnectorId) {
      const connector = await findConnectorWithCredential({
        _id: enrollment.consumedByConnectorId,
        installationId: request.installationId,
      });
      if (!connectorMatchesEnrollment({ connector, request, deviceSecretHash })
        || connectorIdOf(connector) !== String(enrollment.targetConnectorId)) {
        throw genericEnrollmentFailure();
      }
      return { connector, completedNow: false };
    }

    let connector = await findConnectorWithCredential({
      _id: enrollment.targetConnectorId,
      installationId: request.installationId,
    });
    if (!connector || !['active', 'offline', 'revoked'].includes(connector.status)) {
      throw genericEnrollmentFailure();
    }

    // A re-enrollment is a credential rotation, not a way to reactivate a
    // connector with its old secret. The only time the submitted secret may
    // already be current is a recovery retry after this same token's prior
    // rotation completed but its response/token binding did not.
    if (sameCredentialHash(deviceSecretHash, enrollment.targetCredentialHash)) {
      throw genericEnrollmentFailure();
    }

    if (!sameCredentialHash(connector.credentialHash, deviceSecretHash)) {
      if (!sameCredentialHash(connector.credentialHash, enrollment.targetCredentialHash)) {
        throw genericEnrollmentFailure();
      }

      // Persist the submitted root before restoring a usable device credential.
      // For a revoked connector the old credential is already rejected; for an
      // offline/active connector its existing root is normally already active.
      // This ordering avoids leaving a newly active credential with no root if
      // the root write itself fails.
      await ensureStorageRoot({ connector, root: request.root });

      connector = await queryWithSelection(NasConnectorModel.findOneAndUpdate(
        {
          _id: enrollment.targetConnectorId,
          installationId: request.installationId,
          credentialHash: enrollment.targetCredentialHash,
          status: { $in: ['active', 'offline', 'revoked'] },
        },
        {
          $set: {
            credentialHash: deviceSecretHash,
            status: 'active',
            agentVersion: request.agentVersion,
            lastSeenAt: redeemedAt,
            revokedAt: null,
            revokedBy: null,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        },
        { new: true },
      ), CONNECTOR_CREDENTIAL_SELECTION);

      // The old secret is no longer valid immediately after this write. Close
      // its live WebSocket session now rather than waiting for the next ping.
      if (connector) {
        closeControlSession(enrollment.targetConnectorId, {
          expectedCredentialHash: enrollment.targetCredentialHash,
        });
      }

      if (!connector) {
        connector = await findConnectorWithCredential({
          _id: enrollment.targetConnectorId,
          installationId: request.installationId,
        });
      }
    }

    if (!connectorMatchesEnrollment({ connector, request, deviceSecretHash })) {
      throw genericEnrollmentFailure();
    }

    // This also completes a retry that previously rotated the credential but
    // lost its response before the root or token-binding write completed.
    await ensureStorageRoot({ connector, root: request.root });
    await attachEnrollmentToConnector({ enrollment, request, deviceSecretHash, connector });
    return { connector, completedNow: true };
  };

  // Enrollment tokens and connector credentials are never accepted over cleartext HTTP.
  router.use(requireHttpsMiddleware);

  // Trusted small-installation connection flow. It creates or reuses the
  // connector record identified by the local installation ID, while all later
  // heartbeat/job requests are bound to the returned connector ID plus the
  // same shared key. No token or per-device credential rotation is involved.
  router.post('/connect', requireSharedConnectorKey, async (req, res) => {
    try {
      const request = normalizeSharedConnectionRequest(req.body);
      const connectedAt = now();
      const sharedKeyHash = hashDeviceSecret(config.sharedSecret, config.authHmacSecret);
      let connector = await findConnectorWithCredential({ installationId: request.installationId });

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
            credentialHash: sharedKeyHash,
            status: 'active',
            agentVersion: request.agentVersion,
            lastSeenAt: connectedAt,
          });
        } catch (error) {
          if (error?.code !== 11000) throw error;
          connector = await findConnectorWithCredential({ installationId: request.installationId });
        }
      }

      if (!connector || connector.status === 'revoked') throw genericConnectorFailure();

      connector = await queryWithSelection(NasConnectorModel.findOneAndUpdate(
        { _id: connector._id, installationId: request.installationId, status: { $in: ['enrolling', 'active', 'offline'] } },
        {
          $set: {
            name: request.root.displayName,
            credentialHash: sharedKeyHash,
            status: 'active',
            agentVersion: request.agentVersion,
            lastSeenAt: connectedAt,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        },
        { new: true },
      ), CONNECTOR_CREDENTIAL_SELECTION);
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

  router.post('/enrollment-tokens', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
    const actorUid = currentActorUid(req.user);
    try {
      if (!actorUid) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_ACTOR_REQUIRED',
          message: 'Authenticated administrator identity is required.',
          status: 401,
        });
      }
      const name = normalizeDisplayName(req.body?.name);
      const { enrollment, token } = await issueEnrollmentToken({ name, actorUid });

      await audit({
        action: 'enrollment_token_created',
        result: 'success',
        actorUid,
        details: { enrollmentId: String(enrollment?._id || ''), expiresAt: enrollment.expiresAt },
      });
      res.set({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' });
      return res.status(201).json({
        enrollment: serializeEnrollment(enrollment),
        enrollmentToken: token,
      });
    } catch (error) {
      await audit({
        action: 'enrollment_token_created',
        result: 'failure',
        actorUid,
        details: { code: error?.code || error?.name || 'unknown' },
      });
      return sendError(res, error);
    }
  });

  // A re-enrollment token is deliberately a separate administrator action. It
  // is bound to this connector and the credential state that exists now; it can
  // restore an offline or revoked connector, but cannot be reused after another
  // credential rotation or after an administrator revokes outstanding tokens.
  router.post('/:id/re-enrollment-tokens', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
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
      const connector = await findConnectorWithCredential({ _id: connectorId });
      if (!connector) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_NOT_FOUND',
          message: 'Connector not found.',
          status: 404,
        });
      }

      const { enrollment, token } = await issueEnrollmentToken({
        name: connector.name,
        actorUid,
        purpose: 're_enrollment',
        targetConnectorId: connector._id,
        targetCredentialHash: connector.credentialHash,
      });

      await audit({
        action: 'connector_reenrollment_token_created',
        result: 'success',
        actorUid,
        connectorId: connector._id,
        details: { enrollmentId: String(enrollment?._id || ''), expiresAt: enrollment.expiresAt },
      });
      res.set({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' });
      return res.status(201).json({
        enrollment: serializeEnrollment(enrollment),
        enrollmentToken: token,
      });
    } catch (error) {
      await audit({
        action: 'connector_reenrollment_token_created',
        result: 'failure',
        actorUid,
        details: { code: error?.code || error?.name || 'unknown' },
      });
      return sendError(res, error);
    }
  });

  router.post('/enroll', enrollmentLimiter, async (req, res) => {
    try {
      const request = normalizeEnrollmentRequest(req.body);
      let tokenHash;
      try {
        tokenHash = hashEnrollmentToken(req.body?.enrollmentToken, config.authHmacSecret);
      } catch (error) {
        if (error instanceof NasConnectorSecretError) throw genericEnrollmentFailure();
        throw error;
      }

      const redeemedAt = now();
      const deviceSecretHash = hashDeviceSecret(request.deviceSecret, config.authHmacSecret);
      // Reject an attempt to reuse the connector's old credential before the
      // token claim. This keeps the admin-issued rotation token usable with a
      // proper fresh credential after an operator mistake.
      const preflightEnrollment = await findEnrollmentWithSecrets({ tokenHash });
      if (preflightEnrollment?.purpose === 're_enrollment'
        && sameCredentialHash(preflightEnrollment.targetCredentialHash, deviceSecretHash)) {
        throw genericEnrollmentFailure();
      }
      const { enrollment, recovered } = await claimEnrollment({
        tokenHash,
        request,
        deviceSecretHash,
        redeemedAt,
      });
      const reEnrollment = enrollment.purpose === 're_enrollment';
      const completion = reEnrollment
        ? await completeReEnrollment({ enrollment, request, deviceSecretHash, redeemedAt })
        : await completeInitialEnrollment({ enrollment, request, deviceSecretHash, redeemedAt });

      if (completion.completedNow) {
        await audit({
          action: reEnrollment ? 'connector_reenrolled' : 'connector_enrolled',
          result: 'success',
          connectorId: completion.connector._id,
          details: {
            installationId: request.installationId,
            connectorRootId: request.root.connectorRootId,
          },
        });
      }
      res.set({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' });
      return res.status(recovered ? 200 : 201).json({
        connector: serializeConnector(completion.connector),
        heartbeatIntervalSeconds: config.heartbeatIntervalSeconds,
      });
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
      await NasFileEntryModel.bulkWrite(request.entries.map((entry) => ({
        updateOne: {
          filter: { storageRootId: job.storageRootId, relativePath: entry.relativePath },
          update: {
            $set: {
              ...entry,
              lastIndexedAt: indexedAt,
              lastSeenScanId: request.scanId,
              deletedAt: null,
            },
            $setOnInsert: {
              storageRootId: job.storageRootId,
              availabilityStatus: 'offline',
              thumbnailStatus: 'not_requested',
            },
          },
          upsert: true,
        },
      })), { ordered: false });
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
      dispatchNextJob(connectorId);
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

  // Phase 4: the connector asks to begin a cache copy only after its durable
  // WSS assignment was accepted. The response contains a relative path and a
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
      if (!job || !isPlainObject(job.payload)) throw genericConnectorFailure();
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
      if (!job || !isPlainObject(job.payload)) throw genericConnectorFailure();
      const fileEntryId = assertObjectId(job.payload.fileEntryId, 'File entry ID');
      const fileShareId = assertObjectId(job.payload.fileShareId, 'File share ID');
      if (job.status === 'completed') return res.json({ job: serializeTransferJob(job) });

      const [entry, share] = await Promise.all([
        NasFileEntryModel.findOne({ _id: fileEntryId, storageRootId: job.storageRootId, entryType: 'file', deletedAt: null }),
        FileShareModel.findOne({ _id: fileShareId, sourceType: 'nas_file', nasFileEntryId: fileEntryId, status: 'active', deliveryStatus: 'preparing' }),
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
        { _id: fileShareId, status: 'active', deliveryStatus: 'preparing', cacheExpiresAt: { $gt: completedAt } },
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
      if (!completed) throw genericConnectorFailure();
      console.info('[NAS cache] upload_completed', { connectorId, jobId, fileEntryId, fileShareId });
      dispatchNextJob(connectorId);
      return res.json({ job: serializeTransferJob(completed) });
    } catch (error) {
      if (error instanceof FileStorageError) {
        return res.status(503).json({ code: 'NAS_CACHE_STORAGE_UNAVAILABLE', error: 'Temporary file storage is unavailable.' });
      }
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
        },
        { new: true },
      );
      if (!completed) throw genericConnectorFailure();
      await getStagingStorage().deleteFile({ key: job.payload.stagingKey }).catch(() => {});
      await audit({ action: 'upload_completed', result: 'success', connectorId, storageRootId: job.storageRootId, transferJobId: jobId, details: {} });
      console.info('[NAS upload] connector_write_completed', { connectorId, jobId, sizeBytes: completion.sizeBytes });
      dispatchNextJob(connectorId);
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
        },
        { new: true },
      );
      if (!job) throw genericConnectorFailure();
      if (job.payload?.stagingKey) await getStagingStorage().deleteFile({ key: job.payload.stagingKey }).catch(() => {});
      await audit({ action: 'upload_completed', result: 'failure', connectorId, storageRootId: job.storageRootId, transferJobId: jobId, details: { code: failure.code } });
      console.info('[NAS upload] connector_write_failed', { connectorId, jobId, code: failure.code });
      dispatchNextJob(connectorId);
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
      if (!job || !isPlainObject(job.payload)) throw genericConnectorFailure();
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
      if (!job || !isPlainObject(job.payload)) throw genericConnectorFailure();
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
      if (!completed) throw genericConnectorFailure();
      await audit({ action: 'thumbnail_completed', result: 'success', connectorId, storageRootId: job.storageRootId, fileEntryId, transferJobId: jobId, details: {} });
      console.info('[NAS thumbnail] completed', { connectorId, jobId, fileEntryId, sizeBytes: completion.sizeBytes });
      dispatchNextJob(connectorId);
      return res.json({ job: serializeTransferJob(completed) });
    } catch (error) {
      if (error instanceof FileStorageError) {
        return res.status(503).json({ code: 'NAS_THUMBNAIL_STORAGE_UNAVAILABLE', error: 'Thumbnail storage is unavailable.' });
      }
      return sendError(res, error);
    }
  });

  // The local Windows Control Center can start a scan directly. This is not a
  // browser-facing action: it is authenticated with the connector credential
  // and gives the operator immediate local feedback even when a queued WSS
  // assignment has not arrived yet.
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

  router.get('/', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
    try {
      await reconcileStaleConnectorLiveness(now());
      const connectors = await queryAsPlainArray(NasConnectorModel.find({}));
      return res.json({ connectors: connectors.map(serializeConnector) });
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
      return res.json({ roots: roots.map(serializeStorageRoot) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // A no-op live-channel check for setup/testing. It intentionally carries no
  // filesystem or transfer data; the Connector displays a local activity item
  // only after its active WSS session receives this message.
  router.post('/:id/test-message', authenticateMiddleware, authorizeAdminMiddleware, async (req, res) => {
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
      const connector = await NasConnectorModel.findOne({
        _id: connectorId,
        status: 'active',
      });
      if (!connector) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_NOT_LIVE',
          message: 'The connector is not currently live.',
          status: 409,
        });
      }

      const sent = typeof controlSessionRegistry?.sendTestMessage === 'function'
        && controlSessionRegistry.sendTestMessage(connectorId);
      if (!sent) {
        throw new NasConnectorApiError({
          code: 'NAS_CONNECTOR_CONTROL_UNAVAILABLE',
          message: 'The connector control channel is not currently available.',
          status: 409,
        });
      }

      await audit({
        action: 'connector_test_sent',
        result: 'success',
        actorUid,
        connectorId,
        details: {},
      });
      return res.status(202).json({ sent: true });
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
        // The browser must receive a response as soon as Mongo has the job.
        // WSS delivery is intentionally asynchronous and reports progress via
        // the job polling already shown in the admin screen.
        waitForDelivery: false,
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

  // An administrator can stop an index scan at any active queue stage. The
  // connector sees the cancelled state on its next bounded API call and clears
  // its matching local job before it can send further metadata.
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
          type: INDEX_ROOT_JOB_TYPE,
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
          message: 'The index scan is no longer active and cannot be cancelled.',
          status: 409,
        });
      }

      await audit({
        action: 'scan_cancelled',
        result: 'success',
        actorUid,
        connectorId,
        storageRootId: job.storageRootId,
        transferJobId: job._id || job.id,
        details: { jobType: INDEX_ROOT_JOB_TYPE },
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

      closeControlSession(connectorId);

      try {
        await NasStorageRootModel.updateMany(
          { connectorId },
          { $set: { status: 'disabled' } },
        );
      } catch (error) {
        console.error('Failed to disable NAS roots for revoked connector:', error?.code || error?.name || 'unknown');
      }

      // A later administrator can explicitly issue a new re-enrollment token
      // for this revoked connector. Existing unused tokens must not be able to
      // undo an emergency revocation.
      try {
        if (typeof NasEnrollmentTokenModel.updateMany === 'function') {
          await NasEnrollmentTokenModel.updateMany(
            {
              targetConnectorId: connectorId,
              purpose: 're_enrollment',
              consumedAt: null,
              revokedAt: null,
            },
            { $set: { revokedAt, revokedBy: actorUid } },
          );
        }
      } catch (error) {
        console.error('Failed to revoke outstanding NAS re-enrollment tokens:', error?.code || error?.name || 'unknown');
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
