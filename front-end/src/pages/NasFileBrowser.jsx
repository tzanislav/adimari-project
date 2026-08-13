import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchWithAuth } from '../utils/authHeaders';
import '../CSS/FileServer.css';

const serverUrl = import.meta.env.VITE_SERVER_URL || '';
const apiBase = `${serverUrl}/api/nas-catalogue`;

const UPLOAD_URL_BATCH_SIZE = 20;
const UPLOAD_CONCURRENCY = 3;
const MIN_IMAGE_ZOOM = 1;
const MAX_IMAGE_ZOOM = 5;

class NasCatalogueApiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NasCatalogueApiError';
  }
}

const apiRequest = async (path, options = {}) => {
  const response = await fetchWithAuth(`${apiBase}${path}`, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) throw new NasCatalogueApiError(data?.error || 'The NAS catalogue request failed.');
  return data;
};

const runWithConcurrency = async (items, limit, task) => {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      await task(items[current]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
};

const formatBytes = (value) => {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');

const getFileExtension = (fileName) => {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === fileName.length - 1) return 'file';
  return fileName.slice(lastDot + 1).toLowerCase();
};

const getFileIconUrl = (entry) => {
  const iconName = entry.entryType === 'folder' ? 'folder' : getFileExtension(entry.name);
  return `/File%20Icons/${encodeURIComponent(iconName)}.png`;
};

const getFileIconFallbackUrl = (entry) => (
  entry.entryType === 'file' && getFileExtension(entry.name) !== 'file'
    ? '/File%20Icons/file.png'
    : ''
);

const renderNasEntryIcon = (entry) => (
  <span className="nas-entry-icon" aria-hidden="true">
    <span className="nas-entry-icon-fallback" />
    <img
      className="nas-entry-icon-image"
      src={getFileIconUrl(entry)}
      alt=""
      data-fallback-src={getFileIconFallbackUrl(entry)}
      onLoad={(event) => { event.currentTarget.previousElementSibling.hidden = true; }}
      onError={(event) => {
        const image = event.currentTarget;
        const fallbackSrc = image.dataset.fallbackSrc;
        if (fallbackSrc && !image.dataset.usedFallback) {
          image.dataset.usedFallback = 'true';
          image.src = fallbackSrc;
          return;
        }
        image.style.display = 'none';
      }}
    />
  </span>
);

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

const clampImagePosition = ({ x, y, scale }, viewport) => ({
  x: clamp(x, viewport.width * (1 - scale), 0),
  y: clamp(y, viewport.height * (1 - scale), 0),
  scale,
});

function NasFileBrowser() {
  const [roots, setRoots] = useState([]);
  const [rootId, setRootId] = useState('');
  const [folder, setFolder] = useState('');
  const [listing, setListing] = useState({ entries: [], nextCursor: null, root: null });
  const [searchText, setSearchText] = useState('');
  const [searchState, setSearchState] = useState(null);
  const [loadingRoots, setLoadingRoots] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [sharingEntryId, setSharingEntryId] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [deliveringEntryId, setDeliveringEntryId] = useState('');
  const [deliveryMessage, setDeliveryMessage] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const [thumbnails, setThumbnails] = useState({});
  const [uploadState, setUploadState] = useState(null);
  const fileInputRef = useRef(null);
  const imageViewportRef = useRef(null);
  const imageDragRef = useRef(null);
  const imagePointersRef = useRef(new Map());
  const imageViewRef = useRef({ scale: MIN_IMAGE_ZOOM, x: 0, y: 0 });
  const [imageView, setImageView] = useState({ scale: MIN_IMAGE_ZOOM, x: 0, y: 0 });

  const activeRoot = useMemo(
    () => roots.find((root) => root.id === rootId) || listing.root || null,
    [roots, rootId, listing.root],
  );

  const loadRoots = useCallback(async () => {
    try {
      setLoadingRoots(true);
      setError('');
      const result = await apiRequest('/roots');
      setRoots(result.roots || []);
      setRootId((current) => (
        result.roots?.some((root) => root.id === current) ? current : (result.roots?.[0]?.id || '')
      ));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingRoots(false);
    }
  }, []);

  const loadFolder = useCallback(async ({
    cursor = null, append = false, quiet = false, targetFolder = folder,
  } = {}) => {
    if (!rootId) return;
    try {
      if (append) setLoadingMore(true);
      else if (!quiet) setLoading(true);
      setError('');
      const query = new URLSearchParams({ parent: targetFolder, limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const result = await apiRequest(`/roots/${encodeURIComponent(rootId)}/entries?${query.toString()}`);
      setListing((previous) => (append ? {
        ...result,
        entries: [...previous.entries, ...(result.entries || [])],
      } : result));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      if (!quiet) setLoading(false);
      setLoadingMore(false);
    }
  }, [folder, rootId]);

  useEffect(() => {
    void loadRoots();
  }, [loadRoots]);

  useEffect(() => {
    setSearchState(null);
    if (rootId) void loadFolder({ targetFolder: folder });
  }, [folder, rootId, loadFolder]);

  // The connector now sends incremental watcher updates shortly after a NAS
  // edit. Quietly refresh the visible folder so ordinary changes appear
  // without requiring the operator to press the manual Refresh button.
  useEffect(() => {
    if (!rootId || searchState) return undefined;
    const refresh = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadFolder({ quiet: true, targetFolder: folder });
      }
    }, 20_000);
    return () => window.clearInterval(refresh);
  }, [folder, loadFolder, rootId, searchState]);

  const selectRoot = (nextRootId) => {
    setRootId(nextRootId);
    setFolder('');
    setSearchText('');
    setSearchState(null);
  };

  const runSearch = async (event) => {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) {
      setSearchState(null);
      return;
    }
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ q: query, rootId, limit: '100' });
      const result = await apiRequest(`/search?${params.toString()}`);
      setSearchState({ query: result.query, entries: result.entries || [], nextCursor: result.nextCursor });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchText('');
    setSearchState(null);
  };

  const uploadFileToCurrentFolder = async (file) => {
    let uploadId = '';
    let stagingCompleted = false;
    try {
      if (!file || !rootId || searchState) return;
      setError('');
      setUploadState({
        fileName: file.name,
        totalBytes: file.size,
        uploadedBytes: 0,
        status: 'Preparing secure temporary upload...',
        finished: false,
      });
      console.info('[NAS upload]', { step: 'browser_upload_started', rootId, folder, fileName: file.name, sizeBytes: file.size });
      const upload = await apiRequest('/roots/' + encodeURIComponent(rootId) + '/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentPath: folder,
          fileName: file.name,
          sizeBytes: file.size,
          contentType: file.type || 'application/octet-stream',
        }),
      });
      uploadId = upload.uploadId;
      if (!uploadId || !Number.isSafeInteger(upload.partSize) || upload.partSize < 1) {
        throw new NasCatalogueApiError('The server did not start the NAS upload.');
      }

      const partCount = Math.ceil(file.size / upload.partSize);
      const completedParts = [];
      for (let batchStart = 1; batchStart <= partCount; batchStart += UPLOAD_URL_BATCH_SIZE) {
        const partNumbers = Array.from(
          { length: Math.min(UPLOAD_URL_BATCH_SIZE, partCount - batchStart + 1) },
          (_, index) => batchStart + index,
        );
        setUploadState((current) => ({
          ...current,
          status: 'Uploading part ' + batchStart + ' of ' + partCount + '...',
        }));
        const signedParts = await apiRequest('/uploads/' + encodeURIComponent(uploadId) + '/parts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partNumbers }),
        });
        await runWithConcurrency(signedParts.parts || [], UPLOAD_CONCURRENCY, async ({ partNumber, url }) => {
          const startByte = (partNumber - 1) * upload.partSize;
          const part = file.slice(startByte, Math.min(startByte + upload.partSize, file.size));
          const response = await fetch(url, { method: 'PUT', body: part });
          if (!response.ok) throw new NasCatalogueApiError('Temporary upload storage did not accept part ' + partNumber + '.');
          const eTag = response.headers.get('etag');
          if (!eTag) throw new NasCatalogueApiError('Temporary upload storage did not confirm part ' + partNumber + '.');
          completedParts.push({ partNumber, eTag });
          setUploadState((current) => ({
            ...current,
            uploadedBytes: Math.min(current.totalBytes, current.uploadedBytes + part.size),
          }));
        });
      }
      setUploadState((current) => ({ ...current, status: 'Sending the file to the NAS connector...' }));
      await apiRequest('/uploads/' + encodeURIComponent(uploadId) + '/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: completedParts }),
      });
      stagingCompleted = true;
      console.info('[NAS upload]', { step: 'browser_staging_completed', uploadId });

      for (let attempt = 0; attempt < 120; attempt += 1) {
        const status = await apiRequest('/uploads/' + encodeURIComponent(uploadId));
        const job = status.job || {};
        console.info('[NAS upload]', { step: 'connector_upload_status', uploadId, status: job.status, progressStage: job.progressStage });
        if (job.status === 'completed') {
          setUploadState((current) => ({
            ...current,
            uploadedBytes: current.totalBytes,
            status: 'Upload complete. The file is now on the NAS.',
            finished: true,
          }));
          void loadFolder({ quiet: true, targetFolder: folder });
          window.setTimeout(() => setUploadState(null), 8_000);
          return;
        }
        if (job.status === 'failed' || job.status === 'cancelled') {
          throw new NasCatalogueApiError('The connector could not write this file to the NAS folder.');
        }
        const label = job.status === 'in_progress'
          ? 'Connector is writing the file into the NAS folder...'
          : 'Waiting for the NAS connector to accept the upload...';
        setUploadState((current) => ({ ...current, status: label }));
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      }
      setUploadState((current) => ({
        ...current,
        status: 'The upload is still queued for the NAS connector. You can safely leave this page.',
        finished: true,
      }));
      return;
    } catch (requestError) {
      console.error('[NAS upload]', { step: 'browser_upload_failed', uploadId, message: requestError.message });
      if (uploadId && !stagingCompleted) {
        await apiRequest('/uploads/' + encodeURIComponent(uploadId) + '/abort', { method: 'POST' }).catch(() => undefined);
      }
      setUploadState((current) => (current ? { ...current, status: 'Upload failed', finished: true } : null));
      setError(requestError.message || 'The NAS upload failed.');
    }
  };

  const chooseUploadFiles = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length || uploadState || searchState || !activeRoot?.uploadsEnabled) return;
    void uploadFileToCurrentFolder(files[0]);
  };

  const openEntryLocation = (entry) => {
    setSearchState(null);
    setFolder(entry.entryType === 'folder' ? entry.relativePath : entry.parentPath);
  };

  const createShare = async (entry) => {
    const traceId = crypto.randomUUID();
    try {
      setSharingEntryId(entry.id);
      setError('');
      setShareMessage('Creating a temporary share link and asking the NAS connector to prepare the file…');
      console.info('[NAS cache]', { traceId, step: 'share_clicked', entryId: entry.id, name: entry.name });
      const result = await apiRequest(`/entries/${encodeURIComponent(entry.id)}/shares`, { method: 'POST' });
      console.info('[NAS cache]', {
        traceId,
        step: 'share_created',
        shareId: result.share?.id,
        deliveryStatus: result.share?.deliveryStatus,
      });
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.url).catch(() => undefined);
      }
      setShareMessage(`Share link created for ${entry.name}. It has been copied to your clipboard and will become ready when the connector has cached the file.`);
    } catch (requestError) {
      console.error('[NAS cache]', { traceId, step: 'share_failed', message: requestError.message });
      setShareMessage('');
      setError(requestError.message);
    } finally {
      setSharingEntryId('');
    }
  };

  const beginBrowserDownload = (url, fileName) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const openPreparedFile = (url, preparedWindow) => {
    if (preparedWindow && !preparedWindow.closed) {
      preparedWindow.location.replace(url);
      return true;
    }
    return Boolean(window.open(url, '_blank'));
  };

  const waitForDelivery = async ({ disposition, deliveryId, traceId }) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await apiRequest(
        `/deliveries/${encodeURIComponent(deliveryId)}?${new URLSearchParams({ disposition }).toString()}`,
      );
      console.info('[NAS delivery]', {
        traceId,
        step: 'delivery_status',
        deliveryId,
        deliveryStatus: response.delivery?.deliveryStatus,
      });
      if (response.downloadUrl) {
        return response.downloadUrl;
      }
      if (response.delivery?.deliveryStatus === 'failed') {
        throw new NasCatalogueApiError('The connector could not prepare this file.');
      }
      await new Promise((resolve) => window.setTimeout(resolve, (response.retryAfterSeconds || 3) * 1_000));
    }
    throw new NasCatalogueApiError('File preparation is taking longer than expected. Please try again shortly.');
  };

  const prepareDeliveryUrl = async ({ entry, disposition, traceId, onPreparing }) => {
    console.info('[NAS delivery]', { traceId, step: 'delivery_requested', entryId: entry.id, disposition, name: entry.name });
    const response = await apiRequest(`/entries/${encodeURIComponent(entry.id)}/deliveries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disposition }),
    });
    console.info('[NAS delivery]', {
      traceId,
      step: 'delivery_response',
      deliveryId: response.delivery?.id,
      deliveryStatus: response.delivery?.deliveryStatus,
    });
    if (response.downloadUrl) return response.downloadUrl;
    if (!response.delivery?.id) {
      throw new NasCatalogueApiError('The server did not create a file delivery.');
    }
    onPreparing?.();
    return waitForDelivery({
      disposition,
      deliveryId: response.delivery.id,
      traceId,
    });
  };

  const requestDelivery = async (entry, disposition) => {
    const traceId = crypto.randomUUID();
    // Opening a blank tab during the click keeps an eventual inline PDF/image
    // open tied to the user's gesture instead of relying on a later popup.
    const preparedWindow = disposition === 'inline' ? window.open('', '_blank') : null;
    try {
      setDeliveringEntryId(entry.id);
      setError('');
      setDeliveryMessage(`${disposition === 'inline' ? 'Opening' : 'Preparing download for'} ${entry.name}. The NAS connector will upload it only if it is not already in the temporary cache.`);
      const downloadUrl = await prepareDeliveryUrl({
        entry,
        disposition,
        traceId,
        onPreparing: () => setDeliveryMessage(`The connector is preparing ${entry.name}. This page will continue automatically when it is ready.`),
      });
      if (disposition === 'inline') {
        if (!openPreparedFile(downloadUrl, preparedWindow)) {
          throw new NasCatalogueApiError('Your browser blocked the new file window. Please allow pop-ups and try again.');
        }
      } else {
        beginBrowserDownload(downloadUrl, entry.name);
      }
      setDeliveryMessage(`${entry.name} is ready.`);
    } catch (requestError) {
      console.error('[NAS delivery]', { traceId, step: 'delivery_failed', message: requestError.message });
      if (preparedWindow && !preparedWindow.closed) preparedWindow.close();
      setDeliveryMessage('');
      setError(requestError.message);
    } finally {
      setDeliveringEntryId('');
    }
  };

  const fetchDisplayImage = async (url, entryId, traceId) => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new NasCatalogueApiError('The prepared image could not be displayed.');
      }
      const total = Number(response.headers.get('content-length'));
      if (!response.body) {
        return { url, objectUrl: false };
      }
      const reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        if (Number.isFinite(total) && total > 0) {
          setLightbox((current) => (current?.entry.id === entryId ? {
            ...current,
            loadingLabel: `Loading ${Math.min(100, Math.round((received / total) * 100))}%`,
          } : current));
        }
      }
      const blob = new Blob(chunks, { type: response.headers.get('content-type') || 'image/*' });
      return { url: URL.createObjectURL(blob), objectUrl: true };
    } catch (fetchError) {
      // S3 CORS may be added after the first rollout. An <img> element can
      // still display a signed image URL without CORS, just without byte-level
      // progress, so retain that practical fallback for the trusted app.
      if (fetchError instanceof TypeError) {
        console.info('[NAS image]', { traceId, step: 'image_fetch_cors_fallback', entryId });
        return { url, objectUrl: false };
      }
      throw fetchError;
    }
  };

  const closeLightbox = () => {
    if (lightbox?.objectUrl && lightbox.imageUrl) URL.revokeObjectURL(lightbox.imageUrl);
    setLightbox(null);
  };

  const openImageLightbox = async (entry) => {
    const traceId = crypto.randomUUID();
    if (lightbox?.objectUrl && lightbox.imageUrl) URL.revokeObjectURL(lightbox.imageUrl);
    const thumbnailUrl = thumbnails[entry.id]?.url || '';
    setLightbox({
      entry,
      imageUrl: thumbnailUrl,
      objectUrl: false,
      isThumbnail: Boolean(thumbnailUrl),
      previous: null,
      next: null,
      loading: true,
      loadingLabel: thumbnailUrl ? 'Showing thumbnail while the full image is prepared...' : 'Preparing image...',
      error: '',
    });
    try {
      setDeliveringEntryId(entry.id);
      const imageUrl = await prepareDeliveryUrl({
        entry,
        disposition: 'inline',
        traceId,
        onPreparing: () => setLightbox((current) => (current?.entry.id === entry.id ? {
          ...current,
          loadingLabel: 'Preparing image from the NAS...',
        } : current)),
      });
      setLightbox((current) => (current?.entry.id === entry.id ? {
        ...current,
        loadingLabel: 'Loading image...',
      } : current));
      const display = await fetchDisplayImage(imageUrl, entry.id, traceId);
      setLightbox((current) => (current?.entry.id === entry.id ? {
        ...current,
        imageUrl: display.url,
        objectUrl: display.objectUrl,
        isThumbnail: false,
        loading: false,
        loadingLabel: '',
      } : current));
      const neighbors = await apiRequest(`/entries/${encodeURIComponent(entry.id)}/image-neighbors`);
      setLightbox((current) => (current?.entry.id === entry.id ? {
        ...current,
        previous: neighbors.previous || null,
        next: neighbors.next || null,
      } : current));
      console.info('[NAS image]', { traceId, step: 'image_ready', entryId: entry.id });
    } catch (requestError) {
      console.error('[NAS image]', { traceId, step: 'image_failed', entryId: entry.id, message: requestError.message });
      setLightbox((current) => (current?.entry.id === entry.id ? {
        ...current,
        loading: false,
        loadingLabel: '',
        error: requestError.message,
      } : current));
    } finally {
      setDeliveringEntryId('');
    }
  };

  const downloadLightboxImage = () => {
    if (lightbox?.entry) void requestDelivery(lightbox.entry, 'attachment');
  };

  useEffect(() => {
    if (!lightbox) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLightbox();
      } else if (event.key === 'ArrowLeft' && lightbox.previous && !lightbox.loading) {
        event.preventDefault();
        void openImageLightbox(lightbox.previous);
      } else if (event.key === 'ArrowRight' && lightbox.next && !lightbox.loading) {
        event.preventDefault();
        void openImageLightbox(lightbox.next);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightbox]);

  useEffect(() => {
    if (!lightbox) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [lightbox]);

  useEffect(() => {
    imageDragRef.current = null;
    imagePointersRef.current.clear();
    const initialImageView = { scale: MIN_IMAGE_ZOOM, x: 0, y: 0 };
    imageViewRef.current = initialImageView;
    setImageView(initialImageView);
  }, [lightbox?.entry.id]);

  const createImageGesture = () => {
    const viewport = imageViewportRef.current?.getBoundingClientRect();
    const pointers = Array.from(imagePointersRef.current, ([pointerId, point]) => ({ pointerId, ...point }));
    const imageViewAtStart = imageViewRef.current;
    if (!viewport || !pointers.length) {
      imageDragRef.current = null;
      return;
    }
    if (pointers.length === 1) {
      imageDragRef.current = {
        type: 'pan',
        pointerId: pointers[0].pointerId,
        startX: pointers[0].clientX,
        startY: pointers[0].clientY,
        originX: imageViewAtStart.x,
        originY: imageViewAtStart.y,
      };
      return;
    }
    const [firstPointer, secondPointer] = pointers;
    const firstX = firstPointer.clientX - viewport.left;
    const firstY = firstPointer.clientY - viewport.top;
    const secondX = secondPointer.clientX - viewport.left;
    const secondY = secondPointer.clientY - viewport.top;
    imageDragRef.current = {
      type: 'pinch',
      firstPointerId: firstPointer.pointerId,
      secondPointerId: secondPointer.pointerId,
      startDistance: Math.hypot(secondX - firstX, secondY - firstY),
      startCenterX: (firstX + secondX) / 2,
      startCenterY: (firstY + secondY) / 2,
      originX: imageViewAtStart.x,
      originY: imageViewAtStart.y,
      originScale: imageViewAtStart.scale,
    };
  };

  const zoomImageAtPointer = (event) => {
    event.stopPropagation();
    const viewport = imageViewportRef.current?.getBoundingClientRect();
    if (!viewport) return;

    const pointerX = event.clientX - viewport.left;
    const pointerY = event.clientY - viewport.top;
    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    setImageView((current) => {
      const scale = clamp(current.scale * zoomFactor, MIN_IMAGE_ZOOM, MAX_IMAGE_ZOOM);
      const scaleChange = scale / current.scale;
      const nextImageView = clampImagePosition({
        x: pointerX - ((pointerX - current.x) * scaleChange),
        y: pointerY - ((pointerY - current.y) * scaleChange),
        scale,
      }, viewport);
      imageViewRef.current = nextImageView;
      return nextImageView;
    });
  };

  const beginImageGesture = (event) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    imagePointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    createImageGesture();
  };

  const moveImageGesture = (event) => {
    if (!imagePointersRef.current.has(event.pointerId)) return;
    imagePointersRef.current.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    const gesture = imageDragRef.current;
    const viewport = imageViewportRef.current?.getBoundingClientRect();
    if (!gesture || !viewport) return;
    event.preventDefault();
    if (gesture.type === 'pinch') {
      const firstPointer = imagePointersRef.current.get(gesture.firstPointerId);
      const secondPointer = imagePointersRef.current.get(gesture.secondPointerId);
      if (!firstPointer || !secondPointer || gesture.startDistance === 0) return;
      const firstX = firstPointer.clientX - viewport.left;
      const firstY = firstPointer.clientY - viewport.top;
      const secondX = secondPointer.clientX - viewport.left;
      const secondY = secondPointer.clientY - viewport.top;
      const distance = Math.hypot(secondX - firstX, secondY - firstY);
      const centerX = (firstX + secondX) / 2;
      const centerY = (firstY + secondY) / 2;
      setImageView(() => {
        const scale = clamp(gesture.originScale * (distance / gesture.startDistance), MIN_IMAGE_ZOOM, MAX_IMAGE_ZOOM);
        const scaleChange = scale / gesture.originScale;
        const nextImageView = clampImagePosition({
          x: centerX - ((gesture.startCenterX - gesture.originX) * scaleChange),
          y: centerY - ((gesture.startCenterY - gesture.originY) * scaleChange),
          scale,
        }, viewport);
        imageViewRef.current = nextImageView;
        return nextImageView;
      });
      return;
    }
    if (gesture.pointerId !== event.pointerId || imageViewRef.current.scale <= MIN_IMAGE_ZOOM) return;
    setImageView((current) => {
      const nextImageView = clampImagePosition({
        x: gesture.originX + event.clientX - gesture.startX,
        y: gesture.originY + event.clientY - gesture.startY,
        scale: current.scale,
      }, viewport);
      imageViewRef.current = nextImageView;
      return nextImageView;
    });
  };

  const endImageGesture = (event) => {
    if (!imagePointersRef.current.has(event.pointerId)) return;
    imagePointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    createImageGesture();
  };

  const breadcrumbs = folder ? folder.split('/') : [];
  const visibleEntries = searchState ? searchState.entries : listing.entries;

  useEffect(() => {
    const images = visibleEntries.filter((entry) => entry.entryType === 'file' && entry.previewKind === 'image');
    if (!images.length) return undefined;
    let cancelled = false;
    let retryTimer;
    const requestThumbnails = async () => {
      const pending = [];
      await Promise.all(images.map(async (entry) => {
        try {
          const result = await apiRequest(`/entries/${encodeURIComponent(entry.id)}/thumbnails`, { method: 'POST' });
          if (cancelled) return;
          setThumbnails((current) => ({
            ...current,
            [entry.id]: { status: result.thumbnailStatus, url: result.thumbnailUrl || '' },
          }));
          if (result.thumbnailStatus !== 'ready') pending.push(entry);
        } catch (thumbnailError) {
          console.info('[NAS thumbnail]', { step: 'thumbnail_unavailable', entryId: entry.id, message: thumbnailError.message });
          // A thumbnail is prepared asynchronously. Keep polling after a
          // transient backend/S3 response instead of leaving a permanent
          // placeholder until the user manually refreshes the folder.
          pending.push(entry);
        }
      }));
      if (!cancelled && pending.length) {
        retryTimer = window.setTimeout(() => { void requestThumbnails(); }, 3_000);
      }
    };
    void requestThumbnails();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [visibleEntries]);

  return (
    <main className="file-server-page">
      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={chooseUploadFiles}
      />
      <header className="file-server-header">
        <div>
          <p className="file-server-eyebrow">Project workspace</p>
          <h1>NAS Files</h1>
          <p>Browse the indexed NAS catalogue. Files remain on the NAS until requested for delivery.</p>
        </div>
        <div className="file-server-header-actions">
          {activeRoot?.uploadsEnabled && !searchState && (
            <button
              className="file-server-button primary"
              type="button"
              disabled={Boolean(uploadState && !uploadState.finished) || !rootId}
              onClick={() => fileInputRef.current?.click()}
            >
              Upload here
            </button>
          )}
          <button className="file-server-button" onClick={() => { void loadRoots(); void loadFolder(); }} disabled={loading || loadingRoots}>
            Refresh
          </button>
        </div>
      </header>

      {error && <p className="file-server-message error" role="alert">{error}</p>}
      {shareMessage && <p className="file-server-message" role="status">{shareMessage}</p>}
      {deliveryMessage && <p className="file-server-message" role="status">{deliveryMessage}</p>}
      {uploadState && (
        <div className="file-server-upload-progress" role="status">
          <strong>{uploadState.fileName}</strong>
          <span>{uploadState.status}</span>
          <progress value={uploadState.uploadedBytes} max={uploadState.totalBytes || 1} />
          <span>{formatBytes(uploadState.uploadedBytes)} of {formatBytes(uploadState.totalBytes)}</span>
        </div>
      )}

      {loadingRoots ? <p className="file-server-empty">Loading NAS roots…</p> : (
        <section className="file-server-toolbar" aria-label="NAS catalogue controls">
          <label className="file-server-field">
            NAS root
            <select value={rootId} onChange={(event) => selectRoot(event.target.value)} disabled={!roots.length}>
              {!roots.length && <option value="">No indexed NAS roots are available</option>}
              {roots.map((root) => <option key={root.id} value={root.id}>{root.name}{root.availability === 'offline' ? ' (connector offline)' : ''}</option>)}
            </select>
          </label>
          <form className="file-server-new-folder" onSubmit={(event) => void runSearch(event)}>
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search this NAS root" aria-label="Search this NAS root" />
            <button className="file-server-button" type="submit" disabled={!rootId || loading}>Search</button>
            {searchState && <button className="file-server-button ghost" type="button" onClick={clearSearch}>Clear search</button>}
          </form>
        </section>
      )}

      {activeRoot && (
        <p className="file-server-muted">
          {activeRoot.availability === 'offline' ? 'The connector is offline; the catalogue may not reflect recent NAS changes.' : 'Catalogue is connected to the NAS.'}
          {' Last full scan: '}{formatDate(activeRoot.lastFullScanAt)}.
        </p>
      )}

      {!searchState && (
        <nav className="file-server-breadcrumbs" aria-label="NAS file location">
          <button className="file-server-crumb" onClick={() => setFolder('')}>NAS Files</button>
          {breadcrumbs.map((segment, index) => {
            const path = breadcrumbs.slice(0, index + 1).join('/');
            return (
              <span key={path}>
                <span aria-hidden="true">/</span>
                <button className="file-server-crumb" onClick={() => setFolder(path)}>{segment}</button>
              </span>
            );
          })}
        </nav>
      )}

      <section className="file-server-browser" aria-label="NAS file browser">
        <div className="file-server-browser-heading">
          <span>{searchState ? `Search results for “${searchState.query}”` : 'Name'}</span><span>Size</span><span>Modified</span><span>Actions</span>
        </div>
        {loading ? <p className="file-server-empty">Loading catalogue…</p> : (
          <>
            {visibleEntries.map((entry) => (
              <article className={`file-server-row ${entry.entryType === 'folder' ? 'folder' : ''}`} key={entry.id}>
                {entry.entryType === 'folder' ? (
                  <button className="file-server-name-button" onClick={() => setFolder(entry.relativePath)}>
                    {renderNasEntryIcon(entry)}
                    <span className="file-server-file-name">{entry.name}</span>
                  </button>
                ) : (
                  <div className="nas-file-name-cell">
                    {entry.previewKind === 'image' && (
                      thumbnails[entry.id]?.url
                        ? <img className="nas-file-thumbnail" src={thumbnails[entry.id].url} alt="" />
                        : <span className="nas-file-thumbnail placeholder" aria-label="Thumbnail preparing">Image</span>
                    )}
                    {entry.previewKind !== 'image' && renderNasEntryIcon(entry)}
                    <div className="file-server-file-name">{entry.name}</div>
                  </div>
                )}
                <span>{entry.entryType === 'folder' ? 'Folder' : formatBytes(entry.sizeBytes)}</span>
                <span>{formatDate(entry.modifiedAt)}</span>
                <div className="file-server-row-actions">
                  {searchState && <button className="file-server-button compact" onClick={() => openEntryLocation(entry)}>Show location</button>}
                  {entry.entryType === 'file' && (
                    <>
                    <button
                      className="file-server-button compact"
                      type="button"
                      disabled={Boolean(deliveringEntryId) || Boolean(sharingEntryId)}
                      onClick={() => (entry.previewKind === 'image'
                        ? void openImageLightbox(entry)
                        : void requestDelivery(entry, 'inline'))}
                    >
                      {deliveringEntryId === entry.id ? 'Preparing...' : (entry.previewKind === 'image' ? 'View' : 'Open')}
                    </button>
                    <button
                      className="file-server-button compact"
                      type="button"
                      disabled={Boolean(deliveringEntryId) || Boolean(sharingEntryId)}
                      onClick={() => void requestDelivery(entry, 'attachment')}
                    >
                      Download
                    </button>
                    <button
                      className="file-server-button compact"
                      type="button"
                      disabled={Boolean(deliveringEntryId) || Boolean(sharingEntryId)}
                      onClick={() => void createShare(entry)}
                    >
                      {sharingEntryId === entry.id ? 'Preparing share…' : 'Share'}
                    </button>
                    </>
                  )}
                </div>
              </article>
            ))}
            {!visibleEntries.length && <p className="file-server-empty">{searchState ? 'No matching NAS entries.' : 'This folder is empty.'}</p>}
          </>
        )}
      </section>

      {!searchState && listing.nextCursor && (
        <button className="file-server-button file-server-load-more" disabled={loadingMore} onClick={() => void loadFolder({ cursor: listing.nextCursor, append: true })}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
      {lightbox && (
        <section className="nas-image-lightbox" role="dialog" aria-modal="true" aria-label={`Image preview: ${lightbox.entry.name}`}>
          <header className="nas-image-lightbox-header">
            <div className="nas-image-lightbox-actions">
              <button className="nas-image-icon-button" type="button" onClick={downloadLightboxImage} title="Download image" aria-label="Download image">&#8595;</button>
              <button className="nas-image-icon-button" type="button" onClick={closeLightbox} autoFocus title="Close image viewer" aria-label="Close image viewer">&#215;</button>
            </div>
          </header>
          <div className="nas-image-lightbox-content" ref={imageViewportRef} onClick={closeLightbox}>
            {lightbox.loading && <p className="nas-image-lightbox-loading" role="status">{lightbox.loadingLabel || 'Loading image...'}</p>}
            {lightbox.error && <p className="nas-image-lightbox-error" role="alert">{lightbox.error}</p>}
            {!lightbox.error && lightbox.imageUrl && (
              <img
                className="nas-image-lightbox-image"
                src={lightbox.imageUrl}
                alt={lightbox.entry.name}
                style={{ transform: `translate3d(${imageView.x}px, ${imageView.y}px, 0) scale(${imageView.scale})` }}
                onWheel={zoomImageAtPointer}
                onPointerDown={beginImageGesture}
                onPointerMove={moveImageGesture}
                onPointerUp={endImageGesture}
                onPointerCancel={endImageGesture}
                onClick={(event) => event.stopPropagation()}
              />
            )}
          </div>
          <footer className="nas-image-lightbox-nav">
            <button type="button" onClick={() => void openImageLightbox(lightbox.previous)} disabled={!lightbox.previous || lightbox.loading}>Previous</button>
            <span>{lightbox.entry.name}</span>
            <button type="button" onClick={() => void openImageLightbox(lightbox.next)} disabled={!lightbox.next || lightbox.loading}>Next</button>
          </footer>
        </section>
      )}
    </main>
  );
}

export default NasFileBrowser;
