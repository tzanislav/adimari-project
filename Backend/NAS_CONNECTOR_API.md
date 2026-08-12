# NAS Connector API — Phase 2

These endpoints are mounted only when `NAS_CONNECTOR_ENABLED=true`. They require
HTTPS; the backend returns `NAS_CONNECTOR_HTTPS_REQUIRED` for cleartext requests.
The connector never sends a NAS path, S3 credential, or browser-user credential.

## Authentication types

- **Administrator calls** use a Firebase ID token: `Authorization: Bearer <token>`.
  The Firebase user must have role `admin`.
- **Connector calls** use its device credential:
  `Authorization: Connector <connectorId>.<deviceSecret>`.

`deviceSecret` is generated once by the Windows Service as 32 cryptographically
random bytes, encoded as unpadded base64url (43 characters). It is stored by the
Service in its OS-protected secret storage and never displayed by the Control
Center. The backend stores only an HMAC-SHA-256 hash of it.

## Create an enrollment token

`POST /api/nas-connectors/enrollment-tokens`

Administrator request:

```json
{ "name": "Office NAS Connector" }
```

Success (`201`):

```json
{
  "enrollment": {
    "id": "MongoDB ObjectId",
    "name": "Office NAS Connector",
    "expiresAt": "2026-08-12T12:30:00.000Z"
  },
  "enrollmentToken": "nce1_<43 base64url characters>"
}
```

The token is 256 bits of random material, expires after
`NAS_CONNECTOR_ENROLLMENT_TOKEN_TTL_SECONDS` (default 900 seconds), is returned
only in this response, and is never stored or logged in raw form. The response is
marked `Cache-Control: no-store, private`.

## Create a re-enrollment token

`POST /api/nas-connectors/:id/re-enrollment-tokens`

This is an administrator-only operation for an existing connector. It has no
required request body and returns the same `201` shape as an initial enrollment
token. The token is bound server-side to the selected connector and to the
credential state that existed when it was issued; its raw value is returned only
once and is never stored or logged.

Use this token when a Connector has lost its local credential, or when an
administrator intentionally wants to restore an `offline` or `revoked`
connector. The Service uses its existing stable `installationId` but creates a
fresh pending `deviceSecret`, then sends the normal `POST /enroll` request below.
On success the backend atomically replaces the old device credential, marks the
connector and submitted root `active`, and clears revocation metadata. The old
device credential immediately stops authenticating.

An administrator revoking a connector invalidates all of that connector's
unused re-enrollment tokens. To restore a revoked connector, revoke it first if
needed, then explicitly create a new re-enrollment token for it.

## Enroll a connector

`POST /api/nas-connectors/enroll`

This endpoint intentionally has no Firebase authentication. The one-time
enrollment token is its authorization mechanism and is rate limited.

```json
{
  "enrollmentToken": "nce1_<43 base64url characters>",
  "installationId": "a9d24d65-1a96-4f65-aa06-40c74c5934ac",
  "deviceSecret": "<43 base64url characters>",
  "agentVersion": "0.1.0",
  "root": {
    "connectorRootId": "office-projects",
    "displayName": "Office Projects",
    "uploadsEnabled": true
  }
}
```

`installationId` is a stable UUID generated once by the Service. `connectorRootId`
is a stable connector-local opaque identifier, not a filesystem path. `displayName`
is safe user-visible metadata only.

Success (`201`):

```json
{
  "connector": {
    "id": "MongoDB ObjectId",
    "name": "Office NAS Connector",
    "installationId": "a9d24d65-1a96-4f65-aa06-40c74c5934ac",
    "status": "active",
    "agentVersion": "0.1.0",
    "lastSeenAt": "2026-08-12T12:16:00.000Z",
    "revokedAt": null,
    "createdAt": "2026-08-12T12:16:00.000Z",
    "updatedAt": "2026-08-12T12:16:00.000Z"
  },
  "heartbeatIntervalSeconds": 30
}
```

The Service must retain its own `deviceSecret`; it is not echoed by the backend.
A bad, expired, or replayed token returns the same `401`
`NAS_CONNECTOR_ENROLLMENT_INVALID` response.

### Lost-response recovery

The first successful redemption returns `201`. If the Service sent a valid
request but lost that successful response before it could persist the connector
ID, it may repeat the *identical* request with the same token,
`installationId`, and `deviceSecret`. For a bounded recovery window (default
one hour after the normal token expiry), the backend returns `200` with the
same redacted connector response. It does not create a second connector or
generate/return a credential.

The backend stores only HMACs that bind this recovery path to the original
installation ID and device secret. A consumed token paired with a different
installation ID or device secret receives the generic `401` failure and reveals
no connector metadata. The recovery window never extends the normal one-time
token redemption deadline: an unredeemed token still expires at
`enrollment.expiresAt`.

## Heartbeat

`POST /api/nas-connectors/control/heartbeat`

Use the connector authorization header described above.

```json
{
  "installationId": "a9d24d65-1a96-4f65-aa06-40c74c5934ac",
  "agentVersion": "0.1.0",
  "root": {
    "connectorRootId": "office-projects",
    "displayName": "Office Projects",
    "uploadsEnabled": true
  },
  "state": "ready",
  "queueLength": 0
}
```

`state` is one of `ready`, `busy`, or `degraded`. `queueLength` is a non-negative
integer. Success (`200`) returns the redacted connector metadata, submitted
state/queue length, and `heartbeatIntervalSeconds`. Invalid, unknown, or revoked
connector credentials all return `401 NAS_CONNECTOR_UNAUTHORIZED`.

### Liveness and offline status

An `active` connector is considered stale after
`NAS_CONNECTOR_HEARTBEAT_STALE_AFTER_SECONDS` without a heartbeat. The default
is three configured heartbeat intervals (90 seconds with the default 30-second
interval). The configured value must be at least two heartbeat intervals.

Before `GET /api/nas-connectors` returns its administrator list, the backend
atomically persists every stale active connector as `offline`; the list is
therefore accurate at the time it is read. This update checks the old
`lastSeenAt` in the database, so a concurrent fresh heartbeat is never marked
offline. An `offline` connector retains its device credential solely so its next
authenticated heartbeat can set it back to `active`; it does not require
re-enrollment after an ordinary network or service interruption.

## Administrator management

- `GET /api/nas-connectors` returns `{ "connectors": [<redacted connector>] }`.
- `POST /api/nas-connectors/:id/re-enrollment-tokens` issues a one-time token
  bound to that existing connector. Redeem it through the ordinary `/enroll`
  endpoint; no separate connector-side API contract is required.
- `POST /api/nas-connectors/:id/revoke` revokes the connector, disables its known
  roots, invalidates unused re-enrollment tokens for it, and returns
  `{ "connector": <redacted connector> }`.

Revocation takes effect on the next request because authentication only accepts
connectors whose status is `active` or `offline`.

## Persistent control-channel presence

The Windows Service may also open the outbound secure WebSocket described in
[`NAS_CONNECTOR_CONTROL_CHANNEL.md`](NAS_CONNECTOR_CONTROL_CHANNEL.md):

```text
wss://<public HTTPS origin>/api/nas-connectors/control/socket
Sec-WebSocket-Protocol: adimari.nas-control.v1
Authorization: Connector <connectorId>.<deviceSecret>
```

It is a presence/keepalive channel only in Phase 2B. The REST heartbeat remains
the authoritative liveness and revocation path; there are no file-transfer or
job messages on the socket yet. The backend accepts a maximum of one valid
session per connector, closes active and pending sessions after revocation or
credential rotation, and rejects a `hello` that names an unknown or disabled
enrolled root. The socket records connector presence only; root display metadata
and `uploadsEnabled` remain owned by enrollment and the REST heartbeat. The
connector credential must be in the authorization header only—never in the URL
or a WebSocket message.

This initial session registry is intentionally process-local. Run one Backend
process/PM2 instance for this feature. Do not use Node cluster mode, multiple
PM2 instances, or multiple backend hosts until a shared session-invalidation
fan-out mechanism is implemented; otherwise a revocation on one process cannot
immediately close a socket owned by another.

## Required backend environment

In addition to the existing NAS bucket/prefix variables, configure:

```ini
NAS_CONNECTOR_AUTH_HMAC_SECRET=<at least 32 random bytes; backend secret only>
NAS_CONNECTOR_ENROLLMENT_TOKEN_TTL_SECONDS=900
NAS_CONNECTOR_ENROLLMENT_RECOVERY_TTL_SECONDS=3600
NAS_CONNECTOR_HEARTBEAT_INTERVAL_SECONDS=30
NAS_CONNECTOR_HEARTBEAT_STALE_AFTER_SECONDS=90
NAS_CONNECTOR_CONTROL_PING_INTERVAL_SECONDS=30
NAS_CONNECTOR_CONTROL_UPGRADE_RATE_LIMIT_PER_MINUTE=30
```

`NAS_CONNECTOR_ENROLLMENT_RECOVERY_TTL_SECONDS` is optional and defaults to
3600. It is the bounded retention interval after `expiresAt` for an already
consumed token's HMAC-only recovery record; it does not make raw tokens valid
for longer.

`NAS_CONNECTOR_HEARTBEAT_STALE_AFTER_SECONDS` is optional and defaults to three
times `NAS_CONNECTOR_HEARTBEAT_INTERVAL_SECONDS`. It must be at least twice the
configured heartbeat interval and no more than seven days.

`NAS_CONNECTOR_CONTROL_PING_INTERVAL_SECONDS` is optional and defaults to the
REST heartbeat interval. `NAS_CONNECTOR_CONTROL_UPGRADE_RATE_LIMIT_PER_MINUTE`
is a bounded Node-side defense-in-depth limit per client address (default 30).
The trusted HTTPS reverse proxy must also apply its own upgrade rate and
connection limits before Node; its public listener is the enforcement boundary.

The enrollment-token collection TTL index must be on `recoveryExpiresAt`, not
`expiresAt`, so a consumed token survives only long enough for recovery. If an
early Phase 2 deployment already created the old `expiresAt` TTL index, replace
that index as part of the deployment migration before relying on lost-response
recovery.

Changing `NAS_CONNECTOR_AUTH_HMAC_SECRET` intentionally invalidates all existing
enrollment tokens and connector device credentials; rotate it only through a
planned re-enrollment procedure.
