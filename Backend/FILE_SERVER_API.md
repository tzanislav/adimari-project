# File Server API - Phase 2

All endpoints below require a Firebase bearer token from a user with the `moderator` or `admin` role. The API never accepts AWS credentials from the browser and never proxies file bytes through Express.

## Browse and inspect

| Request | Purpose |
| --- | --- |
| `GET /api/files?folder=&cursor=&limit=100` | List a virtual S3 folder. The maximum `limit` is 1,000. |
| `GET /api/files/object?key=files/path/name.ext` | Get direct S3 object metadata. |
| `POST /api/files/folders` with `{ "folder": "Projects/2026" }` | Create an empty visible folder using a hidden `.keep` marker. |

## Multipart upload lifecycle

1. `POST /api/files/uploads` with `folder`, `fileName`, `size`, optional `contentType`, and optional `conflictStrategy` (`cancel` or explicit `replace`).
2. `POST /api/files/uploads/:operationId/parts` with `{ "partNumbers": [1, 2] }` to receive a short-lived signed URL for each requested part.
3. Upload each part directly to S3, keeping the returned ETag.
4. `POST /api/files/uploads/:operationId/complete` with `{ "parts": [{ "partNumber": 1, "eTag": "..." }] }`.
5. If the client cancels, call `POST /api/files/uploads/:operationId/abort`.

For a new file, completion uses S3's `If-None-Match: *` precondition so an object created after conflict checking is not silently overwritten.

## Move and delete

- `POST /api/files/move` with `sourceKey`, `destinationFolder`, `destinationFileName`, and optional explicit `conflictStrategy: "replace"`.
- `DELETE /api/files/object?key=files/path/name.ext`.

Moves use S3 copy-then-delete. After S3 succeeds, active share records are updated to the new key. Deletes revoke matching active shares. If that metadata update fails, the operation is recorded as `needs_repair` and the API does not report success.

## Share links

| Request | Purpose |
| --- | --- |
| `POST /api/files/shares` with `{ "key": "files/path/name.ext" }` | Create a permanent share link. The response is the only time its raw URL is returned. |
| `GET /api/files/shares?key=files/path/name.ext` | List active and revoked links for a file, including download count and last-download time. |
| `POST /api/files/shares/:shareId/revoke` | Revoke one active link. |
| `GET /download/:token` | Public endpoint. Validates an active token, records a download start, and redirects to a five-minute S3 download URL. |

Share tokens contain 256 bits of randomness and only their SHA-256 hashes are stored. The public endpoint returns the same generic 404 for malformed, revoked, or unknown links and never lists S3 contents. Its redirect contains a short-lived signed URL for the single requested object, which is necessary to download very large files directly from S3 without proxying them through the backend.
