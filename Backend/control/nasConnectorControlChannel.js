'use strict';

const crypto = require('crypto');
const { URL } = require('url');
const { WebSocket, WebSocketServer } = require('ws');

const {
  authenticateConnectorAuthorization,
} = require('../auth/nasConnectorMiddleware');
const {
  NasConnectorValidationError,
  normalizeAgentVersion,
  normalizeConnectorRootId,
  normalizeConnectorRoot,
  normalizeHeartbeatState,
  normalizeInstallationId,
  normalizeQueueLength,
} = require('../services/nasConnectorValidation');
const { safelyCompareHashes } = require('../services/nasConnectorSecrets');
const { normalizeAcknowledgement } = require('../services/nasConnectorJobQueue');

const CONTROL_CHANNEL_PATH = '/api/nas-connectors/control/socket';
const CONTROL_SUBPROTOCOL = 'adimari.nas-control.v1';
const CONTROL_PROTOCOL_VERSION = 1;
const MAX_CONTROL_MESSAGE_BYTES = 64 * 1024;
const HELLO_TIMEOUT_MS = 10_000;
const MAX_SESSION_MESSAGE_IDS = 100_000;
const UPGRADE_RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_TRACKED_UPGRADE_ADDRESSES = 10_000;
const CLOSE_CODES = Object.freeze({
  credentialInvalid: 4001,
  replaced: 4002,
  protocolInvalid: 4003,
  livenessTimeout: 4004,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const ENVELOPE_KEYS = new Set(['v', 'type', 'messageId', 'replyTo', 'sentAt', 'payload']);
const HELLO_PAYLOAD_KEYS = new Set([
  'installationId',
  'agentVersion',
  'root',
  'state',
  'queueLength',
  'capabilities',
]);
const HELLO_ROOT_KEYS = new Set(['connectorRootId', 'displayName', 'uploadsEnabled']);
const JOB_ASSIGNMENT_KEYS = new Set([
  'jobId',
  'deliveryId',
  'jobType',
  'connectorRootId',
  'leaseExpiresAt',
  'payload',
]);

class NasConnectorControlProtocolError extends Error {
  constructor() {
    super('NAS connector control protocol is invalid.');
    this.name = 'NasConnectorControlProtocolError';
    this.code = 'NAS_CONNECTOR_CONTROL_PROTOCOL_INVALID';
  }
}

const connectorIdOf = (connector) => String(connector?._id || connector?.id || '');

const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);

const isUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);

const isUtcInstant = (value) => (
  typeof value === 'string'
  && UTC_INSTANT_PATTERN.test(value)
  && Number.isFinite(Date.parse(value))
);

const parseEnvelope = (data) => {
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  if (Buffer.byteLength(text, 'utf8') > MAX_CONTROL_MESSAGE_BYTES) {
    throw new NasConnectorControlProtocolError();
  }

  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new NasConnectorControlProtocolError();
  }

  if (!isPlainObject(envelope)
    || Object.keys(envelope).length !== ENVELOPE_KEYS.size
    || Object.keys(envelope).some((key) => !ENVELOPE_KEYS.has(key))
    || envelope.v !== CONTROL_PROTOCOL_VERSION
    || typeof envelope.type !== 'string'
    || !envelope.type
    || !isUuid(envelope.messageId)
    || (envelope.replyTo !== null && !isUuid(envelope.replyTo))
    || !isUtcInstant(envelope.sentAt)
    || !isPlainObject(envelope.payload)) {
    throw new NasConnectorControlProtocolError();
  }

  return envelope;
};

const normalizeCapabilities = (value) => {
  if (!Array.isArray(value) || value.length > 32) {
    throw new NasConnectorValidationError('Connector capabilities are invalid.');
  }

  if (value.some((capability) => (
    typeof capability !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(capability)
  ))) {
    throw new NasConnectorValidationError('Connector capabilities are invalid.');
  }

  return [...new Set(value)];
};

const assertExactKeys = (value, keys) => {
  if (!isPlainObject(value)
    || Object.keys(value).length !== keys.size
    || Object.keys(value).some((key) => !keys.has(key))) {
    throw new NasConnectorValidationError('Connector control payload is invalid.');
  }
};

const normalizeHelloPayload = (payload) => {
  assertExactKeys(payload, HELLO_PAYLOAD_KEYS);
  assertExactKeys(payload.root, HELLO_ROOT_KEYS);
  return {
    installationId: normalizeInstallationId(payload.installationId),
    agentVersion: normalizeAgentVersion(payload.agentVersion),
    root: normalizeConnectorRoot(payload.root),
    state: normalizeHeartbeatState(payload.state),
    queueLength: normalizeQueueLength(payload.queueLength),
    capabilities: normalizeCapabilities(payload.capabilities),
  };
};

const normalizeJobAssignment = (assignment) => {
  assertExactKeys(assignment, JOB_ASSIGNMENT_KEYS);
  if (typeof assignment.jobId !== 'string'
    || !/^[0-9a-f]{24}$/.test(assignment.jobId)
    || typeof assignment.deliveryId !== 'string'
    || !isUuid(assignment.deliveryId)
    || !isUtcInstant(assignment.leaseExpiresAt)
    || !isPlainObject(assignment.payload)) {
    throw new NasConnectorControlProtocolError();
  }
  const isIndexJob = assignment.jobType === 'index_root'
    && Object.keys(assignment.payload).length === 0;
  const isCacheJob = assignment.jobType === 'cache_for_download'
    && Object.keys(assignment.payload).length === 2
    && /^[0-9a-f]{24}$/.test(assignment.payload.fileEntryId)
    && /^[0-9a-f]{24}$/.test(assignment.payload.fileShareId);
  const isThumbnailJob = assignment.jobType === 'generate_thumbnail'
    && Object.keys(assignment.payload).length === 1
    && /^[0-9a-f]{24}$/.test(assignment.payload.fileEntryId);
  const isWriteUploadJob = assignment.jobType === 'write_upload_to_nas'
    && Object.keys(assignment.payload).length === 0;
  if (!isIndexJob && !isCacheJob && !isThumbnailJob && !isWriteUploadJob) throw new NasConnectorControlProtocolError();
  try {
    return {
      ...assignment,
      deliveryId: assignment.deliveryId.toLowerCase(),
      connectorRootId: normalizeConnectorRootId(assignment.connectorRootId),
    };
  } catch {
    throw new NasConnectorControlProtocolError();
  }
};

const resolveSelectedQuery = async (query) => {
  if (!query) return query;
  return typeof query.select === 'function' ? query.select('+credentialHash') : query;
};

const sendEnvelope = (socket, {
  type,
  messageId = crypto.randomUUID(),
  replyTo = null,
  payload = {},
}) => {
  if (socket.readyState !== WebSocket.OPEN) return false;

  try {
    socket.send(JSON.stringify({
      v: CONTROL_PROTOCOL_VERSION,
      type,
      messageId,
      replyTo,
      sentAt: new Date().toISOString(),
      payload,
    }));
    return true;
  } catch {
    return false;
  }
};

const closeSocket = (socket, {
  code,
  reason,
  errorCode,
  errorMessage,
  replyTo = null,
} = {}) => {
  if (!socket || socket.readyState === WebSocket.CLOSED) return;

  if (errorCode) {
    sendEnvelope(socket, {
      type: 'error',
      replyTo,
      payload: { code: errorCode, message: errorMessage || 'Control channel request was rejected.' },
    });
  }

  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) {
    try {
      socket.close(code, reason);
      return;
    } catch {
      // Fall through to terminate an unusable socket.
    }
  }

  try {
    socket.terminate();
  } catch {
    // Nothing further can be done for an already-failed transport.
  }
};

class NasConnectorSessionRegistry {
  constructor({ closeSession = closeSocket } = {}) {
    this.sessions = new Map();
    // Upgraded sockets are tracked separately until their first valid hello.
    // This lets a concurrent revoke/credential rotation close an authenticated
    // but not-yet-promoted socket without allowing it to replace a healthy
    // active session merely by completing an HTTP upgrade.
    this.pendingSessions = new Map();
    this.closeSession = closeSession;
  }

  trackPending(connectorId, socket, { credentialHash = null } = {}) {
    const key = String(connectorId);
    const session = { socket, credentialHash };
    const pending = this.pendingSessions.get(key) || new Set();
    pending.add(session);
    this.pendingSessions.set(key, pending);

    socket.once('close', () => {
      const currentPending = this.pendingSessions.get(key);
      if (!currentPending) return;
      currentPending.delete(session);
      if (currentPending.size === 0) this.pendingSessions.delete(key);
    });
  }

  register(connectorId, socket, { credentialHash = null } = {}) {
    const key = String(connectorId);
    const previous = this.sessions.get(key);
    const session = { socket, credentialHash };
    const pending = this.pendingSessions.get(key);
    if (pending) {
      for (const pendingSession of pending) {
        if (pendingSession.socket === socket) pending.delete(pendingSession);
      }
      if (pending.size === 0) this.pendingSessions.delete(key);
    }
    this.sessions.set(key, session);

    socket.once('close', () => {
      if (this.sessions.get(key) === session) {
        this.sessions.delete(key);
      }
    });

    if (previous && previous.socket !== socket) {
      this.closeSession(previous.socket, {
        code: CLOSE_CODES.replaced,
        reason: 'Replaced by a newer connector session.',
        errorCode: 'SESSION_REPLACED',
        errorMessage: 'A newer connector session is active.',
      });
    }
  }

  closeConnector(connectorId, {
    expectedCredentialHash = null,
    code = CLOSE_CODES.credentialInvalid,
    reason = 'Connector credential is no longer active.',
    errorCode = 'CREDENTIAL_REVOKED_OR_ROTATED',
    errorMessage = 'Connector credential is no longer active.',
  } = {}) {
    const key = String(connectorId);
    const session = this.sessions.get(key);
    const pending = this.pendingSessions.get(key);
    let closed = false;

    if (session && (!expectedCredentialHash
      || safelyCompareHashes(session.credentialHash, expectedCredentialHash))) {
      // Remove before closing so a re-entrant close handler cannot remove a
      // replacement session that was already registered for the same connector.
      this.sessions.delete(key);
      this.closeSession(session.socket, { code, reason, errorCode, errorMessage });
      closed = true;
    }

    if (pending) {
      for (const pendingSession of [...pending]) {
        if (expectedCredentialHash
          && !safelyCompareHashes(pendingSession.credentialHash, expectedCredentialHash)) {
          continue;
        }
        pending.delete(pendingSession);
        this.closeSession(pendingSession.socket, { code, reason, errorCode, errorMessage });
        closed = true;
      }
      if (pending.size === 0) this.pendingSessions.delete(key);
    }

    return closed;
  }

  has(connectorId) {
    return this.sessions.has(String(connectorId));
  }

  // A deliberately tiny operator-visible round-trip used to prove that the
  // browser, backend, and current Connector session are connected. It has no
  // NAS path, job, credential, or transfer payload.
  sendTestMessage(connectorId) {
    const session = this.sessions.get(String(connectorId));
    if (!session) return false;
    return sendEnvelope(session.socket, { type: 'test.message', payload: {} });
  }

  // Jobs use the same current, authenticated session as the operator-visible
  // test message. Keeping this lookup here avoids a reconnect leaving the
  // durable queue with a callback that still references a replaced socket.
  // The queue remains responsible for validating the assignment and recording
  // the message ID before it accepts an acknowledgement.
  sendJobAssignment(connectorId, payload) {
    const session = this.sessions.get(String(connectorId));
    if (!session) return null;
    const messageId = crypto.randomUUID();
    return sendEnvelope(session.socket, {
      type: 'job.assign',
      messageId,
      payload,
    }) ? messageId : null;
  }
}

const writeUpgradeError = (socket, statusCode, statusText, headers = {}) => {
  if (!socket || socket.destroyed) return;
  const headerLines = Object.entries({
    Connection: 'close',
    'Content-Length': '0',
    ...headers,
  }).map(([name, value]) => `${name}: ${value}`);
  try {
    socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\n${headerLines.join('\r\n')}\r\n\r\n`);
  } finally {
    socket.destroy();
  }
};

const hasRequiredSubprotocol = (request) => {
  const header = request.headers['sec-websocket-protocol'];
  if (typeof header !== 'string') return false;
  return header.split(',').some((value) => value.trim() === CONTROL_SUBPROTOCOL);
};

const isLoopbackAddress = (address) => (
  address === '127.0.0.1'
  || address === '::1'
  || address === '::ffff:127.0.0.1'
);

const forwardedClientAddress = (request) => {
  if (!isLoopbackAddress(request.socket?.remoteAddress)) return null;
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor !== 'string') return null;
  if (forwardedFor.includes(',')) return null;
  const clientAddress = forwardedFor.trim();
  // This is used only as a bounded in-memory rate-limit key after the request
  // came from the local trusted proxy. It is intentionally not used for
  // authorization and rejects arbitrary header-sized strings.
  return /^[0-9a-fA-F:.]{1,128}$/.test(clientAddress) ? clientAddress : null;
};

const upgradeClientAddress = (request) => (
  forwardedClientAddress(request)
  || request.socket?.remoteAddress
  || 'unknown'
);

class NasConnectorUpgradeRateLimiter {
  constructor({
    maxAttemptsPerMinute = 30,
    now = () => Date.now(),
  } = {}) {
    this.maxAttemptsPerMinute = maxAttemptsPerMinute;
    this.now = now;
    this.attempts = new Map();
  }

  consume(request) {
    const timestamp = this.now();
    const key = upgradeClientAddress(request);
    const current = this.attempts.get(key);
    if (!current || timestamp - current.windowStartedAt >= UPGRADE_RATE_LIMIT_WINDOW_MS) {
      if (!current && this.attempts.size >= MAX_TRACKED_UPGRADE_ADDRESSES) {
        for (const [address, entry] of this.attempts) {
          if (timestamp - entry.windowStartedAt >= UPGRADE_RATE_LIMIT_WINDOW_MS) {
            this.attempts.delete(address);
          }
        }
        if (this.attempts.size >= MAX_TRACKED_UPGRADE_ADDRESSES) return false;
      }
      this.attempts.set(key, { windowStartedAt: timestamp, count: 1 });
      return true;
    }
    if (current.count >= this.maxAttemptsPerMinute) return false;
    current.count += 1;
    return true;
  }
}

// Express can apply `trust proxy` to normal requests, but an HTTP upgrade
// bypasses Express. Accept an HTTPS-forwarded upgrade only from the local
// reverse-proxy hop; a public client cannot make its own X-Forwarded-Proto
// header trusted this way. Direct TLS remains valid for deployments that
// terminate TLS in Node itself.
const defaultIsSecureRequest = (request) => {
  if (request.socket?.encrypted) return true;
  const forwardedProto = request.headers['x-forwarded-proto'];
  return isLoopbackAddress(request.socket?.remoteAddress)
    && typeof forwardedProto === 'string'
    && forwardedProto.split(',')[0].trim().toLowerCase() === 'https';
};

const createNasConnectorControlChannel = (dependencies = {}) => {
  const config = dependencies.config;
  if (!config?.sharedSecret) {
    throw new Error('NAS connector control channel requires a validated connector configuration.');
  }
  if (!dependencies.NasConnectorModel || !dependencies.NasStorageRootModel) {
    throw new Error('NAS connector control channel requires connector and storage-root models.');
  }

  const {
    NasConnectorModel,
    NasStorageRootModel,
  } = dependencies;
  const isSecureRequest = dependencies.isSecureRequest || defaultIsSecureRequest;
  const jobQueue = dependencies.jobQueue || null;
  const now = dependencies.now || (() => new Date());
  const sessionRegistry = dependencies.sessionRegistry || new NasConnectorSessionRegistry();
  const heartbeatIntervalSeconds = Number.isSafeInteger(config.heartbeatIntervalSeconds)
    ? config.heartbeatIntervalSeconds
    : 30;
  const controlPingIntervalSeconds = Number.isSafeInteger(config.controlPingIntervalSeconds)
    ? config.controlPingIntervalSeconds
    : heartbeatIntervalSeconds;
  const upgradeRateLimiter = dependencies.upgradeRateLimiter || new NasConnectorUpgradeRateLimiter({
    maxAttemptsPerMinute: Number.isSafeInteger(config.controlUpgradeRateLimitPerMinute)
      ? config.controlUpgradeRateLimitPerMinute
      : 30,
  });

  const websocketServer = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: MAX_CONTROL_MESSAGE_BYTES,
    perMessageDeflate: false,
    handleProtocols: (protocols) => (protocols.has(CONTROL_SUBPROTOCOL) ? CONTROL_SUBPROTOCOL : false),
  });

  const updateHelloPresence = async ({ connector, credentialHash, hello }) => {
    const connectorId = connectorIdOf(connector);
    const seenAt = now();
    // The persistent socket is presence-only. It never creates, reactivates,
    // or edits a root: enrollment and the REST heartbeat remain the metadata
    // authority. In particular, a socket authenticated immediately before a
    // credential rotation must not be able to change uploadsEnabled or a
    // browser-visible display name before its captured credential is rejected.
    const existingRoot = await NasStorageRootModel.findOne(
      {
        connectorId,
        connectorRootId: hello.root.connectorRootId,
        status: { $in: ['active', 'offline'] },
      },
    );
    if (!existingRoot) return false;

    // Recheck the captured credential after root authorization. A revoke or
    // rotation between upgrade and hello can therefore never promote an old
    // socket into a live session.
    const updatedConnector = await NasConnectorModel.findOneAndUpdate(
      {
        _id: connectorId,
        installationId: hello.installationId,
        credentialHash,
        status: { $in: ['active', 'offline'] },
      },
      {
        $set: {
          status: 'active',
          agentVersion: hello.agentVersion,
          lastSeenAt: seenAt,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      },
      { new: true },
    );
    return Boolean(updatedConnector);
  };

  const credentialStillActive = async ({ connectorId, credentialHash }) => {
    const current = await resolveSelectedQuery(NasConnectorModel.findOne({
      _id: connectorId,
      status: { $in: ['active', 'offline'] },
    }));
    return Boolean(current && safelyCompareHashes(current.credentialHash, credentialHash));
  };

  const attach = (httpServer) => {
    const upgradeHandler = async (request, socket, head) => {
      let requestUrl;
      try {
        requestUrl = new URL(request.url, 'http://localhost');
      } catch {
        writeUpgradeError(socket, 400, 'Bad Request');
        return;
      }

      if (requestUrl.pathname !== CONTROL_CHANNEL_PATH || requestUrl.search) {
        writeUpgradeError(socket, 404, 'Not Found');
        return;
      }
      if (!upgradeRateLimiter.consume(request)) {
        writeUpgradeError(socket, 429, 'Too Many Requests', { 'Retry-After': '60' });
        return;
      }
      if (config.allowInsecureHttp !== true && !isSecureRequest(request)) {
        writeUpgradeError(socket, 400, 'Bad Request');
        return;
      }
      if (!hasRequiredSubprotocol(request)) {
        writeUpgradeError(socket, 426, 'Upgrade Required', {
          'Sec-WebSocket-Protocol': CONTROL_SUBPROTOCOL,
        });
        return;
      }

      const connector = await authenticateConnectorAuthorization({
        authorization: request.headers.authorization,
        NasConnectorModel,
        sharedSecret: config.sharedSecret,
      });
      if (!connector || socket.destroyed) {
        writeUpgradeError(socket, 401, 'Unauthorized');
        return;
      }

      websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        websocketServer.emit('connection', websocket, request, connector);
      });
    };

    httpServer.on('upgrade', upgradeHandler);
    return () => {
      httpServer.removeListener('upgrade', upgradeHandler);
      websocketServer.close();
    };
  };

  websocketServer.on('connection', (socket, _request, connector) => {
    const connectorId = connectorIdOf(connector);
    const credentialHash = connector.credentialHash;
    let helloAccepted = false;
    let helloInProgress = false;
    let missedPongs = 0;
    let pingCheckInFlight = false;
    const pendingPingIds = new Set();
    const receivedMessageIds = new Set();
    let unregisterJobDelivery = null;

    sessionRegistry.trackPending(connectorId, socket, { credentialHash });

    const failProtocol = (replyTo = null) => {
      closeSocket(socket, {
        code: CLOSE_CODES.protocolInvalid,
        reason: 'Control channel protocol violation.',
        errorCode: 'PROTOCOL_INVALID',
        errorMessage: 'Control channel message is invalid.',
        replyTo,
      });
    };

    const helloTimer = setTimeout(() => {
      if (!helloAccepted) {
        closeSocket(socket, {
          code: CLOSE_CODES.livenessTimeout,
          reason: 'Connector hello timed out.',
          errorCode: 'HELLO_TIMEOUT',
          errorMessage: 'Connector hello was not received in time.',
        });
      }
    }, HELLO_TIMEOUT_MS);

    const pingTimer = setInterval(async () => {
      if (!helloAccepted || pingCheckInFlight || socket.readyState !== WebSocket.OPEN) return;
      pingCheckInFlight = true;
      try {
        const valid = await credentialStillActive({ connectorId, credentialHash });
        if (!valid) {
          closeSocket(socket, {
            code: CLOSE_CODES.credentialInvalid,
            reason: 'Connector credential is no longer active.',
            errorCode: 'CREDENTIAL_REVOKED_OR_ROTATED',
            errorMessage: 'Connector credential is no longer active.',
          });
          return;
        }

        if (pendingPingIds.size > 0) {
          missedPongs += 1;
          if (missedPongs >= 2) {
            closeSocket(socket, {
              code: CLOSE_CODES.livenessTimeout,
              reason: 'Connector liveness timed out.',
              errorCode: 'PONG_TIMEOUT',
              errorMessage: 'Connector liveness response timed out.',
            });
            return;
          }
        } else {
          missedPongs = 0;
        }

        const pingId = crypto.randomUUID();
        if (sendEnvelope(socket, {
          type: 'ping',
          messageId: pingId,
          payload: { controlPingIntervalSeconds },
        })) {
          pendingPingIds.add(pingId);
        }
      } catch {
        closeSocket(socket, {
          code: CLOSE_CODES.credentialInvalid,
          reason: 'Connector credential could not be verified.',
          errorCode: 'CREDENTIAL_CHECK_FAILED',
          errorMessage: 'Connector credential could not be verified.',
        });
      } finally {
        pingCheckInFlight = false;
      }
    }, controlPingIntervalSeconds * 1000);

    socket.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(pingTimer);
      unregisterJobDelivery?.();
      unregisterJobDelivery = null;
    });

    socket.on('error', () => {
      // `ws` already closes transport/protocol failures. Do not log an error
      // object here because a peer-controlled message can be reflected in it.
    });

    socket.on('message', (data, isBinary) => {
      const handleMessage = async () => {
        if (isBinary) {
          failProtocol();
          return;
        }

        let envelope;
        try {
          envelope = parseEnvelope(data);
        } catch {
          failProtocol();
          return;
        }

        if (receivedMessageIds.has(envelope.messageId)
          || receivedMessageIds.size >= MAX_SESSION_MESSAGE_IDS) {
          failProtocol(envelope.messageId);
          return;
        }
        receivedMessageIds.add(envelope.messageId);

        if (!helloAccepted) {
          if (helloInProgress || envelope.type !== 'hello' || envelope.replyTo !== null) {
            failProtocol(envelope.messageId);
            return;
          }

          helloInProgress = true;
          let hello;
          try {
            hello = normalizeHelloPayload(envelope.payload);
          } catch {
            failProtocol(envelope.messageId);
            return;
          }

          if (hello.installationId !== connector.installationId) {
            closeSocket(socket, {
              code: CLOSE_CODES.credentialInvalid,
              reason: 'Connector installation is not authorized.',
              errorCode: 'INSTALLATION_MISMATCH',
              errorMessage: 'Connector installation is not authorized.',
              replyTo: envelope.messageId,
            });
            return;
          }

          try {
            const persisted = await updateHelloPresence({ connector, credentialHash, hello });
            if (!persisted) {
              closeSocket(socket, {
                code: CLOSE_CODES.credentialInvalid,
                reason: 'Connector credential is no longer active.',
                errorCode: 'CREDENTIAL_REVOKED_OR_ROTATED',
                errorMessage: 'Connector credential is no longer active.',
                replyTo: envelope.messageId,
              });
              return;
            }
          } catch {
            closeSocket(socket, {
              code: CLOSE_CODES.credentialInvalid,
              reason: 'Connector presence could not be recorded.',
              errorCode: 'PRESENCE_UNAVAILABLE',
              errorMessage: 'Connector presence could not be recorded.',
              replyTo: envelope.messageId,
            });
            return;
          }

          // A revoke/rotation can close a pending socket while its asynchronous
          // persistence write is in flight. Do not promote a socket that has
          // already begun closing in response to that authoritative change.
          if (socket.readyState !== WebSocket.OPEN) return;
          helloAccepted = true;
          clearTimeout(helloTimer);
          // A connection becomes the single active session only after it has
          // proved it can send a valid hello and its presence write committed.
          // This prevents an idle authenticated upgrade from displacing a
          // healthy connector session.
          sessionRegistry.register(connectorId, socket, { credentialHash });
          sendEnvelope(socket, {
            type: 'hello_ack',
            replyTo: envelope.messageId,
            payload: {
              heartbeatIntervalSeconds,
              controlPingIntervalSeconds,
              serverTime: now().toISOString(),
            },
          });
          if (jobQueue) {
            unregisterJobDelivery = jobQueue.registerDeliveryTarget(connectorId, async (assignment) => {
              let payload;
              try {
                payload = normalizeJobAssignment(assignment);
              } catch {
                return null;
              }
              const messageId = sessionRegistry.sendJobAssignment(connectorId, payload);
              console.info('[NAS index] control_channel_assignment_write', {
                connectorId,
                jobId: payload.jobId,
                deliveryId: payload.deliveryId,
                messageId,
              });
              return messageId;
            });
          }
          return;
        }

        if (envelope.type === 'job.ack') {
          if (!jobQueue || !envelope.replyTo) {
            failProtocol(envelope.messageId);
            return;
          }
          let acknowledgement;
          try {
            acknowledgement = normalizeAcknowledgement(envelope.payload);
          } catch {
            failProtocol(envelope.messageId);
            return;
          }
          try {
            console.info('[NAS index] control_channel_ack_received', {
              connectorId,
              jobId: acknowledgement.jobId,
              deliveryId: acknowledgement.deliveryId,
              replyTo: envelope.replyTo,
            });
            const result = await jobQueue.acknowledge({
              connectorId,
              payload: acknowledgement,
              replyTo: envelope.replyTo,
            });
            if (!result.accepted) {
              failProtocol(envelope.messageId);
            }
          } catch {
            closeSocket(socket, {
              code: CLOSE_CODES.protocolInvalid,
              reason: 'Control channel job acknowledgement failed.',
              errorCode: 'JOB_ACK_REJECTED',
              errorMessage: 'Control channel job acknowledgement was rejected.',
              replyTo: envelope.messageId,
            });
          }
          return;
        }

        if (envelope.type !== 'pong'
          || !envelope.replyTo
          || !pendingPingIds.has(envelope.replyTo)
          || Object.keys(envelope.payload).length !== 0) {
          failProtocol(envelope.messageId);
          return;
        }

        pendingPingIds.delete(envelope.replyTo);
        if (pendingPingIds.size === 0) missedPongs = 0;
      };

      void handleMessage();
    });
  });

  return {
    attach,
    sessionRegistry,
    websocketServer,
  };
};

module.exports = {
  CLOSE_CODES,
  CONTROL_CHANNEL_PATH,
  CONTROL_PROTOCOL_VERSION,
  CONTROL_SUBPROTOCOL,
  HELLO_TIMEOUT_MS,
  MAX_CONTROL_MESSAGE_BYTES,
  MAX_TRACKED_UPGRADE_ADDRESSES,
  NasConnectorControlProtocolError,
  NasConnectorUpgradeRateLimiter,
  NasConnectorSessionRegistry,
  createNasConnectorControlChannel,
  normalizeHelloPayload,
  parseEnvelope,
  defaultIsSecureRequest,
  upgradeClientAddress,
};
