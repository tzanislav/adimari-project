# NAS Connector API

NAS connector routes are available only when `NAS_CONNECTOR_ENABLED=true`.
They use the existing HTTPS-only connector transport. The Connector sends
logical root IDs and relative catalogue paths; it never sends a native NAS path
or S3 credentials.

## Authentication

The deployment has one manually distributed 32-byte base64url key:
`NAS_CONNECTOR_SHARED_SECRET`.

The shared key is used only for the initial connector enrollment:

```text
POST /api/nas-connectors/connect
Authorization: ConnectorKey <NAS_CONNECTOR_SHARED_SECRET>
```

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

After a successful response, every connector control request uses only the
returned connector ID. The shared key is not stored or revalidated during
heartbeats, polling, job execution, or catalogue updates:

```text
Authorization: Connector <connectorId>
```

It creates or reconnects the stable installation and returns the redacted
connector plus `heartbeatIntervalSeconds`.

Administrator routes use a Firebase ID token with the `admin` role:

```text
Authorization: Bearer <token>
```

Incorrect, unknown, disabled, or revoked Connector credentials receive
`401 NAS_CONNECTOR_UNAUTHORIZED`.

## Connector control plane

- `POST /api/nas-connectors/control/heartbeat` updates liveness, root metadata,
  and the reported queue state. Its body contains the same installation/root
  shape as `/connect`, plus `state` (`ready`, `busy`, or `degraded`), a
  non-negative `queueLength`, and an optional `thumbnailWorkerCount` from 1 to
  16. Omitting the latter preserves one-at-a-time behavior for legacy
  connectors; current connectors advertise four worker slots.
- `POST /api/nas-connectors/control/jobs/poll` waits for one durable job
  assignment. It accepts an optional bounded `waitSeconds`.
- `POST /api/nas-connectors/control/jobs/ack` acknowledges one exact
  `{ jobId, deliveryId, status }` assignment receipt.
- `POST /api/nas-connectors/control/index-requests` requests a local full scan
  for an enabled `connectorRootId`.
- `POST /api/nas-connectors/control/catalogue/changes` submits a bounded batch
  of safe relative watcher changes.

The Connector uses the job-specific control endpoints for an accepted job:

- `POST /api/nas-connectors/control/jobs/:jobId/index/start`
- `POST /api/nas-connectors/control/jobs/:jobId/index/batches`
- `POST /api/nas-connectors/control/jobs/:jobId/index/complete`
- `POST /api/nas-connectors/control/jobs/:jobId/cache/start`
- `POST /api/nas-connectors/control/jobs/:jobId/cache/complete`
- `POST /api/nas-connectors/control/jobs/:jobId/thumbnail/start`
- `POST /api/nas-connectors/control/jobs/:jobId/thumbnail/complete`
- `POST /api/nas-connectors/control/jobs/:jobId/write-upload/start`
- `POST /api/nas-connectors/control/jobs/:jobId/write-upload/complete`
- `POST /api/nas-connectors/control/jobs/:jobId/write-upload/fail`

Each job endpoint validates that the job belongs to the authenticated connector.
Payloads use opaque IDs, relative paths, fingerprints, and short-lived URLs;
they do not expose backend credentials or filesystem paths.

## Administrator management

- `GET /api/nas-connectors` lists redacted connector state.
- `POST /api/nas-connectors/:id/revoke` disables a Connector and its known
  roots.
- `POST /api/nas-connectors/:id/enable` re-enables a Connector as `offline`;
  its next valid heartbeat restores `active`.
- `POST /api/nas-connectors/:id/roots/:connectorRootId/index-jobs` creates or
  reuses the durable full-index job for an enabled root.
- `GET /api/nas-connectors/:id/jobs` lists redacted jobs for diagnostics.
- `POST /api/nas-connectors/:id/jobs/:jobId/cancel` cancels an active index
  scan.
- `GET /api/nas-connectors/recovery/jobs` lists bounded stale jobs.
- `POST /api/nas-connectors/:connectorId/jobs/:jobId/recovery/stop` marks one
  still-stale job as failed without replaying its NAS operation.

## Liveness

An active Connector becomes `offline` after
`NAS_CONNECTOR_HEARTBEAT_STALE_AFTER_SECONDS` without a heartbeat. The default
is three heartbeat intervals. A valid heartbeat from an offline Connector
restores it to `active`; no operator workflow is required for an ordinary
network or service interruption.

## Required configuration

```ini
NAS_CONNECTOR_ENABLED=true
NAS_CONNECTOR_SHARED_SECRET=<43-character base64url shared connector key>
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

`NAS_CONNECTOR_SHARED_SECRET` is 32 random bytes encoded as unpadded base64url
(43 characters). Store it outside source control and enter it only when
enrolling a Connector. It is not retained or revalidated by an already
enrolled Connector. If it changes, only newly enrolled Connectors need the new
key.

The NAS bucket and prefix settings in `.env.example` remain required for the
catalogue, cache, thumbnail, and browser-to-NAS upload work.

## Removal release notes

The retired one-time enrollment endpoints are not part of this API:

- `POST /api/nas-connectors/enrollment-tokens`
- `POST /api/nas-connectors/:id/re-enrollment-tokens`
- `POST /api/nas-connectors/enroll`

They now return `404`. The backend no longer reads
`NAS_CONNECTOR_AUTH_HMAC_SECRET`,
`NAS_CONNECTOR_ENROLLMENT_TOKEN_TTL_SECONDS`, or
`NAS_CONNECTOR_ENROLLMENT_RECOVERY_TTL_SECONDS`.

The Control Center/service IPC contract is version 2 and must be upgraded as a
matched pair. This release does not retain or migrate the old persisted shared
key: after **Reset all**, enter it once to create a fresh enrollment. The
connector then retains only its server-issued connector ID.

After deploying this release and confirming no old Connector installation is
still in use, operators may remove the unused `nas_enrollment_tokens` MongoDB
collection during a planned maintenance window. The application does not delete
that historical data automatically.
