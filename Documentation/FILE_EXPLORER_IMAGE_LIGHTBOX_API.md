# File Explorer image lightbox API

## Purpose

`front-end/src/components/FileExplorerImageLightbox.jsx` is a reusable, API-free React component for previewing an image selected by a file explorer. It does not fetch files, create download URLs, access NAS resources, or manage explorer state. The parent explorer owns those responsibilities.

The component imports `front-end/src/CSS/FileExplorerImageLightbox.css` itself; consumers only need to import the component.

```jsx
import FileExplorerImageLightbox from '../components/FileExplorerImageLightbox';
```

Render it only while an image is selected.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | string | `Image preview` | Image name. Used for the dialog label, image alt text, and footer. |
| `imageUrl` | string | `''` | Browser-accessible URL for the full image or a temporary preview. |
| `loading` | boolean | `false` | Shows the loading status text. |
| `loadingLabel` | string | `''` | Optional status text. Uses `Loading image...` when omitted. |
| `error` | string | `''` | Displays an error message instead of the image. |
| `onClose` | function | — | Called when the user closes the dialog with Close, Escape, or a backdrop click. |
| `onDownload` | function | — | Optional. When supplied, displays the Download action and calls this callback. |
| `onPrevious` | function | — | Optional. Enables Previous, Left Arrow, and a right swipe. |
| `onNext` | function | — | Optional. Enables Next, Right Arrow, and a left swipe. |

Callbacks receive no arguments. Capture the selected item in the parent component or close over the relevant item ID/URL.

## Minimal integration

```jsx
const [previewIndex, setPreviewIndex] = useState(null);
const preview = previewIndex === null ? null : imageEntries[previewIndex];

const movePreview = (offset) => {
  setPreviewIndex((current) => current + offset);
};

{preview && (
  <FileExplorerImageLightbox
    title={preview.name}
    imageUrl={preview.previewUrl}
    onClose={() => setPreviewIndex(null)}
    onDownload={() => window.location.assign(preview.downloadUrl)}
    onPrevious={previewIndex > 0 ? () => movePreview(-1) : undefined}
    onNext={previewIndex < imageEntries.length - 1 ? () => movePreview(1) : undefined}
  />
)}
```

The parent must validate its own bounds, obtain any signed/delivery URL, and revoke any object URL it creates after the preview closes or changes.

## Interaction and accessibility behaviour

- It renders a modal dialog and focuses the Close button when opened.
- Escape closes the dialog; Left and Right Arrow invoke the available navigation callbacks.
- The page scroll is locked while the dialog is mounted and restored on unmount.
- Clicking the empty backdrop closes the dialog.
- Wheel zoom, pinch zoom, and image pan support a zoom range of 1× to 5×.
- A double-click resets zoom and pan.
- At 1× zoom, touch swipes move to the previous or next image when the matching callback is available.
- Changing `imageUrl` resets the image view to 1× zoom and no pan offset.

## Delivery and error ownership

The lightbox is presentation-only. A file explorer can first pass a thumbnail URL with `loading={true}`, then replace `imageUrl` with a full delivery URL once ready. If delivery fails, keep the dialog open and pass a user-safe `error` message.

Do not expose storage credentials, internal file paths, or raw backend errors through the component props.
