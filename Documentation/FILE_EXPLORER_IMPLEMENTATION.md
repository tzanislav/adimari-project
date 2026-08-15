# Folder Explorer implementation

## Purpose

The live Folder Explorer is the front-end hand-off point for the separate file application. It deliberately contains no NAS configuration, backend route, credentials, upload logic, or direct file delivery.

The current page is available to authenticated users at:

```text
/projects/folder-explorer
```

It is linked from the **Database** card on the Projects page.

## Current behaviour

`front-end/src/pages/FolderExplorer.jsx` renders a styled explorer shell with a clear message that the file connection has moved to its own application. It makes no HTTP requests and has no file data state.

This is intentional. The page is ready to receive a future external-app link without retaining the former NAS access implementation in this repository.

The existing `/projects/file-server` page is separate: it remains the private S3 File Sharing manager and is not the Folder Explorer integration point.

## Reconnecting an external file application

When the new application URL is available, update the Folder Explorer page or the Database project card to navigate to that URL. Do not add NAS credentials, NAS paths, or connector control logic back into this project.

If the new application supplies browser-safe file metadata and delivery URLs, a future in-app explorer can render that data and use the reusable image-preview component documented in [FILE_EXPLORER_IMAGE_LIGHTBOX_API.md](FILE_EXPLORER_IMAGE_LIGHTBOX_API.md).

## Visual dependencies

The page reuses `front-end/src/CSS/FileServer.css` for its neutral explorer layout. It does not depend on any NAS-specific styles or assets.
