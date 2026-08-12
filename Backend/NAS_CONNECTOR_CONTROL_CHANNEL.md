# NAS Connector Control Channel — Phase 2B Contract

## Purpose and boundary

This contract defines the persistent **outbound** connector-presence channel.
It lets the backend know that an already-enrolled Windows connector is online
without opening an inbound port on the NAS network.

It is deliberately **not** a file-transfer or job-execution protocol yet. The
REST heartbeat remains the authoritative liveness/revocation path during this
slice. Job assignment starts only after the connector has a durable local job
store and safe root resolver.

## Transport and upgrade authentication

- Endpoint: `wss://<configured-HTTPS-origin>/api/nas-connectors/control/socket`
- Required WebSocket subprotocol: `adimari.nas-control.v1`
- The HTTPS origin is validated by the Windows Service before converting it to
  `wss`. Normal certificate validation is mandatory; there is no TLS bypass.
- The upgrade request uses the existing connector credential only in:
  `Authorization: Connector <connectorId>.<deviceSecret>`.
- A credential must never appear in a URL, query string, WebSocket JSON frame,
  log message, close reason, browser payload, or diagnostics export.
- The backend accepts only an active or offline connector whose credential is
  valid. It limits incoming messages to 64 KiB and disables per-message
  compression for this private control protocol.
- `hello.payload` and `hello.payload.root` use exact allowlists. In particular,
  native Windows/UNC paths, URLs, credentials, and arbitrary extra fields are
  rejected rather than ignored. The root must already exist and be enabled from
  enrollment; the socket cannot create or reactivate a root.
- The backend registers at most one live session per connector. A newer valid
  session replaces an older one. Revocation and successful credential rotation
  close any old live session immediately.

## Envelope

Every text frame is UTF-8 JSON and has this shape:

```json
{
  "v": 1,
  "type": "hello",
  "messageId": "a UUID",
  "replyTo": null,
  "sentAt": "2026-08-12T12:00:00.000Z",
  "payload": {}
}
```

Rules:

- `v` is exactly `1`.
- `messageId` is a UUID and is unique for the sender's active session.
- `replyTo` is `null` for a new message or the peer's `messageId` for a reply.
- `sentAt` is an ISO-8601 UTC instant; it is diagnostic only, not an
  authorization or ordering mechanism.
- Unknown message types, invalid schema, binary frames, oversized frames, or
  invalid JSON cause the server to send a redacted `error` if practical and
  close with application code `4003`.

## Phase 2B messages

### Connector → backend: `hello`

The connector sends this as its first application frame, within ten seconds of
a successful upgrade.

```json
{
  "v": 1,
  "type": "hello",
  "messageId": "a UUID",
  "replyTo": null,
  "sentAt": "2026-08-12T12:00:00.000Z",
  "payload": {
    "installationId": "stable connector UUID",
    "agentVersion": "0.1.0",
    "root": {
      "connectorRootId": "opaque connector-local ID",
      "displayName": "Office Projects",
      "uploadsEnabled": true
    },
    "state": "ready",
    "queueLength": 0,
    "capabilities": []
  }
}
```

The backend verifies that `installationId` matches the authenticated connector
and that the logical root is already enabled for it. It records connector
presence only; root display metadata and upload permission remain owned by
enrollment and the REST heartbeat. It never receives a Windows path, UNC path,
S3 credential, signed URL, or browser credential.

### Backend → connector: `hello_ack`

```json
{
  "v": 1,
  "type": "hello_ack",
  "messageId": "a UUID",
  "replyTo": "the hello message ID",
  "sentAt": "2026-08-12T12:00:01.000Z",
  "payload": {
    "heartbeatIntervalSeconds": 30,
    "controlPingIntervalSeconds": 30,
    "serverTime": "2026-08-12T12:00:01.000Z"
  }
}
```

The connector treats this as control-channel presence only. It retains its
configured REST heartbeat interval if this frame is missing or malformed.

### Liveness: `ping` and `pong`

The backend sends an application `ping` at the acknowledged interval. The
connector replies with `pong` whose `replyTo` is the ping's `messageId`. Two
missed replies close the session. The REST heartbeat continues independently.

### Errors and close codes

`error` contains only a stable code and short redacted message. It never
contains secrets or native paths.

| Code | Meaning |
| --- | --- |
| `4001` | Credential revoked or rotated; connector must confirm through REST before deciding whether re-enrollment is required. |
| `4002` | Replaced by another valid session for the same connector. |
| `4003` | Protocol/schema violation. |
| `4004` | Hello timeout or missed liveness replies. |

## Reconnect behavior

The connector retries only while it has a valid local credential and valid
HTTPS/root configuration. It uses exponential full-jitter backoff from roughly
one second to sixty seconds, reset only after a stable session. A failed or
rejected WebSocket alone does not mark the credential revoked: the service
first relies on/attempts the normal REST heartbeat so a reverse-proxy error is
not misrepresented as credential loss.

## Deployment boundary

The current session registry is intentionally in one Backend process. Deploy
one Node/PM2 instance only—do not use cluster mode or multiple hosts until
session invalidation is distributed. Otherwise an administrative revocation or
credential rotation cannot immediately close a socket owned by another process.

The public HTTPS reverse proxy must rate-limit and connection-limit this exact
upgrade endpoint before forwarding it to Node. Node additionally applies a
bounded per-client upgrade limit as defense in depth, but it cannot protect the
public TLS listener as early as the proxy can. The Node backend port stays
private; only the HTTPS proxy is exposed. The proxy must overwrite
`X-Forwarded-For` with its observed client address (or use an equivalently safe
`real_ip` configuration); it must not append a public client-supplied value.

## Deferred job delivery

Future `job.assign`, `job.ack`, `job.progress`, `job.complete`, and `job.fail`
messages will use this envelope. The database remains the job queue; the socket
only delivers a lease. A connector will acknowledge a job only after recording
it durably, and duplicate `jobId`/`deliveryId` messages must be idempotent.
