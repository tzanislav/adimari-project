# NAS Connector ↔ Backend interface

## Scope and direction

The Connector initiates every network call. The backend never opens a direct connection, socket, or push channel to the Connector. It queues work; the Connector learns about that work on its next HTTPS poll.

| Direction | Transport | Purpose |
|---|---|---|
| Connector → backend | HTTPS JSON | Enrolment, heartbeat, job polling, job progress, catalogue changes, file-transfer control |
| Backend → Connector | HTTPS response to Connector poll | One queued job assignment, or no content |
| Control Center → Connector service | Local named pipe | Status, setup, tests, local index request/cancel, reset |
| Browser/admin → backend | HTTPS JSON | Queue, inspect, cancel, revoke, or initiate Connector work |

All Connector API bodies are JSON and limited to 1 MiB. The Connector API requires HTTPS unless NAS_CONNECTOR_ALLOW_HTTP=true. Heartbeat, poll and acknowledgement endpoints are rate-limited to 120 requests/minute in production.

## Security and logging boundary

| Item | What happens | Observable result |
|---|---|---|
| Enrolment key | Sent once in Authorization: ConnectorKey key | Backend issues Connector ID; key is not returned |
| Runtime credential | Later calls use Authorization: Connector connectorId | The Connector ID is a bearer credential; protect it as a secret |
| Revocation | Admin revokes Connector ID | Further authenticated calls fail; it does not forcibly stop already-running NAS work |
| Credential recovery | Local encrypted credential cannot be read | UI requires reset; reset discards the local credential and requires enrolment again |
| Transport | TLS required by default | HTTP is refused unless explicitly enabled by configuration |
| Backend logs | Records authentication, job, validation and server errors | Secrets and raw credential values should not be logged |
| Connector activity log | Last 50 local activity entries, with category and state | Visible in Control Center; activity is not a full security audit log |
| Browser test message | Front-end still calls POST /api/nas-connectors/:id/test-message | No matching backend route exists, so it returns 404 |

## IDE-style payload legend

The HTML version of this document renders these payloads as syntax-highlighted editor blocks. Fields marked optional may be omitted. Empty body means the request body is ignored or absent.

### Enrolment

    POST /api/nas-connectors/connect
    Authorization: ConnectorKey <enrolment-key>
    {
      "installationId": "string",
      "agentVersion": "string",
      "root": { "path": "string" },
      "thumbnailWorkerCount": 1
    }

    200 OK
    {
      "connector": {
        "id": "24-character hex identifier",
        "status": "active",
        "roots": [{ "id": "string", "path": "string" }]
      },
      "heartbeatIntervalSeconds": 30
    }

### Job assignment delivered by a poll

    200 OK
    {
      "assignment": {
        "jobId": "string",
        "deliveryId": "string",
        "jobType": "index_root",
        "connectorRootId": "string",
        "leaseExpiresAt": "ISO-8601 timestamp",
        "payload": {}
      }
    }

Job types and payloads:

| jobType | payload |
|---|---|
| index_root | {} |
| cache_for_download | { "fileEntryId": "string", "fileShareId": "string" } |
| generate_thumbnail | { "fileEntryId": "string" } |
| write_upload_to_nas | {} |

## Complete communication matrix

| # | State / trigger | Initiator → endpoint | Request payload | Response / resulting state |
|---:|---|---|---|---|
| 1 | Connector is configured but has no credential | Connector → POST /connect | installationId, agentVersion, root, thumbnailWorkerCount? | 200: credential becomes enrolled; 401/403: key rejected; 5xx/network: retry offline |
| 2 | Normal connected interval | Connector → POST /control/heartbeat | installationId, agentVersion, root, state, queueLength, thumbnailWorkerCount? | 200: backend liveness active and connector UI Connected; auth failure: credential recovery/enrolment required |
| 3 | Connector wants work | Connector → POST /control/jobs/poll | waitSeconds? (0–25; default 20) | 200 assignment: queue work locally; 204: no work; auth/network error: HTTPS polling offline |
| 4 | Connector accepted job delivery | Connector → POST /control/jobs/ack | jobId, deliveryId, status=accepted or duplicate | 200: backend marks delivery received; rejection: local retry |
| 5 | Operator selects Run index scan | Control Center → local service → POST /control/index-requests | connectorRootId | 201: index job queued; backend job later appears through poll |
| 6 | Operator selects Cancel queued scan | Control Center → local service → POST /control/jobs/:jobId/index/cancel | Empty | 200: queued index cancelled; running source work is not safely cancelled |
| 7 | Backend delivers index_root | Connector → POST /control/jobs/:jobId/index/start | scanId | 200: scan running; conflict/invalid state: job fails or retries |
| 8 | Index scan produces entries | Connector → POST /control/jobs/:jobId/index/batches | scanId, entries (1–250) | 200: entries recorded; error: retry/fail based on job state |
| 9 | Index scan completes | Connector → POST /control/jobs/:jobId/index/complete | scanId, entryCount | 200: index completed |
| 10 | NAS watcher or reconciliation sees changes | Connector → POST /control/catalogue/changes | connectorRootId, changes (1–250) | 200: catalogue updated; error: retry |
| 11 | Browser/admin requests download preparation | Backend queues cache_for_download; Connector receives it by poll | assignment payload has fileEntryId, fileShareId | Connector starts cache job; backend returns file path, fingerprint, bytes, type and upload URL |
| 12 | Cached source is ready | Connector → POST /control/jobs/:jobId/cache/complete | versionFingerprint, sizeBytes | 200: delivery becomes ready |
| 13 | Cache cannot be made | Connector → POST /control/jobs/:jobId/cache/fail | code: source_unavailable, source_changed, image_invalid, image_too_large, or storage_rejected | 200: backend marks/retries job according to policy |
| 14 | Browser requests thumbnail | Backend queues generate_thumbnail; Connector receives it by poll | assignment payload has fileEntryId | Connector starts thumbnail job; backend returns path, fingerprint, type, dimension and upload URL |
| 15 | Thumbnail is ready | Connector → POST /control/jobs/:jobId/thumbnail/complete | versionFingerprint, sizeBytes | 200: thumbnail ready |
| 16 | Thumbnail fails | Connector → POST /control/jobs/:jobId/thumbnail/fail | same cache failure code set | 200: backend records/retries failure |
| 17 | Browser stages an upload | Browser/backend queues write_upload_to_nas; Connector receives it by poll | empty assignment payload | Connector starts transfer; backend returns relativePath, contentType, sizeBytes and downloadUrl |
| 18 | NAS write completes | Connector → POST /control/jobs/:jobId/upload/complete | sizeBytes | 200: upload completed |
| 19 | NAS write fails | Connector → POST /control/jobs/:jobId/upload/fail | code: destination_exists, destination_unavailable, staging_unavailable, or write_failed | 200: backend records/retries failure |
| 20 | Operator clicks Test root access | Control Center → local service | Selected local root | Local-only response: success/failure displayed; no backend request |
| 21 | Operator clicks Test web server | Control Center → local service → backend health check | No Connector API payload | UI shows HTTPS health check succeeded/failed and time |
| 22 | Operator clicks Connect connector | Control Center → local service → /connect | Uses saved setup and local credential state | UI changes through Connecting, Connected, rejected, unavailable, or recovery-required |
| 23 | Operator clicks Reset unreadable credential | Control Center → local service | Empty | Local credential discarded; UI shows Connector key required |
| 24 | Operator clicks RESET ALL | Control Center → local service → POST /control/reset-all | Empty | Development-only reset; backend/local connector data cleared when enabled |
| 25 | Admin queues index job | Browser/admin → POST /api/nas-connectors/:id/roots/:rootId/index-jobs | Root/job options | Queued job becomes visible to Connector only on poll |
| 26 | Admin cancels job | Browser/admin → admin cancel endpoint | Job identifier | Index and thumbnail can be cancelled; cache/write cannot be cancelled by this path |
| 27 | Admin revokes Connector | Browser/admin → revoke endpoint | Connector identifier | Credential rejected on future Connector API calls; running local work is not force-stopped |

## Exact Connector API payloads

### Heartbeat

    POST /api/nas-connectors/control/heartbeat
    Authorization: Connector <connectorId>
    {
      "installationId": "string",
      "agentVersion": "string",
      "root": { "path": "string" },
      "state": "string",
      "queueLength": 0,
      "thumbnailWorkerCount": 1
    }

    200 OK
    {
      "connector": { "id": "string", "status": "active" },
      "state": "string",
      "queueLength": 0,
      "heartbeatIntervalSeconds": 30
    }

### Poll and acknowledgement

    POST /api/nas-connectors/control/jobs/poll
    { "waitSeconds": 20 }

    204 No Content

    POST /api/nas-connectors/control/jobs/ack
    { "jobId": "string", "deliveryId": "string", "status": "accepted" }

    200 OK
    { "accepted": true }

### Indexing

    POST /api/nas-connectors/control/index-requests
    { "connectorRootId": "string" }

    201 Created
    { "created": true, "job": { "id": "string", "status": "queued" } }

    POST /api/nas-connectors/control/jobs/:jobId/index/start
    { "scanId": "string" }

    POST /api/nas-connectors/control/jobs/:jobId/index/batches
    {
      "scanId": "string",
      "entries": [{ "relativePath": "string", "sizeBytes": 0 }]
    }

    POST /api/nas-connectors/control/jobs/:jobId/index/complete
    { "scanId": "string", "entryCount": 0 }

### Catalogue changes

    POST /api/nas-connectors/control/catalogue/changes
    {
      "connectorRootId": "string",
      "changes": [{ "type": "upsert|delete", "relativePath": "string" }]
    }

### Cache, thumbnail and NAS upload lifecycle

| Operation | Start request | Successful start response | Complete request | Fail request |
|---|---|---|---|---|
| Cache for download | POST .../cache/start with {} | relativePath, versionFingerprint, sizeBytes, contentType, uploadUrl | POST .../cache/complete with versionFingerprint, sizeBytes | POST .../cache/fail with code |
| Thumbnail | POST .../thumbnail/start with {} | relativePath, versionFingerprint, contentType, maxDimension, uploadUrl | POST .../thumbnail/complete with versionFingerprint, sizeBytes | POST .../thumbnail/fail with code |
| Write to NAS | POST .../upload/start with {} | relativePath, contentType, sizeBytes, downloadUrl; may return completed:true | POST .../upload/complete with sizeBytes | POST .../upload/fail with code |

The cache start response has this shape:

    {
      "relativePath": "string",
      "versionFingerprint": "string",
      "sizeBytes": 0,
      "contentType": "string",
      "uploadUrl": "https://..."
    }

The thumbnail start response has this shape:

    {
      "relativePath": "string",
      "versionFingerprint": "string",
      "contentType": "image/jpeg",
      "maxDimension": 0,
      "uploadUrl": "https://..."
    }

The NAS-write start response has this shape:

    {
      "relativePath": "string",
      "contentType": "string",
      "sizeBytes": 0,
      "downloadUrl": "https://..."
    }

## Connector Control Center: possible read-outs

The desktop UI refreshes status through a local named pipe once per second. Its protocol returns Success, ErrorCode, ErrorMessage, Status and Configuration. It displays no secret value; only the final six characters of the Connector ID are shown after connection.

| UI field | Possible read-out / format | Trigger |
|---|---|---|
| Service | Starting; Running; Stopped; Service unavailable | Service lifecycle; named-pipe transport failure |
| Web server | HTTPS health check succeeded; HTTPS health check failed | Test web server action |
| Connector access | Not configured; Awaiting enrollment; Connecting connector; Enrollment key rejected; Backend unavailable; Connected; Operator action required; Configuration needs attention; Offline - retrying; Configured; connector key required; Credential reset; connector key required | Setup, connect, heartbeat or authentication outcome |
| Last heartbeat | Not connected yet; localized date/time | Successful heartbeat |
| Job delivery | Not started; Not configured; Awaiting connector enrollment; HTTPS polling; HTTPS polling offline; Connector registration was not recognized; Local job queue needs attention | Polling and local job queue state |
| Last web test | Not tested yet; localized date/time | Web test completes |
| Transfer queue | N jobs | Local queue changes; clamped at 1,000,000 |
| Index scan | No index scan is running; Running: message; Completed: message; Failed: message; entry count, elapsed time and optional entries/sec | Index lifecycle and progress |
| Index progress bar | Indeterminate while running; full when completed | Index lifecycle |
| Recent activity | Up to 50 entries: category, state, message, timestamp | Local action, network result, job result or watcher event |
| Last error | Latest error text | Any failing local/network/job operation |

### Connection-status transitions

| Previous condition | UI state shown | Next event |
|---|---|---|
| No valid setup | Not configured | Save setup |
| Setup saved, no credential | Awaiting enrollment or Connector key required | Connect connector |
| Enrolment started | Connecting connector | Enrolment response |
| Valid enrolment | Connected; starting heartbeat, then Connected | First heartbeat succeeds |
| Invalid enrolment key | Enrollment key rejected | Supply a valid key |
| Credential does not identify a registered connector | Connector registration was not recognized | Clear/re-enrol credential |
| Encrypted local credential unreadable | Credential recovery required | Reset unreadable credential |
| Server/network unavailable | Backend unavailable or Offline - retrying | Automatic retry succeeds |
| Server accepts heartbeat/poll | Connected and HTTPS polling | Continuing service |
| Admin revokes the connector | Connector registration was not recognized | Enrol again with authorized key |

### Recent activity categories

| Category | Typical messages / state |
|---|---|
| Service | Connector service started or stopped |
| Configuration | Setup saved |
| Root access test | Root can be accessed; root invalid/unavailable |
| Web server test | Connected to server; HTTPS health failure |
| Connector access / Heartbeat | Connecting, enrolled, rejected, backend unavailable, registration lost, configuration incomplete |
| Job delivery / Job queue | Poll or acknowledgement retry; queue unreadable; assignment expired; queue cleared/blocked |
| Index root | Queued, progress, completed, retry, root changed, already running |
| NAS changes | Monitoring, changes sent, watcher failure, reconciliation or catalogue retry |
| File delivery | Preparing, uploading, ready, unavailable, retry or cancelled |
| Thumbnail | Preparing, generating, ready, failed, retry or cancelled |
| NAS upload | Receiving, staging download, written, already complete, root changed or failed |
| Credential recovery | Credential unreadable, quarantined or reset failure |
| Development reset | Backend/local connector state cleared |

Each entry uses one of: Queued, Running, Completed, Failed or Informational.

## Backend state and queue behaviour

| Backend condition | Backend action | Connector-visible outcome |
|---|---|---|
| A job is queued | Waits for Connector poll | No immediate notification; next poll receives assignment |
| No job is eligible | Poll response 204 | HTTPS polling continues |
| Assignment accepted but no progress for 120 seconds | Requeues assignment | May be delivered again |
| In-progress job has no progress for 20 minutes | Fails with connector_job_watchdog_timeout | Local activity/error eventually reports job failure |
| Assignment lease expires | Requeues work | May be delivered again |
| Active Connector goes stale | Backend marks it offline | Admin sees offline; heartbeat restores active |
| Browser reads file/catalogue | Backend serves stored data | Does not contact Connector |
| Cache/write/index work | Serial processing lane | One of those runs at a time |
| Thumbnail work | Concurrent workers | 1–16 workers, based on thumbnailWorkerCount; index waits for active thumbnails |

## Limits and implementation notes

| Area | Rule |
|---|---|
| Control Center local IPC | Named-pipe protocol version 3; maximum message size 64 KiB |
| Index and catalogue batches | 1–250 entries/changes per request |
| Poll wait | 0–25 seconds, 20 seconds by default |
| Local activity history | Last 50 entries |
| Queue display | Maximum shown value 1,000,000 |
| Cancellation | Queued index can be cancelled; running cache/thumbnail/NAS-write work is not safely interrupted |
| Backend-to-Connector push | None |

## Sources inspected

Backend: Backend/routes/nasConnectorRoutes.js, Backend/routes/nasCatalogueRoutes.js, authentication/configuration, job queue and retention code.

Connector: adimari-nas-connector ControlCenter UI, local IPC contracts/dispatcher, runtime state, connection, polling, job runner, index, watcher, cache, thumbnail and upload workers.
