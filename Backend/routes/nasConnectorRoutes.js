'use strict';

const express = require('express');
const { authenticate, authorizeRole } = require('../auth/authMiddleware');
const { createConnectorAuthenticateMiddleware } = require('../auth/nasConnectorMiddleware');
const { getNasConnectorConfig } = require('../config/nasConnectorConfig');
const NasAuditEvent = require('../models/nasAuditEvent');
const NasConnector = require('../models/nasConnector');
const NasEnrollmentToken = require('../models/nasEnrollmentToken');
const NasStorageRoot = require('../models/nasStorageRoot');
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

const ENROLLMENT_SECRET_SELECTION = '+tokenHash +targetCredentialHash +consumedDeviceSecretHash';
const CONNECTOR_CREDENTIAL_SELECTION = '+credentialHash';

const sameCredentialHash = (left, right) => safelyCompareHashes(left, right);

const defaultRequireHttps = (req, res, next) => {
  if (req.secure) return next();
  return res.status(400).json({
    code: 'NAS_CONNECTOR_HTTPS_REQUIRED',
    error: 'NAS connector requests require HTTPS.',
  });
};

const passThrough = (req, res, next) => next();

const sendError = (res, error) => {
  if (error instanceof NasConnectorApiError || error instanceof NasConnectorValidationError || error instanceof NasConnectorSecretError) {
    return res.status(error.status || 400).json({ code: error.code, error: error.message });
  }

  if (error?.code === 11000) {
    return res.status(409).json({
      code: 'NAS_CONNECTOR_CONFLICT',
      error: 'A connector with this installation ID already exists.',
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

const normalizeHeartbeatRequest = (body = {}) => ({
  installationId: normalizeInstallationId(body.installationId),
  agentVersion: normalizeAgentVersion(body.agentVersion),
  root: normalizeConnectorRoot(body.root),
  state: normalizeHeartbeatState(body.state),
  queueLength: normalizeQueueLength(body.queueLength),
});

const createNasConnectorRoutes = (dependencies = {}) => {
  const config = dependencies.config || getNasConnectorConfig();
  const NasConnectorModel = dependencies.NasConnectorModel || NasConnector;
  const NasEnrollmentTokenModel = dependencies.NasEnrollmentTokenModel || NasEnrollmentToken;
  const NasStorageRootModel = dependencies.NasStorageRootModel || NasStorageRoot;
  const NasAuditEventModel = dependencies.NasAuditEventModel || NasAuditEvent;
  const authenticateMiddleware = dependencies.authenticateMiddleware || authenticate;
  const authorizeAdminMiddleware = dependencies.authorizeAdminMiddleware || authorizeRole('admin');
  const requireHttpsMiddleware = dependencies.requireHttpsMiddleware || defaultRequireHttps;
  const enrollmentLimiter = dependencies.enrollmentLimiter || passThrough;
  const heartbeatLimiter = dependencies.heartbeatLimiter || passThrough;
  const controlSessionRegistry = dependencies.controlSessionRegistry || null;
  const connectorAuthenticateMiddleware = dependencies.connectorAuthenticateMiddleware
    || createConnectorAuthenticateMiddleware({ NasConnectorModel, hmacSecret: config.authHmacSecret });
  const now = dependencies.now || (() => new Date());
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
  createNasConnectorRoutes,
  defaultRequireHttps,
  serializeConnector,
};
