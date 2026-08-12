'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { once } = require('node:events');
const { WebSocket } = require('ws');

const {
  CLOSE_CODES,
  CONTROL_SUBPROTOCOL,
  MAX_CONTROL_MESSAGE_BYTES,
  NasConnectorSessionRegistry,
  NasConnectorUpgradeRateLimiter,
  createNasConnectorControlChannel,
  defaultIsSecureRequest,
  normalizeHelloPayload,
  parseEnvelope,
} = require('../control/nasConnectorControlChannel');
const { hashDeviceSecret } = require('../services/nasConnectorSecrets');

const HMAC_SECRET = 'this-is-a-long-test-only-connector-hmac-secret';
const CONNECTOR_ID = '100000000000000000000001';
const INSTALLATION_ID = 'a9d24d65-1a96-4f65-aa06-40c74c5934ac';
const DEVICE_SECRET = 'Z2VuZXJhdGVkLWRldmljZS1zZWNyZXQtMzItYnl0ZXM';
const ROOT = { connectorRootId: 'office-projects', displayName: 'Office Projects', uploadsEnabled: true };

const envelope = ({
  type,
  messageId = crypto.randomUUID(),
  replyTo = null,
  payload = {},
} = {}) => ({
  v: 1,
  type,
  messageId,
  replyTo,
  sentAt: new Date().toISOString(),
  payload,
});

const crypto = require('node:crypto');

const matches = (record, filter) => Object.entries(filter).every(([key, expected]) => {
  if (expected && typeof expected === 'object' && '$in' in expected) {
    return expected.$in.includes(record[key]);
  }
  return record[key] === expected;
});

const createModels = ({ onRootRead } = {}) => {
  const connector = {
    _id: CONNECTOR_ID,
    installationId: INSTALLATION_ID,
    credentialHash: hashDeviceSecret(DEVICE_SECRET, HMAC_SECRET),
    status: 'active',
    agentVersion: '0.1.0',
    lastSeenAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };
  const roots = [{
    connectorId: CONNECTOR_ID,
    connectorRootId: ROOT.connectorRootId,
    displayName: ROOT.displayName,
    uploadsEnabled: ROOT.uploadsEnabled,
    status: 'active',
  }];

  return {
    ConnectorModel: {
      async findOne(filter) {
        return matches(connector, filter) ? connector : null;
      },
      async findOneAndUpdate(filter, update) {
        if (!matches(connector, filter)) return null;
        Object.assign(connector, update.$set);
        return connector;
      },
    },
    StorageRootModel: {
      async findOne(filter) {
        const root = roots.find((entry) => matches(entry, filter));
        if (!root) return null;
        if (onRootRead) await onRootRead({ connector, root, roots });
        return root;
      },
    },
    state: { connector, roots },
  };
};

const startChannel = async ({ controlPingIntervalSeconds = 60, onRootRead } = {}) => {
  const models = createModels({ onRootRead });
  const channel = createNasConnectorControlChannel({
    config: {
      authHmacSecret: HMAC_SECRET,
      heartbeatIntervalSeconds: 30,
      controlPingIntervalSeconds,
    },
    NasConnectorModel: models.ConnectorModel,
    NasStorageRootModel: models.StorageRootModel,
    // Tests use plain ws://. Production accepts only direct TLS or a loopback
    // TLS-terminating reverse proxy that sets X-Forwarded-Proto itself.
    isSecureRequest: () => true,
  });
  const server = http.createServer((_request, response) => response.writeHead(404).end());
  channel.attach(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    channel,
    models,
    server,
    url: `ws://127.0.0.1:${port}/api/nas-connectors/control/socket`,
  };
};

const closeServer = async ({ channel, server }) => {
  channel.websocketServer.clients?.forEach((socket) => socket.terminate());
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => server.close(resolve));
};

const connect = (url, { authorization = `Connector ${CONNECTOR_ID}.${DEVICE_SECRET}`, protocol = CONTROL_SUBPROTOCOL } = {}) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url, protocol, { headers: { authorization } });
  socket.once('open', () => resolve(socket));
  socket.once('error', reject);
});

const expectConnectionFailure = (url, options) => new Promise((resolve) => {
  const socket = new WebSocket(url, options.protocol, { headers: options.authorization ? { authorization: options.authorization } : undefined });
  socket.once('unexpected-response', (_request, response) => {
    response.resume();
    resolve(response.statusCode);
  });
  socket.once('error', () => resolve(null));
});

const nextMessage = (socket) => new Promise((resolve, reject) => {
  socket.once('message', (data, isBinary) => {
    if (isBinary) return reject(new Error('Expected text frame.'));
    return resolve(JSON.parse(data.toString('utf8')));
  });
  socket.once('error', reject);
});

const hello = (overrides = {}) => envelope({
  type: 'hello',
  payload: {
    installationId: INSTALLATION_ID,
    agentVersion: '0.1.0',
    root: ROOT,
    state: 'ready',
    queueLength: 0,
    capabilities: [],
    ...overrides,
  },
});

test('strictly parses control envelopes without accepting extra fields or invalid IDs', () => {
  const valid = envelope({ type: 'hello' });
  assert.deepEqual(parseEnvelope(JSON.stringify(valid)), valid);
  assert.throws(() => parseEnvelope(JSON.stringify({ ...valid, extra: true })));
  assert.throws(() => parseEnvelope(JSON.stringify({ ...valid, messageId: 'not-a-uuid' })));
  assert.throws(() => parseEnvelope('x'.repeat(MAX_CONTROL_MESSAGE_BYTES + 1)));
  assert.throws(() => normalizeHelloPayload({
    installationId: INSTALLATION_ID,
    agentVersion: '0.1.0',
    root: { ...ROOT, nativePath: 'C:\\secret' },
    state: 'ready',
    queueLength: 0,
    capabilities: [],
  }));
});

test('accepts only the required authenticated protocol and records connector presence without changing root metadata', async () => {
  const app = await startChannel();
  try {
    assert.equal(await expectConnectionFailure(app.url, { protocol: 'wrong.protocol' }), 426);
    assert.equal(await expectConnectionFailure(app.url, { authorization: 'Connector 100000000000000000000001.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', protocol: CONTROL_SUBPROTOCOL }), 401);

    const socket = await connect(app.url);
    assert.equal(socket.protocol, CONTROL_SUBPROTOCOL);
    const helloFrame = hello({ root: { ...ROOT, displayName: 'Renamed Root', uploadsEnabled: false } });
    const acknowledgement = nextMessage(socket);
    socket.send(JSON.stringify(helloFrame));
    const ack = await acknowledgement;
    assert.equal(ack.type, 'hello_ack');
    assert.equal(ack.replyTo, helloFrame.messageId);
    assert.equal(ack.payload.heartbeatIntervalSeconds, 30);
    assert.equal(app.models.state.connector.status, 'active');
    assert.equal(app.models.state.connector.agentVersion, '0.1.0');
    assert.deepEqual(app.models.state.roots[0], {
      connectorId: CONNECTOR_ID,
      connectorRootId: ROOT.connectorRootId,
      displayName: ROOT.displayName,
      uploadsEnabled: ROOT.uploadsEnabled,
      status: 'active',
    });
    socket.close();
    await once(socket, 'close');
  } finally {
    await closeServer(app);
  }
});

test('a valid new hello replaces one active session, but an incomplete upgrade does not', async () => {
  const app = await startChannel();
  try {
    const first = await connect(app.url);
    const firstAck = nextMessage(first);
    first.send(JSON.stringify(hello()));
    await firstAck;
    assert.equal(app.channel.sessionRegistry.has(CONNECTOR_ID), true);

    const incomplete = await connect(app.url);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(first.readyState, WebSocket.OPEN);

    const firstClosed = once(first, 'close');
    const second = await connect(app.url);
    const secondAck = nextMessage(second);
    second.send(JSON.stringify(hello({ agentVersion: '0.1.1' })));
    await secondAck;
    const [firstCode] = await firstClosed;
    assert.equal(firstCode, CLOSE_CODES.replaced);

    incomplete.terminate();
    second.close();
    await once(second, 'close');
  } finally {
    await closeServer(app);
  }
});

test('invalid protocol frames close with the redacted application protocol code', async () => {
  const app = await startChannel();
  try {
    const socket = await connect(app.url);
    const close = once(socket, 'close');
    socket.send(JSON.stringify(envelope({ type: 'ping', payload: {} })));
    const [code] = await close;
    assert.equal(code, CLOSE_CODES.protocolInvalid);
  } finally {
    await closeServer(app);
  }
});

test('an upgraded old credential cannot finish hello after a credential rotation', async () => {
  const app = await startChannel();
  try {
    const socket = await connect(app.url);
    const oldCredentialHash = app.models.state.connector.credentialHash;
    app.models.state.connector.credentialHash = hashDeviceSecret('b'.repeat(43), HMAC_SECRET);

    const close = once(socket, 'close');
    socket.send(JSON.stringify(hello()));
    const [code] = await close;
    assert.equal(code, CLOSE_CODES.credentialInvalid);
    assert.equal(app.channel.sessionRegistry.has(CONNECTOR_ID), false);
    assert.notEqual(app.models.state.connector.credentialHash, oldCredentialHash);
  } finally {
    await closeServer(app);
  }
});

test('credential rotation actively closes a pending authenticated upgrade before hello', async () => {
  const app = await startChannel();
  try {
    const socket = await connect(app.url);
    const close = once(socket, 'close');
    assert.equal(app.channel.sessionRegistry.closeConnector(CONNECTOR_ID, {
      expectedCredentialHash: app.models.state.connector.credentialHash,
    }), true);
    const [code] = await close;
    assert.equal(code, CLOSE_CODES.credentialInvalid);
    assert.equal(app.channel.sessionRegistry.has(CONNECTOR_ID), false);
  } finally {
    await closeServer(app);
  }
});

test('a rotation after root validation cannot alter root metadata or promote the old socket', async () => {
  const app = await startChannel({
    onRootRead: ({ connector }) => {
      connector.credentialHash = hashDeviceSecret('b'.repeat(43), HMAC_SECRET);
    },
  });
  try {
    const socket = await connect(app.url);
    const close = once(socket, 'close');
    socket.send(JSON.stringify(hello({
      root: { ...ROOT, displayName: 'Old Socket Rename Attempt', uploadsEnabled: false },
    })));
    const [code] = await close;
    assert.equal(code, CLOSE_CODES.credentialInvalid);
    assert.deepEqual(app.models.state.roots[0], {
      connectorId: CONNECTOR_ID,
      connectorRootId: ROOT.connectorRootId,
      displayName: ROOT.displayName,
      uploadsEnabled: ROOT.uploadsEnabled,
      status: 'active',
    });
    assert.equal(app.channel.sessionRegistry.has(CONNECTOR_ID), false);
  } finally {
    await closeServer(app);
  }
});

test('hello rejects an unknown or disabled enrolled root without creating or reactivating it', async () => {
  const app = await startChannel();
  try {
    const unknown = await connect(app.url);
    const unknownClose = once(unknown, 'close');
    unknown.send(JSON.stringify(hello({
      root: { connectorRootId: 'unapproved-root', displayName: 'Unapproved', uploadsEnabled: true },
    })));
    const [unknownCode] = await unknownClose;
    assert.equal(unknownCode, CLOSE_CODES.credentialInvalid);
    assert.equal(app.models.state.roots.length, 1);

    app.models.state.roots[0].status = 'disabled';
    const disabled = await connect(app.url);
    const disabledClose = once(disabled, 'close');
    disabled.send(JSON.stringify(hello({ root: { ...ROOT, displayName: 'Must Not Reactivate' } })));
    const [disabledCode] = await disabledClose;
    assert.equal(disabledCode, CLOSE_CODES.credentialInvalid);
    assert.equal(app.models.state.roots[0].status, 'disabled');
    assert.equal(app.models.state.roots[0].displayName, ROOT.displayName);
  } finally {
    await closeServer(app);
  }
});

test('a revoke concurrent with hello cannot reactivate the disabled root or promote the socket', async () => {
  const app = await startChannel({
    onRootRead: ({ connector, root }) => {
      connector.status = 'revoked';
      root.status = 'disabled';
    },
  });
  try {
    const socket = await connect(app.url);
    const close = once(socket, 'close');
    socket.send(JSON.stringify(hello({ root: { ...ROOT, displayName: 'Late Hello' } })));
    const [code] = await close;
    assert.equal(code, CLOSE_CODES.credentialInvalid);
    assert.equal(app.models.state.connector.status, 'revoked');
    assert.equal(app.models.state.roots[0].status, 'disabled');
    assert.equal(app.channel.sessionRegistry.has(CONNECTOR_ID), false);
  } finally {
    await closeServer(app);
  }
});

test('sends application pings after hello and accepts a matching pong', async () => {
  const app = await startChannel({ controlPingIntervalSeconds: 1 });
  try {
    const socket = await connect(app.url);
    const acknowledgement = nextMessage(socket);
    socket.send(JSON.stringify(hello()));
    await acknowledgement;

    const ping = await nextMessage(socket);
    assert.equal(ping.type, 'ping');
    const nextPing = nextMessage(socket);
    socket.send(JSON.stringify(envelope({
      type: 'pong',
      replyTo: ping.messageId,
      payload: {},
    })));
    const laterPing = await nextPing;
    assert.equal(laterPing.type, 'ping');
    assert.equal(socket.readyState, WebSocket.OPEN);
    socket.close();
    await once(socket, 'close');
  } finally {
    await closeServer(app);
  }
});

test('the session registry actively closes a connector without exposing its credential', () => {
  const calls = [];
  const socket = { once() {}, readyState: WebSocket.OPEN };
  const registry = new NasConnectorSessionRegistry({
    closeSession: (_socket, details) => calls.push(details),
  });
  const hash = hashDeviceSecret(DEVICE_SECRET, HMAC_SECRET);
  registry.register(CONNECTOR_ID, socket, { credentialHash: hash });
  assert.equal(registry.closeConnector(CONNECTOR_ID, { expectedCredentialHash: '0'.repeat(64) }), false);
  assert.equal(registry.closeConnector(CONNECTOR_ID, { expectedCredentialHash: hash }), true);
  assert.equal(calls[0].code, CLOSE_CODES.credentialInvalid);
  assert.equal(calls[0].errorCode, 'CREDENTIAL_REVOKED_OR_ROTATED');
});

test('only direct TLS or a loopback HTTPS reverse proxy qualifies as secure upgrade transport', () => {
  assert.equal(defaultIsSecureRequest({ socket: { encrypted: true }, headers: {} }), true);
  assert.equal(defaultIsSecureRequest({
    socket: { encrypted: false, remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-proto': 'https' },
  }), true);
  assert.equal(defaultIsSecureRequest({
    socket: { encrypted: false, remoteAddress: '10.0.0.10' },
    headers: { 'x-forwarded-proto': 'https' },
  }), false);
});

test('upgrade rate limiting is bounded per trusted client address', () => {
  let timestamp = 0;
  const limiter = new NasConnectorUpgradeRateLimiter({
    maxAttemptsPerMinute: 2,
    now: () => timestamp,
  });
  const request = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '203.0.113.10' },
  };
  assert.equal(limiter.consume(request), true);
  assert.equal(limiter.consume(request), true);
  assert.equal(limiter.consume(request), false);
  timestamp = 60_000;
  assert.equal(limiter.consume(request), true);
  assert.equal(limiter.consume({
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': '203.0.113.10, 198.51.100.20' },
  }), true);
});
