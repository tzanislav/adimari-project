# NAS Connector File Access — Execution Plan

## Objective

Deliver a secure, browser-based file area backed by folders on the local NAS. Authorized users can browse folders, create download-only share links, request a file for viewing or download, and upload a file into the selected NAS folder.

## Delivery principle

This is an internal file-delivery system for no more than ten trusted company
employees. Keep normal safeguards around credentials, authorization, safe NAS
paths, TLS, and accidental data loss, but prefer simple, modular components
over enterprise-scale infrastructure or security machinery that does not
materially help this small trusted deployment.

The NAS remains the canonical copy. A locally installed connector is the only component allowed to read from or write to it. It creates **outbound-only** connections to the web backend; that connection is nevertheless bidirectional at the application level, so the backend can send authenticated jobs to the connector without exposing the NAS to inbound internet traffic.

## Implementation status

- **Phase 1:** backend configuration validation, NAS metadata schemas, isolated S3-prefix configuration, and the 10-day cache/thumbnail retention design are in place. Applying the actual S3 lifecycle/IAM policy remains a deployment task.
- **Phase 2A:** complete. The separate Windows Service/WPF solution supports ACL-protected local setup, root and HTTPS checks, a manually distributed shared connector key held in DPAPI-protected service storage, authenticated HTTPS heartbeats, and an administrator-only web management page. The legacy token schemas remain only for compatibility and are no longer used operationally.
- **Phase 2B:** complete. The service and backend maintain a secure persistent, outbound WSS **presence** channel with strict `hello`/ack/ping/pong protocol, credential-rotation session invalidation, and redacted Control Center status. That subphase carried no file or job commands.
- **Phase 2C:** complete. The backend can queue one administrator-requested `index_root` delivery per logical root; the service validates and durably records it before acknowledging over WSS. It intentionally does not read, scan, or transfer NAS files yet.
- **Phase 3A:** complete. The service executes an accepted `index_root` request against the same locally captured root, skips reparse points, and reports bounded relative-metadata batches to the backend. The backend upserts the catalogue and marks entries absent from a completed scan unavailable.
- **Phase 3B/3C:** complete for initial browsing and automatic catalogue updates. Moderator/admin users can list active/offline NAS roots, browse paginated folder metadata, navigate breadcrumbs, and search an indexed root through the read-only NAS Files page. The connector batches FileSystemWatcher create/change/delete updates to the backend, and the browser quietly refreshes the visible folder. A full reconciliation is requested after a watcher overflow or directory move and every 12 hours. It intentionally does not expose native NAS paths or offer destructive file-manager actions.
- **Phase 4:** cache delivery, direct-file actions, image viewing, and persistent thumbnails are complete. A moderator/admin can create a share from NAS Files or choose **Open**/**Download**. Each request either reuses the same indexed, version-matching temporary cache object or queues one serial `cache_for_download` job. Previewable folder entries lazily queue a serial `generate_thumbnail` job. The Windows connector creates a maximum-320-pixel JPEG at quality 78, uploads it to the persistent `nas-thumbnails/` prefix, and the browser displays it in the folder. The lightbox starts with that thumbnail enlarged while it prepares/loads the full image, then replaces it with the real image and indicates its state. Cache lifecycle remains 10 days through the configured S3 rule.
- **Phase 5:** complete. A moderator/admin selects one file with **Upload here** in the current folder. The browser uses short-lived multipart URLs to write into the NAS upload-staging prefix; the backend queues a write-upload job; the Windows service downloads to a temporary sibling file, verifies its byte length, and atomically moves it into the selected NAS folder without overwriting an existing file. The browser shows upload, queue, connector-write, completion, and failure states. The initial live end-to-end upload test passed. Per-folder ACLs, checksum verification, malware scanning, automatic retry, and a completed-entry link are intentionally deferred from this small-company first release.
- **Phase 6:** complete for this initial release. The backend now binds to loopback only, keeping Nginx as the sole production ingress; the runbook contains a short release/recovery checklist; and the existing Control Center plus NAS Connectors page provide the appropriate monitoring for this small deployment. External monitoring, clustering, and high-availability automation are deliberately deferred.

## First-release scope

In scope:

- Browse configured NAS roots, folders, and file metadata.
- Search and paginate the indexed metadata.
- Reuse the existing File Server browsing and share-page experience for NAS entries. Creating a share link starts preparation of that NAS file in the background.
- Request a file for view/download; cache the requested version in private object storage when needed.
- Open previewable images in a full-screen lightbox with on-demand thumbnails, previous/next navigation within the same folder, and an explicit download action.
- Upload a browser-selected file into the currently selected NAS folder.
- Provide a simple local Windows Control Center for connector setup, connection health, configured roots, and active job monitoring.
- Per-user access control, audit events, job status, retry, and clear offline/error states.

Out of scope:

- Rename, move, delete, create-folder, direct file editing, and folder synchronization.
- Making object storage a second authoritative source. It is a delivery cache only in this release.

## Target architecture

```text
Browser
  | browse / authorize / create request or upload job
  v
Existing web app + API + metadata/job database
  ^                              |
  | job status / result           | persistent outbound HTTPS/WSS,
  |                              | initiated by the service
  |                              v
Local Windows NAS connector service (C#/.NET Worker Service) ----> configured NAS root folders
  ^                              |
  | authenticated local           | private object-storage upload/download
  | named-pipe IPC                v
Windows Control Center         Private S3-compatible bucket
(C#/WPF, interactive user)     (delivery cache + browser upload staging)
```

## Local connector Control Center

The connector product has two Windows executables in one Visual Studio solution:

- `Adimari.NasConnector.Service`: a headless Worker Service running continuously as a Windows Service. It owns NAS access, the durable local queue, connector credential, outbound WebSocket connection, and all transfer work.
- `Adimari.NasConnector.ControlCenter`: a small WPF desktop application, launched by an authorized local user. It is an administration and monitoring UI; it does not itself connect to the web backend or access the NAS as a substitute for the service.

A Windows Service must not attempt to show an interactive desktop window. The Control Center instead communicates with the service over a local named pipe protected by Windows ACLs. The service remains operational when no user is logged in and when the Control Center is closed.

### Initial Control Center screens

| Area | Required capability |
| --- | --- |
| Status | Connector name/ID, service state, backend connection state, last successful heartbeat, current software version, queue length, active job, progress, and latest redacted error. |
| Setup | Select the allowed NAS root with a folder picker; set its display name and whether browser uploads are enabled; set the HTTPS backend base URL; test connectivity; enter the shared connector access key and connect the connector. |
| Roots | Show configured roots, connector-side access test result, last scan, and indexing health. The initial UI may configure one root, but the service data model supports more than one. |
| Activity | Show recent scans, cache transfers, thumbnail jobs, and browser-to-NAS writes with queued/running/completed/failed state and accurate byte progress where available. |
| Diagnostics | Copy redacted logs and start a safe re-scan or reconnect action. No raw credentials, signed URLs, or full NAS paths appear in copied diagnostics. |

### Local configuration and security rules

- The normal target server is an `https://` backend origin with a valid certificate. For a deliberately private/local deployment, the backend operator may set `NAS_CONNECTOR_ALLOW_HTTP=true`; the Control Center can then use an `http://` origin and derives `ws://` for its control channel. This disables transport encryption, so never expose that endpoint beyond the trusted local network. The Control Center never disables TLS validation when HTTPS is used.
- The Control Center sends configuration commands to the service through its local named pipe. It never opens an inbound network listener and never contacts S3 or the production backend directly.
- The pipe uses a bounded, length-prefixed, versioned request/response protocol with correlation IDs and timeouts. It is created with an explicit Windows `PipeSecurity` ACL; do **not** use `PipeOptions.CurrentUserOnly`, because it would prevent an authorized WPF user from connecting to a service running under another Windows identity. The service explicitly rejects non-local pipe clients. Before the Control Center sends the shared connector key, it verifies the pipe server PID against the running `AdimariNasConnector` SCM service; a Debug build accepts only the exact local Debug service executable as an F5-development fallback.
- The service stores non-secret configuration in its service-owned `C:\ProgramData\Adimari\NasConnector` directory with restrictive ACLs. Its shared connector access key is encrypted using Windows-protected storage; the UI receives only redacted status.
- Only local Administrators or an explicitly configured `Adimari NAS Connector Operators` Windows group may change backend settings, connect/disable a connector, or add/change a root. Read-only monitoring can be granted separately later.
- After selecting a root, the service canonicalizes it, rejects traversal/reparse-point escape, and tests access using the **service account**. For SMB shares, use a UNC path such as `\\nas\projects`, never a mapped drive such as `Z:\projects`.
- The backend receives a root ID and relative paths only. It never receives the root's Windows/UNC path.

### Core data rules

- The backend stores the **file catalogue and permissions**, not file contents.
- Each file record has a stable ID, connector ID, relative path, name, size, modified timestamp, optional hash/version, availability status, and last indexed time.
- `online` means an object-storage copy exists for the same verified NAS version; `stale` means the NAS version changed; `offline` means the connector cannot currently serve it.
- Browser uploads land in a restricted temporary object-storage prefix first. Only the connector writes them into the NAS after verification.
- The backend sends folder IDs and job IDs to the connector, never a browser-provided absolute filesystem path.
- A queued job is bound to the connector's opaque logical root ID, never to a
  native path. Before any future executor acts on a queued job, a root-path
  change must pause/invalidate that work and re-register the root identity; an
  old job must never silently run against a newly selected NAS folder.
- Image file records also store verified content type, preview eligibility, dimensions when available, and thumbnail state, source version, object key, and last-updated time. Thumbnail objects live under the dedicated `nas-thumbnails/` prefix and remain available while their source image exists; they are not part of the 10-day full-file delivery cache.

## Opening and image-preview behaviour

A web browser cannot silently launch an arbitrary program installed on a user's device. The application can open a short-lived URL with `Content-Disposition: inline`; the browser then decides whether to render it itself or hand it to the user's configured viewer. Files the browser cannot open inline use an explicit download response, after which the user/operating system chooses the application.

| File category | Primary action |
| --- | --- |
| Safe previewable image (initially JPEG, PNG, WebP, GIF, and AVIF) | Open the custom lightbox. Rendering fetches bytes into browser memory; it does not trigger a file-save dialog. |
| PDF and other browser-inline types | Open a short-lived inline URL in a new tab. A PDF normally opens in the browser's PDF viewer or user-configured handler. |
| Other files, including unsupported image types | Download with attachment disposition. The user may then open it in their local program. |

- Do not preview SVG, HTML, or other active/untrusted formats in the initial release. Treat them as downloads.
- A lightbox is full screen, is keyboard accessible, closes with Escape, and has a small accessible download icon at the top. Its full-width bottom bar contains Previous, an image position such as `3 / 12`, and Next.
- Previous and Next are limited to previewable-image siblings in the current folder, ordered by normalized filename. They must never disclose or traverse into another folder, root, or unauthorized entry. Disabled controls clearly indicate there is no sibling in that direction.
- Selecting a sibling may create its own cache job. The UI must show a truthful preparation state such as `Preparing 27%` when connector byte progress is known. When fetching an already-ready image, it may show `Loading 27%` only when the browser can read a response `Content-Length`; otherwise it shows `Loading…` without inventing a percentage.
- Folder listings lazy-load thumbnail URLs only for visible image cards. Existing cloud thumbnails render immediately even when the NAS connector is offline. A missing or stale thumbnail creates a high-priority low-resolution image job; the connector first uses a configured matching thumbnail from an existing NAS thumbnail repository when available, otherwise creates one from the source image locally. It uploads the result to `nas-thumbnails/`, and the UI shows a placeholder until ready. Corrupt or unsupported images retain a generic file/image icon.
- The public share page remains a single-file download page in the first release. It may report that an image share is preparing, but it does not expose folder thumbnails or sibling navigation.

## Safety decisions to make before implementation

Complete these decisions in Phase 0; do not implement write operations before they are recorded.

| Decision | Initial recommendation |
| --- | --- |
| Connector host | A reliable Windows machine with stable NAS access, installed as a service under a least-privilege account. |
| Connector platform | Windows only; C#/.NET compiled Worker Service, installed as a Windows Service. Develop and publish from a separate Visual Studio solution. |
| Connector administration | A companion C#/WPF Control Center uses authenticated local named-pipe IPC to configure and monitor the headless Windows Service. |
| NAS roots | Explicit allow-listed roots only; connector uses read/write permissions only where uploads are enabled. |
| Access model | Reuse the web app's existing authentication; add folder/root-level read and write permissions. |
| Upload collision | Reject by default and ask the user to rename or explicitly replace; never silently overwrite. |
| Object storage | Reuse the existing private File Server bucket, with separate prefixes and IAM policies for full-file cache, staging data, and persistent thumbnails. |
| Full-file cache lifetime | Full-file delivery objects, including share delivery copies, expire 10 days after upload through S3 lifecycle rules. Object deletion is asynchronous, so it occurs at or shortly after that point. |
| Share behaviour | Creating a NAS share returns the usual branded File Server link immediately and queues cache preparation when no matching cache exists. The share page displays “preparing” until the matching NAS version is available. Authenticated **Open** and **Download** use the same cache and poll automatically. An expired link is shown as unavailable in the initial slice; refresh/requeue is the next Phase 4 increment. |
| Viewable types | Use browser inline handling for PDFs and similar safe types; use a custom lightbox for safe previewable images only. |
| Image thumbnails | Store small generated JPEG derivatives in `nas-thumbnails/` while their source image exists. The Windows connector generates them lazily at the configured 320 px maximum/quality 78. The folder displays them immediately when ready; the image lightbox enlarges the thumbnail while the full image is prepared and loading. A new source fingerprint never reuses the old thumbnail. |
| Large files | Direct browser-to-storage and connector-to-storage multipart/resumable transfers; never proxy bytes through the web API. |

## Delivery phases

Each phase is an independently reviewable AI-agent task. Do not start a later phase until the prior phase's acceptance criteria pass. Preserve existing unrelated changes and make small, focused commits where the project workflow permits.

### Phase 0 — Discovery and design lock

1. Inspect the current frontend, backend, authentication, database, deployment, and existing File Server S3 configuration.
2. Identify the existing user/role model and document the exact roles allowed to browse and upload.
3. Confirm connector operating system, NAS protocol/path, available upload bandwidth, expected total file count, largest normal file, and acceptable first-download delay.
4. Reuse the existing File Server S3 bucket. Confirm its region, encryption, backend deployment identity, and these isolated prefixes: `nas-cache/`, `nas-upload-staging/`, `nas-thumbnails/`, and (only if needed) `nas-job-artifacts/`. Do not overlap the existing `files/` prefix. Configure a 10-day expiry lifecycle rule for `nas-cache/` only; do not apply it to `nas-thumbnails/`.
5. Record the safety decisions above plus retention, overwrite, filename, and audit-log policies in the project documentation.
6. Produce an API/schema design before writing implementation code.

Acceptance criteria: architecture decisions are documented; the exact NAS roots and permitted roles are approved; no secrets, NAS passwords, or long-lived cloud credentials enter source control.

### Phase 1 — Cloud and backend foundations

1. Extend the existing private File Server bucket configuration with public access blocked, encryption at rest, CORS limited to known frontend origins, and lifecycle cleanup for NAS temporary uploads, incomplete multipart uploads, and `nas-cache/` objects 10 days after upload. Exclude `nas-thumbnails/` from that rule; remove a thumbnail explicitly when its source is deleted or superseded. Keep NAS lifecycle rules restricted to NAS prefixes. For browser image-progress reporting, allow `GET` and `HEAD` from the frontend and expose `Content-Length`, `Content-Type`, and `ETag` in S3 CORS.
2. Give the web backend and connector separate least-privilege identities. Limit NAS access to `nas-cache/*`, `nas-upload-staging/*`, `nas-thumbnails/*`, and approved artifact prefixes; keep existing File Server access to `files/*`. The browser receives only short-lived scoped upload/download URLs.
3. Add database models/migrations for `connector`, `storageRoot`, `fileEntry`, `transferJob`, and `fileAuditEvent`, including image-preview/thumbnail state and byte-level transfer progress.
4. Add backend configuration validation for bucket, region, allowed origins, cache retention, maximum upload size, and connector authentication settings.
5. Create validation helpers for relative paths, filenames, content types, IDs, pagination, object keys, and job state transitions.
6. Add structured logging and secret redaction rules.

Acceptance criteria: the bucket cannot be listed or read publicly; the backend can create scoped URLs; invalid paths and unauthorized calls are rejected by automated tests.

### Phase 2 — Connector foundation and secure channel

1. Create a separate Visual Studio solution with `Adimari.NasConnector.Service` (C#/.NET Windows Worker Service), `Adimari.NasConnector.ControlCenter` (C#/WPF desktop UI), and a small shared contracts project for local IPC messages. Publish the service as a compiled Windows executable which runs automatically as a Windows Service, restarts safely, and uses service-owned machine-level configuration.
2. Implement a local named-pipe IPC server in the service and an authenticated WPF Control Center client. Use a bounded, length-prefixed, versioned request/response protocol with correlation IDs, timeouts, and idempotent configuration commands. Create the pipe with an explicit ACL (never `PipeOptions.CurrentUserOnly`), reject remote/session-untrusted clients, and enforce that only Administrators or the configured operator group can change settings. Expose redacted status and activity to authorized users; do not expose credentials, signed URLs, or raw filesystem paths.
3. Implement Control Center setup/monitoring: backend HTTPS URL, root-folder picker, upload-enabled toggle, service-account access test, shared connector-key connection, connection test, health view, queue/activity list, reconnect, and safe re-scan.
4. Implement connector connection: the server and service share a single environment-managed 32-byte key. The operator enters it through the Control Center; the service stores it using the OS secret store and identifies itself with its stable installation ID. The backend creates or reuses that installation's connector/root record. The Control Center displays connection status but never reads the stored key after setup. Legacy token schemas/endpoints may remain temporarily for migration compatibility but are not part of the operational flow.
5. Phase 2A: establish an authenticated outbound HTTPS heartbeat owned by the service, with server-supplied interval, retry/backoff, connector version reporting, and explicit offline status. Phase 2B: add the persistent outbound TLS WebSocket **presence** channel beside that heartbeat. It is limited to authenticated hello/ack/ping/pong; REST remains authoritative for credentials and the Control Center observes both only through local IPC.
6. Phase 2C: implement a durable local job queue/state store and safe, idempotent WSS delivery. The initial `index_root` job is bound to the logical root only, has no payload, and stops after durable receipt; an interrupted connector can reconnect and acknowledge it without duplicate local work.
7. Add an allow-listed root resolver which converts a backend root/folder ID to a canonical NAS path and rejects traversal, symlinks/reparse points that leave the root, and inaccessible paths.
8. Run the service under a dedicated least-privilege account; grant only the approved NAS permissions.

Acceptance criteria: an authorized operator can configure the HTTPS backend and an allowed root through the Control Center, receives a service-account access result, sees connection/job health without seeing secrets, and cannot configure the service outside the local authorization rules. The connector connects with the shared key, reuses its stable record after a backend/network restart, cannot connect after being disabled, and cannot resolve a job outside its assigned root.

### Phase 3 — NAS indexing and browse API

1. Build an initial recursive scan that emits folders and files in bounded batches, including normalized relative paths, file type, size, modified time, and a version fingerprint. For files, identify safe content type and preview eligibility; record image dimensions when inexpensive and safe to read. Queue a thumbnail backfill for images without a current cloud thumbnail, prioritizing folders users open.
2. Use filesystem change notifications for prompt updates, but add scheduled reconciliation scans and an overflow/error-triggered rescan; notifications alone are not a reliable catalogue source. **Implemented:** the service coalesces FileSystemWatcher events into bounded authenticated relative-metadata batches. A folder rename or watcher overflow requests the existing durable full scan, and a 12-hour reconciliation covers missed notifications.
3. Update metadata atomically and mark disappeared entries deleted/unavailable without deleting cached object-storage data automatically.
4. Add backend APIs for paginated folder listings, breadcrumb navigation, file detail, and server-side search, all permission-filtered.
5. Adapt and reuse the existing File Server frontend rather than building a parallel browser: retain its folder/file presentation and Share dialog, replace its S3-listing adapter with the NAS catalogue API, and do not expose native NAS paths in the UI or API. Use image cards/list rows with lazy thumbnail placeholders and a non-image file presentation for all other entries.
6. Record connector scan health: last successful full scan, last event processed, count of inaccessible items, and index lag. **Initial implementation:** the Control Center activity list shows watcher startup, batch delivery, retry, and reconciliation-request messages; richer persistent lag counters remain later work.

Acceptance criteria: a test root containing nested folders, additions, modifications, renames, and deletions appears correctly; a missed watcher event is repaired by reconciliation; unauthorized users cannot infer filenames.

### Phase 4 — Open, share, image preview, and on-demand cache

1. Add `prepareOpen`, `prepareDownload`, and `prepareShare` requests that authorize access and resolve a file entry/version. **Implemented:** authenticated Open/Download and Share requests reuse a current versioned cache object when available, otherwise create a cache job; Open returns a short-lived inline URL and Download returns attachment disposition. A share returns the usual opaque File Server link immediately.
2. Connector processes cache jobs by opening the exact allowed NAS file, verifying it is stable/version-matching, and uploading it to a private cache key using resumable multipart upload and checksums. It reports stage, transferred bytes, total bytes, and timestamp so the UI can calculate accurate preparation progress.
3. Backend marks the object `online` only after object-storage and checksum verification succeeds; otherwise preserve a failed/retryable job state and useful error message.
4. Extend the existing File Server share record/page with a NAS-source reference, delivery state (`preparing`, `ready`, `expired`, or `failed`), and cache expiry timestamp. The public page polls while preparing and, once ready, issues a short-lived URL with safe attachment disposition.
5. Add an authorized sibling-image endpoint that returns only the nearest previous/next previewable image in the current folder after permission filtering. Add thumbnail preparation/status endpoints that return only scoped thumbnail URLs. **Implemented:** folder requests are lazy and return a short-lived scoped URL only for a current thumbnail.
6. Connector handles `generate_thumbnail` jobs by first checking an optional configured NAS thumbnail repository with a deterministic source-to-thumbnail mapping; if no matching thumbnail exists, it opens the exact stable source image, enforces input/decompression bounds, and creates a maximum-320-pixel thumbnail. It uploads the result to an opaque versioned key under `nas-thumbnails/`. Mark a thumbnail ready only after matching source version and object verification. **Implemented initial generator:** Windows GDI+ produces a JPEG at quality 78, rejects images over 100 million pixels, and verifies the uploaded result/version before marking it ready. An external NAS thumbnail repository remains deferred.
7. Implement the authenticated full-screen image lightbox: streamed fetch/Blob rendering for real loading progress when available, top download icon, bottom full-width previous/position/next bar, keyboard/focus handling, and sibling navigation. **Implemented without thumbnails:** the lightbox uses the same on-demand cache object, has explicit download, and only queries adjacent previewable images in the same folder. Folder thumbnails remain the next increment.
8. On a NAS change event or reconciliation difference, mark prior full-file and thumbnail versions `stale`; a subsequent open/download/thumbnail request refreshes it rather than serving old content. After a successful replacement, delete the superseded thumbnail object through a recoverable cleanup job.
9. Add lifecycle and cleanup logic for full-file cache versions and abandoned job artifacts. Configure S3 to expire full-file objects under `nas-cache/` after 10 days, and update metadata to `expired` when an object is absent or its expiry is reached. Retain only the metadata/share link so an active link can requeue a fresh delivery copy. Keep thumbnails under `nas-thumbnails/` until their source image is deleted or replaced.

Acceptance criteria: creating a share of an uncached NAS file returns the usual File Server share URL and reaches `ready` when background preparation completes; PDFs open through the browser's inline handling when supported; a previewable image opens in the lightbox without forcing a download; existing thumbnails remain available independently of the NAS connector and missing thumbnails backfill on demand; accurate progress appears when known; previous/next never crosses the current folder; full-file cache objects expire after 10 days; a changed NAS file is never represented as a current cached version; large interrupted transfers resume or fail safely.

### Phase 5 — Browser-to-NAS upload

**Initial release status (August 2026):** implemented and verified in a live
end-to-end test. It supports one file at a time, multipart browser staging,
progress indication, cancellation before staging completes, connector polling,
byte-size verification, an atomic no-overwrite NAS move, and an automatic
visible-folder refresh. The browser never receives an S3 key or native NAS
path. Resumable retries, checksums, malware scanning, per-folder write ACLs,
and a direct completed-entry link remain later refinements.

1. Add an authorized `startUpload` endpoint which validates the selected destination folder ID and filename, applies folder-level write permissions, detects collisions, and creates a restricted temporary object key and transfer job.
2. Browser uploads directly to the temporary key using short-lived multipart signed URLs, with progress, retry, cancellation, file-size/type validation, and checksum metadata.
3. Backend validates upload completion and notifies the connector through the existing outbound connection.
4. Connector downloads the staged object to a per-job staging directory under the intended root, validates expected size and checksum, scans it for malware if an approved scanner is available, then atomically moves it into the approved destination.
5. Connector checks the destination once more before the final move. Apply the approved collision policy and never overwrite a newly created same-name NAS file by accident.
6. Connector reindexes the destination and reports `completed`, `conflict`, or a clear recoverable failure. Backend removes staged objects after success and expires them automatically after failure/cancellation.
7. Add UI states: queued, browser uploading, awaiting connector, writing to NAS, complete, conflict, and failed. Include a direct link to the completed entry.

Acceptance criteria: an allowed user can upload into an allowed folder; unauthorized path/role attempts fail; no partial file is visible in the destination; collision and NAS-offline cases preserve data and display an actionable outcome.

### Phase 6 — Hardening, operations, and release

**Completion status (August 2026):** complete for the small, trusted-company
deployment. This phase deliberately avoids enterprise monitoring, clustering,
and a separate staging environment. The existing Connector Control Center and
NAS Connectors administration page are the day-to-day operational view.

1. Keep the deployment boundary simple: Node binds to loopback only and Nginx
   is the sole network-facing application component. Only HTTPS TCP 443 (and
   optional TCP 80 for certificate renewal) is allowed through the host and
   cloud firewall. The Node port, SMB, MongoDB, and S3 remain private.
2. Keep the existing unit/build checks as the release gate: backend tests,
   frontend production build, and connector Release build/tests. Run the
   manual acceptance path below against a small non-critical NAS folder before
   updating the real connector.
3. Use the existing visible status: the Control Center shows service,
   heartbeat, control-channel, queue, and activity state; NAS Connectors shows
   active/offline status and scan state. Treat a stale heartbeat, failed job,
   or repeated activity error as an operator action item rather than adding an
   external alerting product at this scale.
4. Use the deployment runbook for installation, upgrade, connector disable,
   rollback, and S3 lifecycle setup. Do not edit queued jobs directly in
   MongoDB; cancel/retry from the application controls or requeue through the
   supported connector flow.
5. Before release, confirm browse/search, cached and uncached open/download,
   image thumbnail/lightbox, a NAS create/update/delete, and one browser-to-NAS
   upload. Confirm that a connector restart recovers its heartbeat and control
   channel.

Deferred until the user base or risk justifies it: per-folder ACLs, checksums,
malware scanning, broad automated browser E2E coverage, external monitoring,
multi-node deployment, and high-availability/disaster-recovery automation.

Acceptance criteria: all project tests/builds pass; the Node process listens
only on loopback; Nginx is the only application ingress; the concise manual
acceptance path passes; and the deployment runbook is available to the
operator.

## Suggested job state machines

### Download/cache job

```text
queued -> assigned -> readingNas -> uploadingCache -> verifying -> ready
                 \-> retryableFailure | failed | cancelled
```

### Browser-to-NAS upload job

```text
created -> browserUploading -> awaitingConnector -> stagingOnNas
        -> verifying -> movingIntoDestination -> completed
        \-> conflict | retryableFailure | failed | cancelled
```

Every transition must be idempotent, recorded with timestamps and actor/connector IDs, and safe to repeat after a process restart.

### Thumbnail job

```text
queued -> assigned -> readingNas -> generatingThumbnail -> uploadingThumbnail -> verifying -> ready
                 \-> retryableFailure | failed | cancelled
```

## Implementation guardrails for agents

- Do not open inbound ports, publish SMB/NFS/WebDAV, or expose the NAS directly to the internet.
- Do not put an interactive window inside the Windows Service. Keep the Control Center as a separate user-session process using ACL-protected local IPC.
- Do not let the Control Center bypass service-account access checks, TLS validation, root canonicalization, or shared-key connection controls.
- Do not let the browser provide raw NAS paths, object keys, connector commands, or cloud credentials.
- Do not proxy large file bodies through the web API.
- Do not claim that a browser can launch arbitrary native programs. Use inline responses where supported and explicit downloads otherwise.
- Do not render active/untrusted image-like formats in the lightbox. Use a strict preview allow-list and bounded image decoding.
- Do not expose sibling image metadata outside the current authorized folder, even through prefetching or navigation APIs.
- Do not trust filesystem notifications as the only source of changes; retain periodic reconciliation.
- Do not write directly to a final NAS destination; always stage, verify, then atomic-move.
- Do not auto-overwrite. Require an explicit, auditable collision decision.
- Do not treat cached cloud content as authoritative if the NAS version is newer or cannot be verified.
- Keep all audit log records and job errors free of secrets, signed URLs, and raw credentials.

## Future phases, deliberately deferred

- Folder creation, rename/move/delete, file version history, external sharing, multi-NAS support, quota management, antivirus/DLP integration, rich non-image preview generation, offline browser uploads, and bidirectional folder synchronization.
