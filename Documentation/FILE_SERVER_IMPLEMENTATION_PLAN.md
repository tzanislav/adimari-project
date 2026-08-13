# Private File Server — Implementation Plan

## Purpose

Add a file-management area to the existing React/Express application where authorized signed-in users can upload, browse, move, delete, and create download-only share links. Files stay private in AWS S3. A recipient with a share link never needs an account and can only download the specific shared file.

The feature is deliberately separate from the existing `/api/upload` route. That route is used by the current application and has different limits and no file-management or sharing model.

## Recommended architecture

```text
Signed-in manager ── Firebase ID token ──> React file manager
                                          │
                                          ▼
                                      Express API ──> MongoDB share/audit records
                                          │                    │
                                          ▼                    ▼
                              short-lived S3 upload/download URLs   audit trail

Public recipient ──> GET /download/:shareToken ──> Express validates link
                                                    └─> redirects to a short-lived,
                                                        download-only S3 URL
```

### Storage and naming rules

- Use a new **private** S3 bucket dedicated to this feature, with Block Public Access enabled. Do not make objects public and do not use public bucket policies or S3 ACLs.
- Store each object with its human-readable file name in its S3 key, for example `documents/2026/Proposal.pdf`.
- Treat the selected folder plus file name as unique. An upload that conflicts with an existing object must require an explicit user choice: replace, rename, or cancel. Never silently overwrite.
- S3 is the source of truth for files and folders. The application lists object prefixes and object details directly from S3; MongoDB stores share records, multipart-operation recovery state, and audit events only.
- A move or rename is implemented as S3 `CopyObject` followed by `DeleteObject`. The service updates active share records to the new key as part of its recoverable operation workflow. It is not a native S3 rename.

### Authorization and links

- Management endpoints require a Firebase bearer token and allow `moderator` and `admin` only, matching the application’s existing editing convention.
- Share links are opaque, random 256-bit tokens. Store only a SHA-256 hash of the token in MongoDB, never the raw token.
- A share link points to exactly one file and provides **download only**. It is revocable and may have an optional expiry. The public endpoint returns a short-lived S3 `GetObject` URL with `Content-Disposition: attachment`; it exposes no list, metadata, upload, delete, or move capability.
- Links do not expire automatically. Managers can list, copy, and revoke them, and can view a download count and last-download timestamp. The count means “download initiated”: it increases when the public endpoint validates a link and issues a download URL. This is reliable without proxying multi-gigabyte downloads through the application. The S3 URL issued after link validation should expire in 5 minutes or less.

## Confirmed product decisions

| Decision | Confirmed choice | Implementation consequence |
| --- | --- | --- |
| File-management access | `moderator` and `admin` only | All management routes and the React `/files` route require one of these Firebase roles. |
| Bucket scope | New dedicated private S3 bucket | The feature has its own lifecycle, IAM policy, and cost controls. |
| Share-link lifetime | Permanent until revoked | The share-management UI shows active/revoked state, download count, and last download. |
| Same-name collision | Dialog: replace, rename, or cancel | The API exposes collision information; it never overwrites without an explicit replace action. |
| File size | Very large files, including files over 10 GB | Browser uploads use signed multipart-upload URLs; no application-server file buffering. The initial configurable limit is S3's current 48.8 TiB per-object multipart maximum. |
| S3 as operational source | Authorized users manage the S3 contents through the app | Listings read directly from S3; MongoDB stores only share and application metadata. |

There are no further product decisions required to begin. Phase 0 will select the AWS region close to the deployment/runtime and establish the final bucket name and deployment URL.

## AWS bucket and IAM setup

Perform these steps in the AWS account that will host the production files. Choose the same AWS region as the deployed backend where possible; this reduces transfer cost and latency.

### 1. Create the bucket

1. In AWS Console, open **S3** -> **Create bucket**.
2. Enter a globally unique DNS-compatible name, for example `adimari-private-files-prod`. Do not put customer-sensitive information in the name.
3. Select the chosen region and leave **Object Ownership** as **ACLs disabled (recommended)** / *Bucket owner enforced*.
4. Leave all four **Block Public Access** options enabled. A share link is handled by the application and short-lived signed download URL, never by a public S3 object.
5. Enable **Bucket Versioning**. This allows recovery from accidental replacement/deletion and supports the replace workflow safely.
6. Set **Default encryption** to SSE-S3. Use SSE-KMS only if your organization requires KMS-controlled keys; it adds matching KMS permissions and request cost.
7. Create the bucket. Do not enable static website hosting or configure public access.

### 2. Configure lifecycle rules

Create these lifecycle rules in the bucket’s **Management** tab:

1. Create `abort-incomplete-multipart-uploads`.
   - Scope it to the `files/` prefix (or the entire bucket only if it will contain nothing else).
   - Under **Lifecycle rule actions**, select **Delete expired object delete markers or incomplete multipart uploads**.
   - Select **Delete incomplete multipart uploads** and enter **7** days.
   - Do not add an object-tag filter: S3 does not allow a tag filter for this action.
   - This cancels unfinished upload sessions and removes their uploaded parts; it does not delete completed files.
2. Create `expire-noncurrent-versions-after-30-days`.
   - Scope it to the same `files/` prefix.
   - Select **Permanently delete noncurrent versions of objects**.
   - Set **Days after objects become noncurrent** to **30**.
   - Leave **Number of newer versions to retain** blank. This retains every prior version for 30 days, then removes it. Set it to a number only if a minimum number of prior versions must survive beyond the 30-day period.
   - Optionally also select **Delete expired object delete markers** to clean up tombstones after all versions have expired. This does not remove a live object.
3. Do **not** add a storage-class transition initially. After 30–60 days, review storage volume, downloads, and retrieval costs. If files are large and access is unpredictable, the first safe option is a transition to **S3 Intelligent-Tiering**; keep its Archive Access and Deep Archive Access tiers disabled so downloads remain immediately available. Do not transition shareable files to S3 Glacier Flexible Retrieval or S3 Glacier Deep Archive without building a restore workflow.

### 3. Configure CORS for browser-to-S3 uploads

In the bucket **Permissions** tab, add a CORS policy after replacing the example origins with the exact production frontend origin(s), and include local Vite only when development requires it:

```json
[
  {
    "AllowedHeaders": ["content-type", "x-amz-*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedOrigins": ["https://app.example.com", "http://localhost:5173"],
    "ExposeHeaders": ["ETag", "x-amz-version-id"],
    "MaxAgeSeconds": 3000
  }
]
```

Remove `http://localhost:5173` from the production policy if developers do not require it. S3 CORS is not access control; the bucket remains private and each browser request still requires a short-lived URL issued by the authenticated backend.

### 4. Create the backend AWS identity

Use an IAM role attached to the backend’s AWS compute service where possible. If the present deployment cannot assume an IAM role, create a dedicated IAM user with an access key stored only in the deployment secret store—not in source files, `.env` committed to Git, or frontend variables.

Attach a policy like the following, replacing the bucket name. It permits only the operations needed by the backend for the `files/` prefix. It intentionally does not permit permanent version deletion, so bucket versioning remains a recovery mechanism. Add KMS permissions only if SSE-KMS was chosen.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GetFileServerBucketLocation",
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::adimari-private-files-prod"
    },
    {
      "Sid": "ListManagedFiles",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::adimari-private-files-prod",
      "Condition": { "StringLike": { "s3:prefix": ["files/*"] } }
    },
    {
      "Sid": "ManageFiles",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:GetObjectAttributes",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListMultipartUploadParts",
        "s3:AbortMultipartUpload"
      ],
      "Resource": "arn:aws:s3:::adimari-private-files-prod/files/*"
    }
  ]
}
```

`CopyObject` is authorized by the included `s3:GetObject` and `s3:PutObject` permissions. This feature does not need `s3:PutObjectAcl`; do not grant it. Add a new `FILE_SERVER_BUCKET_NAME` variable. Refactor the current AWS client setup so it uses the AWS SDK default credential provider chain when access-key variables are absent; otherwise an attached IAM role cannot be used.

## Delivery phases

Each phase is sized as an independently reviewable agent task. Do not start a later phase until the preceding acceptance criteria pass.

### Phase 0 — Confirm scope and provision AWS (one agent task)

1. Record the six decisions above in the project configuration/README.
2. Create or designate the S3 bucket in the intended production region.
3. Enable Block Public Access, default server-side encryption (SSE-S3 or the organization’s approved KMS key), versioning if recovery from accidental deletes is desired, and lifecycle rules for incomplete multipart uploads.
4. Create a least-privilege IAM role/user for the backend with access only to this bucket and only these operations: list under the approved prefix, get, put, head, copy, delete, and multipart-upload actions.
5. Add the bucket, region, link base URL, maximum file size, and allowed origins to environment configuration. Keep credentials out of Git. If deployed on AWS, prefer an attached IAM role over long-lived access keys.
6. Define the top-level key prefix, initially `files/`, and document that direct console edits must stay within it.

Acceptance criteria: the application identity can perform allowed operations under `files/` and is denied public ACL/policy changes and access outside the bucket/prefix.

### Phase 1 — Backend foundation and share model (one agent task)

1. Add `Backend/models/fileShare.js`, `fileOperation.js`, and `fileAuditEvent.js`. `fileShare` stores the S3 key, original filename snapshot, token hash, active state, download count, last-download timestamp, and creation/revocation details. Index active shares by token hash.
2. Add a focused `Backend/services/fileStorageService.js` around AWS SDK v3 and `@aws-sdk/s3-request-presigner`. Refactor AWS client construction to support the default IAM credential provider chain as well as locally supplied credentials. The service owns safe direct S3 listing, object inspection, multipart upload setup/completion/abort, signed URLs, copy/delete behavior, and normalized S3 errors.
3. Add strict validation helpers for folder paths, display names, sizes, content types, IDs, upload IDs, and optimistic-concurrency/version fields. Reject traversal, control characters, empty segments, and keys outside `files/`.
4. Define API error responses and recovery behavior for S3/share-record partial failures. In particular, report an incomplete move instead of claiming success; record a repairable operation so active shares can be updated to the new key or safely revoked.
5. Add server configuration validation that fails fast if the new file-server variables are missing.

Acceptance criteria: unit tests cover key/path validation, share-token hashing, S3 listing normalization, multipart-operation validation, and S3-error mapping. No new public route exists yet.

### Phase 2 — Authenticated file-management API (one agent task)

1. Mount `/api/files` with Firebase `authenticate` and the approved role middleware at the router level.
2. Implement paginated folder listing and file details directly from S3 `ListObjectsV2`/`HeadObject`, scoped to the approved `files/` prefix. Folders are virtual prefixes; create an empty `.keep` marker only if empty folders must be visible.
3. Implement multipart upload initiation, part URL batching, completion, cancellation, and recovery. Use 64 MiB parts by default (well above the 5 MiB S3 minimum) and increase part size to at least `ceil(fileSize / 10,000)` so every permitted object remains within S3's 10,000-part limit. Retry failed parts and never route file bytes through Express. Request each signed-URL batch while the user is still authorized, so multi-hour uploads do not rely on one long-lived credential. Confirm the completed object with `HeadObject`.
4. Implement conflict detection against S3 before starting an upload. Return a conflict response for the UI’s explicit replace, rename, or cancel dialog. A replacement should create a new S3 version rather than bypassing bucket versioning.
5. Implement move/rename with collision checks, copy-then-delete, then update active `fileShare` records in a recoverable operation. Implement delete against S3 and revoke affected shares; use S3 versioning/lifecycle for recovery.
6. Record actor and result in file-operation audit events. Apply route-specific rate limits and structured request logs without logging share tokens.

Acceptance criteria: authorized users can upload a file over 10 GB, list, move/rename, and delete; unauthenticated and wrong-role requests receive 401/403; a failed copy/delete exposes a recoverable state and cannot silently point a share link at the wrong object.

### Phase 3 — Public, download-only sharing (one agent task)

1. Add authenticated endpoints to create, list, and revoke permanent shares of an S3 object. The list returns download count, last-download timestamp, and creation/revocation details.
2. Generate a cryptographically secure token, persist its hash and link attributes, and return the raw token only once in the created URL.
3. Add an unauthenticated `GET /download/:token` endpoint. It validates token hash, active state, expiry, and file existence, then issues a short-lived S3 download URL or streams the response.
4. Force `Content-Disposition: attachment` with a safely encoded original filename. The browser receives a short-lived, object-specific S3 URL in the redirect so it can download very large files without proxying bytes through Express; that URL grants download access only to that object and expires quickly. The application exposes no Firebase details, folder listing, or other API data, and returns a generic not-found response for invalid/revoked links.
5. Increment the share’s `downloadCount` and update `lastDownloadedAt` only after validation and immediately before issuing the signed URL. Set public-route rate limits and add minimal download audit events (share ID, timestamp, result; IP only if allowed by the privacy policy).

Acceptance criteria: a browser in a private/incognito session can download with a valid link; cannot browse folders, upload, or call management APIs; revoked and expired links fail; the S3 bucket remains private.

### Phase 4 — React file-manager experience (one agent task)

1. Add a protected `/files` route and navigation entry visible only to authorized roles.
2. Build folder navigation, paginated file list, upload drop zone/progress, new-folder UI if selected, rename/move dialog, and delete confirmation.
3. Handle name conflicts explicitly and show recoverable errors from the API.
4. Add a share dialog to create and copy a link; list each file’s active and revoked links, download count, last-download timestamp, and revoke action.
5. Add loading, empty, access-denied, and expired/revoked-link states. The public `/download/:token` URL should go to the backend (or a small frontend route that immediately calls it), not to S3 directly.

Acceptance criteria: a permitted user can complete the full workflow without AWS-console access; a recipient needs no account and sees only a download response.

### Phase 5 — Verification, operations, and release (one agent task)

1. Add backend unit tests for authorization, validation, token storage, share revocation, download-count increment, collision handling, multipart validation, and move/delete recovery.
2. Add integration tests against an isolated test bucket or S3-compatible emulator; include multipart upload and large-object scenarios, and never use production data for destructive tests.
3. Add browser-level tests for upload, move, delete, replace/rename/cancel conflict handling, share, revoke, share metrics, and public download flows.
4. Run a security review: IAM policy, bucket policy, Block Public Access, CORS, URL expiration, rate limits, token entropy, logging/redaction, XSS-safe file names, and dependency audit.
5. Document deployment variables, AWS setup, backup/restore expectations, multipart-upload recovery, and an incident procedure for revoking a leaked link.
6. Release behind the authorized route, monitor errors/downloads, and perform a post-release test with a non-privileged user and an anonymous browser.

Acceptance criteria: all automated tests pass; the bucket is verified private; security review has no unresolved high-severity findings; operating documentation is complete.

## Direct S3 management policy

The application reads and edits S3 directly. It does not keep a second file catalog in MongoDB, so an object created or removed in the bucket is reflected in the next S3-backed listing.

Share records are the exception: moving or deleting objects outside this application can make an existing link fail because a share records its exact S3 key. Restrict AWS Console write access to break-glass administrators, and use the file-manager UI for routine operations so moves and deletions update or revoke related shares safely.

## Out of scope for the first release

- Folder-level public shares, uploads by external recipients, editing files in place, virus scanning, previews, per-file ACLs, quotas, and multi-tenant isolation.
- These can be added later without changing the core private-bucket, direct-S3, and opaque-share-token design.
