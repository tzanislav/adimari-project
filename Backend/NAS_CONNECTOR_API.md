# NAS Connector API — Phase 2

These endpoints are mounted only when `NAS_CONNECTOR_ENABLED=true`. They require
HTTPS; the backend returns `NAS_CONNECTOR_HTTPS_REQUIRED` for cleartext requests.
The connector never sends a NAS path, S3 credential, or browser-user credential.

## Current connector authentication: shared access key

This small trusted deployment uses one manually distributed 32-byte base64url
key: `NAS_CONNECTOR_SHARED_SECRET`. It replaces the previous operational need
for browser-issued enrollment and re-enrollment tokens. The Windows service
stores the entered key only in its service-owned DPAPI credential store.

`POST /api/nas-connectors/connect` is the first connector request. It uses:

```text
Authorization: ConnectorKey <NAS_CONNECTOR_SHARED_SECRET>
```

and the following body:

```json
{
  "installationId": "a9d24d65-1a96-4f65-aa06-40c74c5934ac",
  "agentVersion": "1.0.0",
  "root": {
    "connectorRootId": "office-projects",
    "displayName": "Office Projects",
    "uploadsEnabled": true
  }
}
```

The backend creates or reuses the record for that stable installation ID,
activates its root, and returns the connector ID plus the heartbeat interval.
Subsequent connector HTTPS requests use:

```text
Authorization: Connector <connectorId>.<NAS_CONNECTOR_SHARED_SECRET>
```

The browser never receives this key. A wrong key receives the generic
`401 NAS_CONNECTOR_UNAUTHORIZED` response. The token endpoints documented
below remain only for compatibility with old installations; the current
Control Center and admin page do not use them.

## Authentication types

- **Administrator calls** use a Firebase ID token: `Authorization: Bearer <token>`.
  The Firebase user must have role `admin`.
- **Connector calls** use the configured shared access key:
  `Authorization: Connector <connectorId>.<NAS_CONNECTOR_SHARED_SECRET>`.

The shared key is 32 cryptographically random bytes encoded as unpadded
base64url (43 characters). It is stored by the Service in OS-protected storage.
For operator convenience, the open Control Center window keeps the masked value
after a successful connection; closing that window clears the field.

## Legacy token endpoint: create an enrollment token

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

## Legacy token endpoint: create a re-enrollment token

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

## Legacy token endpoint: enroll a connector

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
offline. An `offline` connector retains its protected local shared key, so its
next authenticated heartbeat can set it back to `active`; it does not require
any browser or token action after an ordinary network or service interruption.

## Administrator management

- `GET /api/nas-connectors` returns `{ "connectors": [<redacted connector>] }`.
- `POST /api/nas-connectors/:id/re-enrollment-tokens` issues a one-time token
  bound to that existing connector. Redeem it through the ordinary `/enroll`
  endpoint; no separate connector-side API contract is required.
- `POST /api/nas-connectors/:id/revoke` disables the connector and its known
  roots, and returns
  `{ "connector": <redacted connector> }`.
- `POST /api/nas-connectors/:id/enable` restores a disabled connector as
  `offline` and re-enables its roots. Its existing Windows Service will return
  to `active` after the next valid shared-key heartbeat; no enrollment token is
  needed.
- `POST /api/nas-connectors/:id/roots/:connectorRootId/index-jobs` creates the
  initial, administrator-only durable delivery test job. Its body is empty.
  It accepts only an enabled root belonging to an active or offline connector,
  returns `201 { "created": true, "job": <redacted job> }`, and returns the
  same job with `200 { "created": false, ... }` when it is already queued,
  assigned, or durably accepted.
- `POST /api/nas-connectors/:id/jobs/:jobId/cancel` cancels an active index
  scan at any queue stage (`queued`, `assigned`, `accepted`, or `in_progress`).
  The browser and Control Center both use this normal application control; do
  not edit queue documents directly in MongoDB.
- `GET /api/nas-connectors/:id/jobs` returns the redacted jobs for that
  connector. This is an operator diagnostic endpoint; it does not expose a
  browser file API or a native NAS path.

Disabling takes effect on the next request because authentication only accepts
connectors whose status is `active` or `offline`.

## Durable HTTPS job polling

The Windows Service requests one durable lease with
`POST /api/nas-connectors/control/jobs/poll`, sending
`{ "waitSeconds": 20 }` and its ordinary `Connector` authorization header.
The backend returns `204` when no job is available, or `200` with one opaque
assignment. The service persists that assignment locally before it reports the
same `{ jobId, deliveryId, status }` to
`POST /api/nas-connectors/control/jobs/ack`. Repeating either request is safe:
the same unacknowledged lease is returned until it expires or is acknowledged,
and an exact acknowledgement is idempotent.

The REST heartbeat remains authoritative for liveness and connector disable.
The polling payload never contains a NAS path, object-storage credential, or
browser credential.

## Connector indexing reports (Phase 3A)

After the service has durably accepted an `index_root` delivery, it executes
the scan through authenticated HTTPS—not through the browser. The connector
sends only safe relative metadata in batches of at most
250 entries; native/UNC paths are rejected.

- `POST /api/nas-connectors/control/jobs/:jobId/index/start`
  accepts `{ "scanId": "UUID" }` and moves the connector's accepted index job
  to `in_progress`. Repeating the same request is safe.
- `POST /api/nas-connectors/control/jobs/:jobId/index/batches`
  accepts `{ "scanId": "UUID", "entries": [...] }`. Each entry contains a
  normalized relative path, parent path, name, file/folder type, size (or null
  for folders), UTC modified time, version fingerprint, content type, and
  preview kind. The backend upserts it under the connector's enrolled root.
- `POST /api/nas-connectors/control/jobs/:jobId/index/complete`
  accepts `{ "scanId": "UUID", "entryCount": 123 }`, marks unseen catalogue
  entries unavailable, records root scan health, and completes the job.
  Repeating the exact completion request is safe if the original success
  response was lost.
- `POST /api/nas-connectors/control/jobs/:jobId/index/cancel` accepts `{}` and
  cancels an accepted or in-progress scan for that connector. It is idempotent
  for an already-cancelled job. The Control Center calls this after clearing a
  local index job.

## Incremental catalogue changes (Phase 3C)

The running Windows connector also watches its configured root and sends a
small authenticated batch shortly after a file is created, changed, deleted,
or renamed. This is not a browser endpoint and never contains a native
Windows/UNC path:

- POST /api/nas-connectors/control/catalogue/changes accepts
  { "connectorRootId": "opaque-id", "changes": [...] }.
  An upsert is { "operation": "upsert", "entry": the same entry shape as an
  index batch }; a deletion is
  { "operation": "delete", "relativePath": "folder/file.txt",
  "recursive": false }. A recursive deletion safely marks a deleted folder and
  its descendants unavailable.

Each request is bounded to 250 changes. A version change marks existing cache
and thumbnail metadata stale, so a later Open, Download, Share, or thumbnail
request obtains the new NAS version rather than reusing an old one. The
connector requests the normal durable full scan after a watcher overflow,
directory rename, or every 12 hours; notifications provide prompt updates but
are not treated as a complete source of truth.

There is intentionally no browser catalogue endpoint in this slice. The next
Phase 3B slice will expose the indexed metadata to the existing File Server UI.

## Required backend environment

In addition to the existing NAS bucket/prefix variables, configure:

```ini
NAS_CONNECTOR_AUTH_HMAC_SECRET=<at least 32 random bytes; backend secret only>
NAS_CONNECTOR_SHARED_SECRET=<32-byte base64url key; enter the same value once in each trusted Control Center>
# Optional legacy-token compatibility only:
# NAS_CONNECTOR_ENROLLMENT_TOKEN_TTL_SECONDS=900
# NAS_CONNECTOR_ENROLLMENT_RECOVERY_TTL_SECONDS=3600
NAS_CONNECTOR_HEARTBEAT_INTERVAL_SECONDS=30
NAS_CONNECTOR_HEARTBEAT_STALE_AFTER_SECONDS=90
NAS_CONNECTOR_JOB_LEASE_SECONDS=90
NAS_CONNECTOR_TERMINAL_JOB_RETENTION_DAYS=30
NAS_CONNECTOR_DELETED_ENTRY_RETENTION_DAYS=30
NAS_CONNECTOR_AUDIT_RETENTION_DAYS=365
NAS_CONNECTOR_STALE_THUMBNAIL_RETENTION_DAYS=14
NAS_CONNECTOR_RETENTION_SWEEP_INTERVAL_HOURS=6
NAS_CONNECTOR_RECOVERY_STUCK_AFTER_MINUTES=30
```

The commented enrollment settings are optional compatibility settings for an
older token-based connector. They default to 900 and 3600 seconds respectively
and are not used by the shared-key connector.

`NAS_CONNECTOR_HEARTBEAT_STALE_AFTER_SECONDS` is optional and defaults to three
times `NAS_CONNECTOR_HEARTBEAT_INTERVAL_SECONDS`. It must be at least twice the
configured heartbeat interval and no more than seven days.

`NAS_CONNECTOR_JOB_LEASE_SECONDS` is optional and defaults to 90. It controls
only how long the backend waits for durable delivery acknowledgement before it
may resend the same job; it is not a NAS scan or transfer timeout.

## Retention and stale-job recovery (Phase 6)

The backend runs a bounded retention sweep every six hours by default. It gives
terminal transfer jobs, audit events, soft-deleted catalogue entries, and stale
thumbnail objects a conservative lifecycle without relying on an unbounded S3
listing. MongoDB TTL indexes remove transfer jobs and audit events once their
`purgeAfter` timestamp is set; the sweep also performs the deletion directly so
retention is not tied to MongoDB's asynchronous TTL monitor.

The retention and recovery settings above are optional. Their defaults are 30
days for terminal jobs and deleted entries, 365 days for audits, and 14 days
for stale thumbnail objects. A newly completed thumbnail also best-effort
deletes the prior thumbnail object for that catalogue entry.

Administrators have a deliberately small recovery surface for jobs that have
made no backend-visible progress for `NAS_CONNECTOR_RECOVERY_STUCK_AFTER_MINUTES`
(30 minutes by default):

- `GET /api/nas-connectors/recovery/jobs` returns at most 100 active stale
  jobs, ordered by their oldest update.
- `POST /api/nas-connectors/:connectorId/jobs/:jobId/recovery/stop` accepts
  `{}` and marks one still-stale job as failed with
  `operator_recovery_stopped`.

Stopping is intentional and non-destructive: it clears the outstanding delivery
lease but never automatically replays a NAS operation. Cache and thumbnail
records that were waiting for the job are marked failed, and the action is
audited. Request a new operation only after reviewing why the original job
stopped.

## Connector cache-delivery reports (Phase 4 initial slice)

After the connector accepts a `cache_for_download` assignment, it uses these
authenticated endpoints. The job assignment contains only `fileEntryId` and
`fileShareId`; the backend resolves the current indexed relative path and
creates the single short-lived S3 PUT URL only at start time.

- `POST /api/nas-connectors/control/jobs/:jobId/cache/start` accepts `{}` and
  returns `{ relativePath, versionFingerprint, sizeBytes, contentType, uploadUrl }`.
  `uploadUrl` is used directly for one private cache-object PUT and must never
  be stored or logged by the connector.
- `POST /api/nas-connectors/control/jobs/:jobId/cache/complete` accepts
  `{ "versionFingerprint": "...", "sizeBytes": 123 }`. The backend verifies
  the cached object length, verifies the indexed source is still the same
  version, marks the File Server share `ready`, and clears the terminal job's
  idempotency key.

The connector resolves `relativePath` below the root captured when it received
the job, rejects escapes/reparse points, and verifies local size/fingerprint
before upload. This initial slice is one serial direct PUT; multipart/resume and
byte-progress reports are the next Phase-4 increment.

## Authenticated NAS File delivery (Phase 4)

Moderator/admin users can request a normal browser file action without first
opening a public share page:

- `POST /api/nas-catalogue/entries/:entryId/deliveries` accepts exactly
  `{ "disposition": "inline" | "attachment" }`. It returns `200` with a
  short-lived `downloadUrl` when the indexed version already has a current
  cache object, or `202` with `{ delivery, retryAfterSeconds }` after queuing
  a cache job.
- `GET /api/nas-catalogue/deliveries/:deliveryId?disposition=inline|attachment`
  is restricted to the authenticated user that started the delivery. It returns
  `202` while preparation continues and `200` with the short-lived URL when
  ready. It returns `409` for a failed delivery and `410` after the temporary
  cache has expired.

The cache record is reused only when its version fingerprint still matches the
currently indexed NAS file and its stored cache expiry has not passed. The
browser never receives a NAS path, S3 key, AWS credential, or connector
credential.

The enrollment-token collection and its TTL index are legacy compatibility
data. They are not needed by the shared-key connector. Leave
`NAS_CONNECTOR_AUTH_HMAC_SECRET` stable for existing records; changing the
operational shared key is done with `NAS_CONNECTOR_SHARED_SECRET`, followed by
**Connect connector** on each trusted connector.

## Browser-to-NAS upload (Phase 5 initial slice)

Moderator/admin users start an upload only from an active root whose
uploadsEnabled setting is true. The browser is never given a native NAS path,
an S3 object key, an S3 multipart upload ID, or a connector credential.

- POST /api/nas-catalogue/roots/:rootId/uploads accepts exactly
  parentPath, fileName, sizeBytes, and contentType. It validates the indexed
  destination folder and collision state, creates an opaque upload ID, and
  returns uploadId, partSize, and maxParts.
- POST /api/nas-catalogue/uploads/:uploadId/parts accepts partNumbers and
  returns only short-lived part URLs.
- POST /api/nas-catalogue/uploads/:uploadId/complete accepts parts, validates
  the staged object length, queues the connector write, and returns the
  redacted transfer-job status.
- POST /api/nas-catalogue/uploads/:uploadId/abort cancels an unfinished
  browser staging upload. GET /api/nas-catalogue/uploads/:uploadId returns the
  requesting user's redacted job state for UI polling.

After accepting the empty write-upload-to-NAS control assignment, the
connector calls the start endpoint to receive relativePath, contentType,
sizeBytes, and a short-lived download URL; then it calls the complete endpoint
with sizeBytes after atomically moving the temporary file into the NAS folder.
It can report destination_exists, destination_unavailable, staging_unavailable,
or write_failed through the failure endpoint.

The initial slice validates byte length and rejects overwrite. Checksums,
malware scanning, resumable browser retries, and per-folder write permissions
remain later refinements.
