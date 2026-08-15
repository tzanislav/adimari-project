# NAS upload audit and repairs

Date: 2026-08-15

## Scope correction

The public Adimari NAS experience is the **NAS File Explorer** at
`/projects/folder-explorer`, implemented by
`front-end/src/pages/FolderExplorer.jsx`.

It is not File Sync's `ClientApp`; that separate application is a diagnostics
UI. A change made only to `file-sync/src/FileSync.Web/ClientApp` does not
change the Adimari explorer.

## Intended sequence

```text
Adimari NAS File Explorer
  -> /file-sync-api/api/browser-uploads (Firebase bearer token)
  -> Adimari reverse proxy removes /file-sync-api
  -> File Sync coordinator receives multipart file bytes
  -> temporary private S3 object
  -> NAS connector downloads and verifies the object
  -> NAS file is atomically saved
  -> coordinator updates catalog
  -> Adimari explorer refreshes the open folder
```

## Findings

| Finding | Effect | Repair status |
| --- | --- | --- |
| The real Adimari explorer was not the UI previously changed. | Gallery selection remained unfixed in the public UI. | Fixed in `FolderExplorer.jsx`. |
| The checked-in Nginx template did not describe the File Sync route, even though the live site had a separate working include. | A future Nginx rebuild could silently drop the proxy and send browser requests to the Adimari app instead. | The template now matches the live same-origin proxy, including the bare-prefix redirect and SignalR route. The live route to `127.0.0.1:5002` was verified to return HTTP 401 when unauthenticated. |
| The source Nginx template had a 1 MB server limit, while phone photos commonly exceed it. | A rebuilt site could reject normal uploads with HTTP 413. | The File Sync route now explicitly overrides the limit to 1 GB. |
| The former coordinator-to-connector handoff accepted a successful NAS acknowledgement without checking copied bytes. | A broken or empty stream could become a successful zero-byte NAS file. | File Sync source now uses S3 handoff and connector byte-count validation. |
| `file-sync-connector/publish/FileSyncNasAgent` is stale. | It contains the older browser-upload receiver and must not be used for this repair. | Use a new release publish, not that folder. |
| A connector override without a complete `S3` section cannot download the temporary object. | The new upload flow fails rather than creating a corrupt file. | Confirm the target PC's `appsettings.Local.json` has S3 key, secret, region, bucket, and matching prefix. |
| The watcher observed connector temporary files in the NAS root. | A partial `.filesync-upload-*.tmp` file could briefly appear in the catalog. | Fixed in connector source: scans and watcher events now ignore those temporary files. |
| The browser acknowledgement, watcher, and delayed rename events could target an already-existing catalog row. | SQLite raised `UNIQUE constraint failed: Files.StorageNodeId, Files.RelativePath`, so the UI could report failure after a successful local save. | The coordinator serializes inventory writes and treats duplicate/delayed rename destinations as idempotent updates or merges. The connector also no longer publishes a second watcher upsert for its own temporary-to-final browser-upload rename. |

## Repairs made in this change

1. The Adimari NAS explorer now declares media/document types on its real file
   input. `image/*` and `video/*` let mobile browsers offer gallery selection;
   no `capture` attribute is used, so the user is not forced into the camera.
2. The project card is explicitly named **NAS File Explorer**, separating it
   from the distinct Adimari **File Sharing** feature.
3. The explorer reports useful 404 and 413 configuration failures instead of a
   generic error.
4. The production Nginx template contains the required same-origin
   `/file-sync-api/` reverse proxy with a 1 GB limit, long-running upload
   timeouts, and a WebSocket-capable connector hub route.
5. File Sync and the NAS connector source use this verified handoff:
   - coordinator uploads the browser bytes to a private temporary S3 object;
   - connector checks S3 `ContentLength`, counts bytes written, and checks the
     final NAS file length before acknowledging;
   - coordinator updates the inventory immediately and the Adimari explorer
     refreshes the folder.
6. The connector now excludes its `.filesync-upload-*.tmp` staging files from
   scans and watcher publications. Its temporary-to-final browser-upload
   rename is deliberately not watcher-published: the verified coordinator
   acknowledgement performs the one authoritative catalog upsert. A later
   scan remains the reconciliation fallback.
7. The coordinator serializes all inventory-table mutations, preventing a
   scan, watcher, or browser acknowledgement from racing the same
   query-then-insert row creation. Delayed rename events now update or merge
   an existing destination instead of attempting a duplicate insert.

## Deployment status

- The actual Adimari frontend was deployed and its public bundle was verified
  to contain both the gallery-aware file input and the `/file-sync-api` route.
- The File Sync coordinator is active on production release
  `20260815-web-s3-v7`; its local and public protected endpoints return the
  expected HTTP 401 without a bearer token.
- The fresh NAS agent package is ready at
  `file-sync-connector/artifacts/FileSyncNasAgent-20260815-connector-s3-v4`.
  It still needs to be installed on the NAS target PC, preserving that PC's
  `appsettings.Local.json` and `App_Data`. No target-PC write was attempted
  because this workspace has no connection to that machine.
- A real mobile upload remains the final acceptance test after that agent
  installation. It must use a non-empty photo and confirm equal browser/NAS
  byte counts.

## Required deployment repairs

These are required before testing; source changes alone do not affect the
running systems.

1. In the installed Adimari Nginx configuration, ensure the
   `/file-sync-api/` proxy and `/file-sync-api/hubs/agent` WebSocket route are
   present, then test and reload Nginx. The checked-in template requires an
   upstream origin with no trailing slash. On the current production host,
   `/etc/nginx/sites-available/adimari-db.com` includes
   `/etc/nginx/snippets/file-sync.conf`, which already forwards these routes
   to `http://127.0.0.1:5002`; an unauthenticated proxy request was verified
   to return the expected HTTP 401. Keep that route in place. For a new host,
   replace `__FILE_SYNC_API_UPSTREAM__` with the actual coordinator origin.
2. Create and deploy a fresh Linux File Sync coordinator release. Its S3
   identity needs `PutObject`, `GetObject`, and `DeleteObject` access for the
   temporary `<prefix>/<storage-node>/browser-uploads/` path.

   ```powershell
   Set-Location 'D:\Libraries\Work\Dev\Web Development\file-sync'
   .\scripts\Publish-FileSyncWeb.ps1 -Version browser-upload-s3
   .\scripts\Deploy-FileSyncWeb.ps1 `
     -ReleaseDirectory .\artifacts\FileSync.Web-browser-upload-s3-linux-x64
   ```

   The deploy script verifies package hashes, preserves the external database
   and `/etc/file-sync/file-sync.env`, switches the release symlink atomically,
   waits for the protected local and public endpoints to return HTTP 401, and
   rolls back to the prior release if either check fails.
3. Create a **fresh** connector publish from the current source:

   ```powershell
   Set-Location 'D:\Libraries\Work\Dev\Web Development\file-sync-connector'
   .\scripts\Publish-Connector.ps1 -Version browser-upload-s3
   ```

   Use `.\artifacts\FileSyncNasAgent-browser-upload-s3`. Do not reuse
   `file-sync-connector\publish\FileSyncNasAgent` or an older `win-x64`
   publish folder. Stop the connector before replacement; preserve `App_Data`
   and the target PC's local configuration.
4. On the NAS PC, retain the machine's existing `appsettings.Local.json` only
   if it has a complete `S3` section for the same bucket, region, and prefix as
   the coordinator. Do not copy the stale publish folder's local config over
   it. Its required shape is:

   ```json
   {
     "AgentConnection": {
       "StorageNodeId": "<the explorer node ID>",
       "CoordinatorHubUrl": "https://<file-sync-host>/hubs/agent",
       "ConnectionKey": "<the coordinator connector key>"
     },
     "Inventory": { "TargetFolder": "D:\\<NAS-root>" },
     "S3": {
       "AccessKeyId": "<key>",
       "SecretAccessKey": "<secret>",
       "Region": "<region>",
       "BucketName": "<bucket>",
       "KeyPrefix": "<prefix>"
     }
   }
   ```

   Restart the connector after replacement or after changing S3 settings.
5. Deploy Adimari source via `adimari-project/scripts/deploy.ps1`; that script
   rebuilds `front-end/dist`, which is what `Backend/server.js` serves, and
   verifies that the public File Sync proxy returns HTTP 401 before reporting
   success. Use `-PublicHost` when deploying to a host other than
   `adimari-db.com`. Copying File Sync's diagnostics UI does not update
   Adimari.

## Acceptance test

Use a small non-empty image with a distinctive byte size.

1. Open **Projects → NAS File Explorer** and choose it from the phone gallery.
2. Confirm the request reaches `/file-sync-api/api/browser-uploads` and does
   not return 404 or 413.
3. Confirm the UI reports **Saved to NAS** and the file appears in the open
   folder without a manual scan.
4. On the NAS PC, compare the saved file size with the original. They must
   match exactly.
5. If it fails, retain the error displayed next to the file and collect the
   File Sync coordinator and connector logs. A mismatch now fails visibly; it
   must not be acknowledged as a successful 0 KB file.

## Follow-up security repair

The Adimari route is moderator/admin gated in the UI, but File Sync presently
accepts any valid Firebase user at its API. Add server-side role enforcement
before exposing the File Sync API directly outside the same-origin proxy.
