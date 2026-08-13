# NAS code audit report

**Audit date:** 2026-08-13
**Scope:** NAS-specific web backend and the separate Windows Connector solution
**Backend:** `C:\WebDev\adimari-project\Backend`
**Connector:** `C:\WebDev\adimari-nas-connector`

## Executive summary

The system has a sound high-level trust boundary: the Connector is the only
process that receives native NAS paths, all network connections are outbound
from the NAS side, browser transfers use private object storage, and the code
normally refuses traversal, reparse points, and overwrites. Those protections
should remain.

The main problem is accumulated state-machine complexity. Four delivery types
share one durable local queue, but they are executed by four independent
polling workers and coordinated with a separate heartbeat, WebSocket protocol,
backend lease manager, MongoDB job state, local JSON state, and several
operation-specific start/complete endpoints. Error handling is not uniform
across these layers. Several uncommon but realistic failures can therefore
leave a job blocked forever or report that the wrong file was uploaded.

The audit found five issues to fix before extending the feature set:

1. Changing the configured native root reuses the same logical root ID and can
   mix the identity of two different NAS folders.
2. Browser upload recovery treats any existing same-size file as the intended
   upload, and concurrent uploads do not reserve their destination.
3. Clearing a Connector job does not cancel work already executing, so a NAS
   write can continue after the queue appears empty.
4. Reporting permanent upload failure is not an acknowledged, end-to-end state
   transition. The backend can remain blocked after the local queue forgets the
   job.
5. Cache completion performs several dependent MongoDB writes in a
   non-idempotent order. A partial failure can leave the share ready while its
   job remains permanently in progress.

The largest safe simplification is to remove the unused legacy enrollment-token
mode. A second, larger simplification is to replace the custom persistent WSS
delivery channel with authenticated HTTPS long polling. For this installation
size, that would preserve the outbound-only design while removing most session,
ping, message-correlation, and in-memory delivery-target machinery.

## Scope and evidence

The review covered:

- Connector configuration, installation identity, DPAPI credential storage,
  local named-pipe IPC, heartbeat and control-channel clients, durable queue,
  indexer, watcher, cache delivery, thumbnail generation, NAS upload worker,
  Control Center, installer, and Connector tests.
- Backend NAS configuration, authentication, validation, models, queue,
  WebSocket channel, connector routes, catalogue routes, S3 staging/cache/
  thumbnail integration, server startup integration, and NAS tests.
- Cross-process job delivery, retries, cancellation, root changes, indexing,
  watcher/full-scan overlap, upload crash windows, and cache completion.

Approximate reviewed size:

| Area | Files | Lines |
| --- | ---: | ---: |
| Backend NAS production code | 15 | 5,690 |
| Backend NAS tests | 8 | 2,895 |
| Connector source/UI code | 68 | 9,750 |
| Connector tests | 15 | 1,865 |

Automated baseline:

- Backend: `npm test` passed **103/103** tests.
- Connector: `dotnet test .\Adimari.NasConnector.sln -c Release` built the
  solution and passed **40/40** tests.
- The backend test run emits Node's `DEP0040` warning through a dependency's
  use of `punycode`; it is unrelated to the NAS logic findings.

Passing tests do not invalidate the findings below. The Connector suite has no
tests for the cache, thumbnail, upload, or watcher workers, and the backend
suite largely tests their queue/start happy paths rather than failure recovery.

## Priority 0: correctness and data-integrity findings

### P0.1 — A native root change reuses the old logical root identity

**Evidence**

- `ConnectorInstallationStore` creates `InstallationId` and `ConnectorRootId`
  together once and persists them for the installation
  (`ConnectorInstallationStore.cs:53-55`).
- Saving configuration writes a new `RootPath`, but does not replace or retire
  `ConnectorRootId` (`ControlCenterRequestDispatcher.cs:80`).
- Jobs capture `RootPathAtReceipt`, which protects an individual old job, but
  does not protect the backend catalogue/root identity
  (`ConnectorJobStore.cs:123`, `ConnectorJobStore.cs:642`).
- Backend heartbeat/connect upserts the same storage-root record for that
  logical root ID.

**Impact**

If an operator changes `\\nas\projects` to `\\nas\finance`, the backend still
sees the same root. Old metadata remains browseable until a full scan completes,
new watcher events arrive under the old identity, and existing shares/cache
records still refer to files from the previous physical root. This violates the
documented rule that a root-path change must re-register the logical root.

**Recommendation**

For the current one-root product, make `RootPath` immutable after the first
successful connection. Add one explicit **Replace root** workflow that:

1. refuses replacement while a local job is active;
2. disables the old backend root;
3. generates a new logical `ConnectorRootId`;
4. clears watcher state and starts a mandatory full scan; and
5. leaves old catalogue/share records associated only with the disabled root.

This is simpler and safer than trying to make arbitrary edits to a connected
root behave like the same storage source.

### P0.2 — Same-size files can be falsely accepted as completed uploads

**Evidence**

- The Connector treats an existing destination whose length equals the staged
  upload length as a successful prior write
  (`WriteUploadToNasJobWorker.cs:104-115`).
- The browser upload route checks the catalogue for an existing path and then
  creates a staging job, but it does not atomically reserve that destination
  (`nasCatalogueRoutes.js:440-455`).
- The Connector's actual move correctly uses `overwrite: false`
  (`WriteUploadToNasJobWorker.cs:145`).

**Impact**

Two users can concurrently begin uploads to the same unindexed destination.
The first file wins the move. If the second file has the same byte length, its
worker reports success even if its contents are completely different. The same
false success can happen when an unrelated same-size file appears during a
retry after a service crash.

**Recommendation**

- Add an active destination reservation, ideally an `idempotencyKey` such as
  `write:<rootId>:<normalized-relative-path>` with one active value at a time.
- Never use file length alone as proof that an existing destination belongs to
  a job.
- Persist a local `moved_awaiting_server_ack` state after `File.Move`. A retry
  may accept the existing destination only when that same durable local job
  proves it performed the move.
- Add SHA-256 to the staging contract if content-level verification is wanted.
  Size is useful validation, but it is not file identity.

Keep the current no-overwrite move; it is an important safety property.

### P0.3 — Queue clear is not execution cancellation

**Evidence**

- `ClearAsync` removes the durable record immediately
  (`ConnectorJobStore.cs:47`).
- The Control Center only sends a backend cancellation for an index job
  (`ControlCenterRequestDispatcher.cs:210-235`).
- Cache, thumbnail, and upload workers run with the service shutdown token, not
  a per-job cancellation token.
- After a clear, a running upload can still reach `File.Move` and write to the
  NAS. An old worker can also finish after a new job occupies the one-item
  queue, causing conflicting completion behavior.

**Impact**

The user-visible **Clear queue** action can say the queue is empty while a file
transfer or NAS write continues. This is especially unsafe for uploads because
the final write is the action an operator reasonably expects to stop.

**Recommendation**

Replace `ClearAsync` with an explicit state transition:

- queued job: cancel and remove;
- executing job: signal a per-job `CancellationTokenSource`, wait for the
  handler to stop at a safe point, notify the backend, then remove;
- already committed NAS move: finish acknowledgement/reconciliation instead of
  pretending the write was cancelled.

Until that exists, disable Clear for running cache/thumbnail/upload jobs and
label the index-only action accurately.

### P0.4 — Permanent upload failure can be forgotten locally but remain active remotely

**Evidence**

- The Connector calls `ReportWriteUploadFailureAsync`, then unconditionally
  completes/removes its local job (`WriteUploadToNasJobWorker.cs:163-173`).
- `ReportWriteUploadFailureAsync` returns no result and swallows timeout/network
  failures (`ConnectorAgentClient.cs:757-782`).
- The backend refuses to assign another job while any job is `accepted` or
  `in_progress` (`nasConnectorJobQueue.js:673-678`).

**Impact**

If the network is down during the failure report, the Connector forgets the
job while MongoDB keeps it `in_progress`. That job then blocks every later job
for the connector, and normal redelivery cannot repair it because the local
record is gone.

**Recommendation**

Every terminal report must return a typed outcome. Remove the local job only
after the backend confirms either:

- the same job entered a terminal state; or
- the backend no longer owns that job (`job_gone`).

Persist and retry `failure_awaiting_ack` otherwise. Apply the same rule to
success acknowledgements.

### P0.5 — Cache completion is not idempotent across partial database failure

**Evidence**

The cache completion endpoint performs these writes in order:

1. mark the `FileShare` ready (`nasConnectorRoutes.js:1361`);
2. update the `NasFileEntry` cache pointer (`nasConnectorRoutes.js:1367`);
3. complete the transfer job (`nasConnectorRoutes.js:1379`).

A retry looks up only a share whose `deliveryStatus` is still `preparing`
(`nasConnectorRoutes.js:1348`).

**Impact**

If step 1 succeeds and step 2 or 3 fails, a retry cannot find the now-ready
share. The job remains `in_progress`, the Connector retries indefinitely, and
the single backend queue remains blocked even though the public share may
already be downloadable.

**Recommendation**

Make the finalizer replayable. It should accept either:

- `preparing` and transition to the expected key; or
- already `ready` with the exact expected key/version.

Then idempotently repair the entry and job. If MongoDB transactions are
available, use one transaction for the three Mongo writes; S3 `headFile`
remains outside the transaction. Even with a transaction, keep replay support
for lost HTTP responses.

## Priority 1: logic, race, and operational findings

### P1.1 — Permanent cache/thumbnail failures can monopolize the one-item queue

Cache source mismatch, corrupt/unsupported image decoding, an oversized image,
and several 409 responses are handled as generic retryable failures. There is
no cache/thumbnail failure endpoint and no finite retry/dead-letter state. A
permanently bad thumbnail can therefore retry every 15 seconds forever while
uploads and downloads wait behind it.

Use one shared handler outcome model:

```text
Succeeded | Retryable(delay) | Permanent(code) | Cancelled | RemoteGone
```

All job types should have a terminal failure endpoint, bounded exponential
backoff, an attempt limit for deterministic errors, and a backend watchdog for
abandoned `in_progress` jobs.

### P1.2 — An in-progress index request collides with its own idempotency key

`enqueueIndexRoot` searches only `queued`, `assigned`, and `accepted`
(`nasConnectorJobQueue.js:30`, `nasConnectorJobQueue.js:200-203`). The unique
idempotency key remains set while the scan is `in_progress`. A second admin
request misses the existing job, attempts an insert, receives duplicate key,
then fails to find the job with the same incomplete status list
(`nasConnectorJobQueue.js:231-232`).

Use one type-specific definition of active index states everywhere, including
`in_progress`. `MANUAL_INDEX_ACTIVE_STATUSES` already contains the correct set.

### P1.3 — The metadata fingerprint is not a reliable content identity

The Connector fingerprint is only `LastWriteTimeUtc.Ticks + length`. Copy tools
can preserve timestamps, applications can replace a file with another file of
the same size, and a path can change between metadata validation and opening.
Cache and thumbnail completion rely on this value to identify the source
version.

Keep the cheap metadata fingerprint for indexing, but do not describe or use it
as content verification. For stronger delivery correctness:

- open the source before final validation;
- verify length/timestamp before and after streaming;
- optionally compute SHA-256 during the existing stream, with no second read;
- store that digest as delivery evidence for future reuse.

### P1.4 — Full scans do not stale cache/thumbnail state on version change

Incremental watcher upserts explicitly set `availabilityStatus` and
`thumbnailStatus` to `stale` when the fingerprint changes
(`nasConnectorRoutes.js:1216-1224`). Full scan batch upserts replace the entry
metadata without performing the same transition
(`nasConnectorRoutes.js:1072-1086`).

The cache reuse helpers also compare fingerprints, so stale bytes are normally
not returned, but API status can incorrectly remain `online`/`ready` and the
two indexing paths behave differently. Move entry version transition logic
into one catalogue service used by both full batches and watcher changes.

### P1.5 — Search can return files belonging to disabled roots

Folder/list/detail routes verify that a root is active or offline. Global
search filters only `NasFileEntry.deletedAt` and optionally a caller-supplied
root (`nasCatalogueRoutes.js:870-884`). Without `rootId`, entries from a
disabled/revoked root remain in results.

For this small root count, first load IDs of browsable roots and add
`storageRootId: { $in: ids }` to the search query. This also makes access rules
easy to add later.

### P1.6 — Liveness has conflicting authorities and duplicated state

- Comments state REST heartbeat is authoritative, but WebSocket hello also sets
  connector status active and updates `lastSeenAt`
  (`nasConnectorControlChannel.js:519-521`).
- Stale status is reconciled only when an administrator lists connectors
  (`nasConnectorRoutes.js:396`, `nasConnectorRoutes.js:1760`).
- `NasStorageRoot.status` supports `offline`, but no normal stale-liveness path
  sets roots offline. Root and connector status can disagree indefinitely.

Choose one liveness source. The simplest current fix is:

- heartbeat alone updates `lastSeenAt`;
- WebSocket/long-poll presence is a separate `controlConnected` observation;
- derive root online/offline from its connector instead of storing duplicate
  root liveness;
- keep only the root administrative states `active` and `disabled`.

### P1.7 — Persistent data and package artifacts have no complete retention policy

- Thumbnail keys are versioned, but old thumbnail objects are never deleted.
  The thumbnail lifecycle rule only aborts incomplete uploads; it never expires
  completed obsolete thumbnails.
- Soft-deleted `NasFileEntry` rows, terminal `NasTransferJob` rows, and
  `NasAuditEvent` rows have no pruning/TTL policy.
- The installer intentionally retains every previous/failed package and does
  not clean a staging directory if failure occurs before the package swap
  (`Install-AdimariNasConnector.ps1:254-265`).

Define explicit retention:

- delete the prior thumbnail after a replacement commits and delete thumbnails
  when a source is retired, or apply a conservative thumbnail lifecycle;
- add `purgeAfter` TTL to terminal jobs;
- prune soft-deleted catalogue entries after a recovery window;
- retain audit events for a documented business period;
- keep the newest one or two successful Connector packages and expose an
  explicit `-KeepPreviousPackages` installer option;
- clean the exact per-run staging directory in installer failure handling.

### P1.8 — Test coverage is concentrated on protocol validation, not file work

The current Connector tests strongly cover IPC, strict WebSocket parsing,
credential recovery, and durable assignment receipt. They do not directly test
`CacheForDownloadJobWorker`, `ThumbnailJobWorker`,
`WriteUploadToNasJobWorker`, or `NasChangeTrackingWorker`. Backend tests cover
catalogue happy paths and queue delivery but do not exercise most connector
cache/upload/thumbnail start-complete failure sequences.

Add fault-injection tests before refactoring. The minimum matrix is listed in
the testing plan below.

## Priority 2: complexity, redundancy, and maintainability

### P2.1 — Remove the legacy enrollment-token system if no deployed client uses it

The active Connector uses one manually distributed shared key. The repository
still contains the older token/device-secret system:

- enrollment-token model and TTL/recovery workflow;
- issue, redeem, recovery, and re-enrollment routes;
- per-connector credential hashes and HMAC configuration;
- Connector pending-device-secret state and unused `EnrollAsync` client;
- extensive token-specific tests and documentation.

This is the largest low-risk deletion available, provided deployment inventory
confirms there is no older Connector. Remove it as one explicit compatibility
breaking change. With shared-key-only authentication, rename `DeviceSecret` and
`EnrollmentToken` fields to `SharedAccessKey` at the next local IPC/state schema
version.

The shared key should still be compared in constant time, stored with DPAPI on
Windows, excluded from logs, and sent only over the approved transport.

### P2.2 — Replace four polling executors with one job runner and modular handlers

`Program.cs:67-71` starts four job-type workers. Each polls the same one-item
JSON queue, reloads configuration and credentials, implements similar retry
logic, and calls a job-type-specific `StartNext...`/`Complete...` pair. The job
store repeats nearly identical state transitions at
`ConnectorJobStore.cs:198-435`.

Use one `ConnectorJobRunner`:

```text
ConnectorJobRunner
  -> claim one durable job
  -> resolve IConnectorJobHandler by job.Type
  -> run with per-job cancellation
  -> persist typed outcome
  -> acknowledge backend outcome
```

Keep handlers modular:

- `IndexRootHandler`
- `CacheFileHandler`
- `GenerateThumbnailHandler`
- `WriteUploadHandler`

The store then needs generic `ClaimAsync`, `UpdateStateAsync`, and
`CompleteAsync` operations rather than four copies. Adding or removing a job
type becomes a registration change, not another background loop.

### P2.3 — Split the two largest backend/client files by responsibility

Current concentration:

- `Backend/routes/nasConnectorRoutes.js`: 2,132 lines
- Connector `Backend/ConnectorAgentClient.cs`: 1,136 lines
- `Backend/routes/nasCatalogueRoutes.js`: 909 lines
- `Backend/control/nasConnectorControlChannel.js`: 889 lines
- `Backend/services/nasConnectorJobQueue.js`: 838 lines

Suggested backend modules:

```text
Backend/nas/
  config/
  auth/
  routes/adminRoutes.js
  routes/connectorControlRoutes.js
  routes/catalogueRoutes.js
  services/jobQueue.js
  services/indexService.js
  services/deliveryService.js
  services/uploadService.js
  services/storageFactory.js
  models/
```

Suggested Connector modules:

```text
Service/Backend/ConnectorApiClient.cs       # auth + common HTTP mechanics
Service/Backend/IndexApi.cs
Service/Backend/DeliveryApi.cs
Service/Jobs/ConnectorJobRunner.cs
Service/Jobs/IConnectorJobHandler.cs
Service/Jobs/Handlers/*
Service/Files/SafeNasPath.cs                # one path containment authority
Service/State/*
```

Do this by extracting behavior behind tests, not by rewriting all state
machines at once.

### P2.4 — Separate pure configuration parsing from live NAS probing

`ConnectorConfigurationValidator.Normalize` also calls `Directory.Exists`,
checks attributes, and opens a directory enumerator
(`ConnectorConfigurationValidator.cs:70-110`). The same method is called from
heartbeat, control connection, change tracking, enrollment, and every job.
Consequently, configuration validation repeatedly performs NAS I/O, and a
transient NAS outage makes otherwise valid backend/control configuration look
invalid.

Split it into:

- `NormalizeConfiguration`: pure syntax/canonicalization;
- `ProbeRootAccess`: explicit live read/write capability test;
- `SafeNasPath`: containment/reparse checks at the exact file operation.

Probe during setup, at worker start, and on a slower health interval—not every
heartbeat/control attempt. Continue checking containment and reparse points for
every actual NAS operation.

### P2.5 — Consider HTTPS long polling instead of the custom WSS protocol

For at most ten trusted employees and one serial job per Connector, WebSocket
delivery creates disproportionate machinery on both sides: upgrade security,
subprotocol negotiation, exact envelope schemas, hello/ack, application pings,
message-ID sets, session replacement, rate limits, in-memory target maps,
correlation maps, and lease timers.

A simpler outbound-only control loop is:

```text
Connector -> POST /control/poll (presence + queue state, waits up to 25 s)
Backend   -> returns no job or one leased opaque job
Connector -> persists locally
Connector -> POST /control/jobs/:id/ack
Connector -> existing start/complete/fail APIs
```

MongoDB remains authoritative and the lease remains replay-safe. No inbound NAS
port is introduced. This can also merge heartbeat and control presence into one
request. It removes the custom WSS/Nginx upgrade path and most process-local
session state. If WSS is retained, at least replace hand-written repeated
validation with typed DTO serializers and keep only size bounds, authentication,
versioning, and required identifiers.

### P2.6 — Centralize storage client construction

Cache, thumbnail, and staging `FileStorageService` instances are independently
constructed in both connector routes and catalogue routes. Build the three
clients once at server composition time and inject a `NasStorageSet`. This
removes duplicated configuration merging and makes S3 behavior easier to test.

### P2.7 — Remove stale phase comments and correct operator/audit labels

Several comments still say “Phase 2,” “initial index-root-only slice,” “later
executor,” or “two assignments” although all four job types exist. The
Connector control-channel session also records every incoming job as **Index
root**, even when it is a cache, thumbnail, or upload assignment.

Heartbeat success is added to the 50-item recent activity list every interval,
which can erase meaningful transfer history in roughly 25 minutes at a
30-second heartbeat. Keep current connection state separately and record only
heartbeat transitions/failures.

The upload failure route records audit action `upload_completed` with failure
even though the audit schema defines `upload_failed`
(`nasConnectorRoutes.js:1549`). Several defined audit actions are never emitted.
Either implement a small consistent audit service or reduce the enum to events
that are actually part of the product.

### P2.8 — Improve Windows destination-name validation

Generic browser file-name validation permits characters/reserved names that
S3 accepts but Windows does not, such as `CON`, trailing dots/spaces, or `:`.
The Connector fails these late as `destination_unavailable`. Add a Windows NAS
destination validator to the upload API for clearer feedback, then keep the
Connector check authoritative because backend validation is not a filesystem
safety boundary.

### P2.9 — Installer success and cleanup are incomplete

The installer considers the update healthy once SCM reports `Running`. A
service can enter Running and fail immediately afterward. Add a bounded local
health check: stable Running state plus readable local Control Center status,
and optionally wait for a successful backend heartbeat when connectivity is
expected. Keep automatic rollback limited to the package installed by that run.

Also clean the exact generated staging directory on failure and implement a
bounded backup retention option as described in P1.7.

## Security checks: keep, simplify, or make optional

| Check/mechanism | Recommendation | Reason |
| --- | --- | --- |
| Relative-path containment and rejection of `..`/absolute paths | **Keep** | Prevents reading/writing outside the configured root. |
| Reparse-point checks at root and child directories | **Keep** | Prevents a local link from escaping the allowed root. |
| Atomic no-overwrite destination move | **Keep** | Direct protection against NAS data loss. |
| DPAPI credential storage and restrictive local ACLs | **Keep** | Low operational cost and protects the long-lived key at rest. |
| TLS certificate validation | **Keep** for normal deployment | Protects the global shared key and signed URLs. |
| Private prefixes and short-lived presigned URLs | **Keep** | Maintains the backend/NAS trust boundary without AWS keys on the Connector. |
| Bounded IPC/network message size | **Keep** | Simple memory-safety limit. |
| Legacy enrollment tokens/per-device secret recovery | **Remove after inventory** | Not used by the current Connector and creates substantial parallel auth logic. |
| Repeated live root enumeration during normal configuration validation | **Remove** | It is a health probe, not syntax validation. |
| Custom WSS exact-envelope/ping/correlation machinery | **Replace with long polling**, or simplify | High complexity for very low job volume. |
| Pipe server PID/SCM identity verification | **Keep by default** | It prevents a non-admin operator from giving the shared key to a squatting local pipe. Remove only if Control Center access is restricted to trusted local Administrators. |
| Optional non-admin Connector Operators group | **Policy choice** | Keep for least privilege; remove both the group and its branching logic if every operator is already a trusted local Administrator. |

## Recommended target design

For this deployment size, the maintainable target is four independently
testable components:

```text
Browser/API
    |
    v
NAS application service
  - catalogue queries
  - upload/share orchestration
  - one durable Mongo job state machine
    ^
    | authenticated HTTPS long poll + start/outcome reports
    v
Connector control loop
  - one local durable job runner
  - modular job handlers
  - one safe NAS path service
    |
    +--> NAS (canonical files)
    +--> private S3 prefixes (temporary delivery/staging/thumbnails)
```

State transitions should be shared conceptually across all job types:

```text
staging? -> queued -> leased -> accepted -> running
                                      |-> succeeded
                                      |-> permanent_failure
                                      |-> cancelled
                                      `-> retryable (with nextAttemptAt)
```

Use one name for each state on both sides. Avoid the current mixture of
`assigned`, `accepted`, `in_progress`, local `Queued`/`Executing`, and implicit
“awaiting acknowledgement” states.

## Refactor sequence

### Phase 1 — Correctness without architectural change

1. Make connected root paths immutable; add an explicit root replacement
   design.
2. Remove same-size upload acceptance and reserve active upload destinations.
3. Add durable `moved_awaiting_server_ack` and terminal-failure acknowledgement.
4. Make Clear cancel actual execution or restrict it to safely cancellable
   states.
5. Make cache completion replayable/transactional.
6. Add permanent failure paths and an `in_progress` watchdog.
7. Fix active index status, disabled-root search, full-scan stale state, and
   incorrect audit action.

### Phase 2 — Add recovery tests

Add tests for the failure matrix below before moving files or changing the
transport. These tests become the safety net for simplification.

### Phase 3 — Delete known redundancy

1. Confirm no legacy Connector is deployed.
2. Remove enrollment-token/device-secret compatibility end to end.
3. Remove stale phase comments/types/tests.
4. Centralize storage creation and pure configuration normalization.

### Phase 4 — Modularize execution

1. Introduce one Connector job runner and handler interface.
2. Convert one job type at a time, starting with thumbnails, then cache,
   upload, and index.
3. Split backend execution routes into indexing, delivery, and upload services.
4. Split the Connector HTTP client into common transport plus domain clients.

### Phase 5 — Simplify transport

Prototype authenticated HTTPS long polling behind the existing queue tests.
Run both transports briefly only if deployment requires a gradual migration;
otherwise use one coordinated backend/Connector release and delete WSS code
immediately afterward.

## Implementation progress (2026-08-13)

- **Phase 1:** completed. Root replacement, upload destination reservation,
  durable upload acknowledgement states, safer clearing, replayable cache
  completion, watchdog recovery, and the related catalogue fixes are in place.
- **Phase 2:** completed with regression coverage for the repaired queue and
  delivery paths.
- **Phase 3:** storage construction/configuration normalization is complete.
  Legacy enrollment-token removal remains intentionally deferred until the
  deployment inventory confirms no old Connector installation needs it.
- **Phase 4:** completed. A single Connector job runner dispatches durable
  jobs to type-specific handlers, and HTTPS delivery is isolated in its own
  Connector client instead of the general agent client.
- **Phase 5:** completed as one coordinated release. Authenticated HTTPS long
  polling and exact durable acknowledgements are the sole delivery transport;
  the backend and Windows Connector WSS code, tests, Nginx upgrade rules,
  configuration, and UI wording have been removed.

### Phase 6 — Retention and operations

Add thumbnail cleanup, terminal job/catalogue retention, installer cleanup,
and a small recovery dashboard/action for genuinely stuck jobs.

- **Phase 6:** completed. The backend schedules bounded terminal-job and
  audit retention, removes retired catalogue thumbnails conservatively, and
  deletes a replaced thumbnail object after a successful update. The admin
  console now lists only genuinely stale active jobs and offers a stop-only,
  audited recovery action with no automatic NAS replay. The installer removes
  its exact failed staging directory, retains one or two previous successful
  packages, prunes only older known backups after a stable startup check, and
  leaves failed packages available for inspection.

## Required failure-injection tests

1. Change a connected root while an old job and old catalogue entries exist.
2. Start two same-name, same-size, different-content uploads concurrently.
3. Crash/restart after the NAS move but before backend upload completion.
4. Lose the network while reporting a permanent upload failure.
5. Clear each job type while queued, downloading, uploading, generating, and
   immediately before its final commit.
6. Feed a corrupt and an over-limit image to the thumbnail worker.
7. Fail each Mongo write in cache completion, then replay the same completion.
8. Request a scan while the existing scan is `in_progress`.
9. Deliver watcher create/change/delete events during full scan completion.
10. Search without a root filter after disabling one root.
11. Restart Connector and backend independently in every local/remote job-state
    combination (`accepted`, `running`, success awaiting ack, failure awaiting
    ack).
12. Leave an incomplete installer copy and verify the next run detects or
    removes only its own stale staging package.

## Final assessment

The current system is not fundamentally misdesigned; its strongest boundaries
are worth preserving. The risk comes from implementing reliability separately
for each phase and transport until multiple overlapping state machines emerged.
Correctness should be repaired before broad file reorganization. After that,
removing legacy enrollment, unifying job execution, and replacing WSS with one
HTTPS control loop can substantially reduce the code while making future job
types easier—not harder—to add or remove.
