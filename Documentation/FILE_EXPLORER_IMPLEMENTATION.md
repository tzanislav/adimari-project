# Folder Explorer implementation

## Purpose

The live Folder Explorer is Adimari's authenticated user interface for the separate File Sync application. It deliberately contains no NAS configuration, backend route implementation, credentials, or direct NAS delivery.

The current page is available to authenticated users at:

```text
/projects/folder-explorer
```

It is linked from the **NAS File Explorer** card on the Projects page.

## Current behaviour

`front-end/src/pages/FolderExplorer.jsx` uses the signed-in Firebase user to call the File Sync API through `front-end/src/utils/fileSyncApi.js`. It lets an authenticated user:

- Select a published NAS storage node.
- Browse cursor-paged folders with breadcrumbs.
- Upload one or more files to the folder currently open in the explorer, either through the picker or a drag-and-drop box. Phone gallery multi-select is supported.
- Request a file for delivery and observe its current status.
- Start one authenticated delivery from the Download button; once ready, browser-viewable files such as PDFs open in a new tab and other files download normally.
- Preview supported images in the reusable lightbox. The initial preview uses the same authenticated, full-file delivery flow as download; it does not expose a NAS path or S3 URL.

The File Sync service remains the source of truth for the catalog, delivery queue, S3 access, and diagnostics.

The existing `/projects/file-server` page is separate: it remains the private S3 File Sharing manager and is the only authenticated UI that exposes public share links. The NAS explorer does not render share controls.

## File Sync route

The API base URL defaults to the same-origin path `/file-sync-api`, which the production reverse proxy should forward to File Sync. A deployment can override it with `VITE_FILE_SYNC_API_BASE_URL`.

During local development, `front-end/vite.config.js` proxies `/file-sync-api/*` to `http://localhost:5000/*`. The browser sends its Firebase bearer token; File Sync validates it. Do not add NAS credentials, NAS paths, or connector control logic to this project.

In production, Nginx must proxy `/file-sync-api/` to the File Sync
coordinator and preserve WebSocket upgrades for `/file-sync-api/hubs/agent`.
`scripts/deploy.ps1` verifies the protected proxy endpoint after deploying the
frontend; it expects an unauthenticated request to return HTTP 401. Override
its `-PublicHost` parameter when deploying to a non-default host.

The explorer uses the reusable [image-preview component](FILE_EXPLORER_IMAGE_LIGHTBOX_API.md) for supported image files. File Sync does not yet supply thumbnails, so the first preview requests the image through the normal secure delivery flow and displays the browser's short-lived object URL. A future thumbnail endpoint can replace that full-file preview without changing the lightbox API. The lightbox remains presentation-only and must never receive NAS paths, credentials, or raw service errors.

## Visual dependencies

The page reuses `front-end/src/CSS/FileServer.css` for its neutral explorer layout. It does not depend on any NAS-specific styles or assets.
