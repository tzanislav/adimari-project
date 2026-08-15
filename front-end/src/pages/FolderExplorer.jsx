import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelDownloadRequest,
  createDownloadRequest,
  createShareLink,
  downloadCompletedFile,
  getDownloadRequests,
  getFolderPage,
  getStorageNodes,
  uploadFiles,
} from '../utils/fileSyncApi';
import FileExplorerImageLightbox from '../components/FileExplorerImageLightbox';
import '../CSS/FileServer.css';

const ROOT_PATH = '';
const CANCELLABLE_STATUSES = new Set(['Requested', 'Accepted', 'Queued', 'Uploading']);
const IMAGE_FILE_PATTERN = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const FILE_ICON_DIRECTORY = '/File%20Icons/';
const FILE_ICON_ALIASES = { docx: 'doc', xlsx: 'xls', xlsm: 'xls' };
const BROWSER_VIEWABLE_CONTENT_TYPES = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  csv: 'text/csv',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  json: 'application/json',
  pdf: 'application/pdf',
  png: 'image/png',
  txt: 'text/plain',
  webp: 'image/webp',
};

function FolderExplorer() {
  const [storageNodes, setStorageNodes] = useState([]);
  const [storageNodeId, setStorageNodeId] = useState('');
  const [currentPath, setCurrentPath] = useState(ROOT_PATH);
  const [entries, setEntries] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [requests, setRequests] = useState([]);
  const [isLoadingNodes, setIsLoadingNodes] = useState(true);
  const [isLoadingFolder, setIsLoadingFolder] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [requestingPaths, setRequestingPaths] = useState([]);
  const [sharingPaths, setSharingPaths] = useState([]);
  const [shareUploadPaths, setShareUploadPaths] = useState([]);
  const [copiedSharePath, setCopiedSharePath] = useState(null);
  const [downloadingRequestIds, setDownloadingRequestIds] = useState([]);
  const [cancellingRequestIds, setCancellingRequestIds] = useState([]);
  const [previewEntry, setPreviewEntry] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewRequestId, setPreviewRequestId] = useState(null);
  const [previewDownloadRequest, setPreviewDownloadRequest] = useState(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [uploadState, setUploadState] = useState(null);
  const [isRecentDeliveriesExpanded, setIsRecentDeliveriesExpanded] = useState(false);
  const requestSequence = useRef(0);
  const previewObjectUrl = useRef(null);
  const previewLoadSequence = useRef(0);
  const previewPath = useRef(null);
  const automaticDeliveryWindows = useRef(new Map());
  const shareDeliveriesAwaitingCompletion = useRef(new Map());
  const uploadInputRef = useRef(null);
  const currentLocationRef = useRef({ storageNodeId, currentPath });
  const uploadRefreshTimerIds = useRef(new Set());
  const preservePathOnStorageNodeChange = useRef(false);
  const hasInitializedBrowserHistory = useRef(false);
  const shareCopyTimerId = useRef(null);

  useEffect(() => {
    currentLocationRef.current = { storageNodeId, currentPath };
  }, [currentPath, storageNodeId]);

  const revokePreviewUrl = useCallback(() => {
    if (previewObjectUrl.current) {
      URL.revokeObjectURL(previewObjectUrl.current);
      previewObjectUrl.current = null;
    }
  }, []);

  const loadStorageNodes = useCallback(async () => {
    setIsLoadingNodes(true);

    try {
      const nodes = await getStorageNodes();
      setStorageNodes(nodes);
      setStorageNodeId((currentNodeId) => nodes.includes(currentNodeId) ? currentNodeId : (nodes[0] || ''));
      setError('');
    } catch (loadError) {
      setError(toUserMessage(loadError, 'Could not load NAS storage nodes.'));
    } finally {
      setIsLoadingNodes(false);
    }
  }, []);

  const loadFolder = useCallback(async (nodeId, parentPath, cursor = null, append = false) => {
    if (!nodeId) {
      setEntries([]);
      setNextCursor(null);
      setHasMore(false);
      return;
    }

    const sequence = ++requestSequence.current;
    append ? setIsLoadingMore(true) : setIsLoadingFolder(true);

    try {
      const page = await getFolderPage(nodeId, parentPath, cursor);

      if (sequence !== requestSequence.current) {
        return;
      }

      setEntries((currentEntries) => append ? [...currentEntries, ...page.entries] : page.entries);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setError('');
      return page;
    } catch (loadError) {
      if (sequence === requestSequence.current) {
        setError(toUserMessage(loadError, 'Could not load this NAS folder.'));
      }
      return null;
    } finally {
      if (sequence === requestSequence.current) {
        append ? setIsLoadingMore(false) : setIsLoadingFolder(false);
      }
    }
  }, []);

  const loadRequests = useCallback(async (nodeId) => {
    if (!nodeId) {
      setRequests([]);
      return;
    }

    try {
      setRequests(await getDownloadRequests(nodeId));
    } catch (loadError) {
      setError(toUserMessage(loadError, 'Could not refresh file delivery status.'));
    }
  }, []);

  useEffect(() => {
    void loadStorageNodes();
  }, [loadStorageNodes]);

  useEffect(() => {
    requestSequence.current += 1;
    if (preservePathOnStorageNodeChange.current) {
      preservePathOnStorageNodeChange.current = false;
      return;
    }
    setCurrentPath(ROOT_PATH);
    setEntries([]);
    setNextCursor(null);
    setHasMore(false);
  }, [storageNodeId]);

  useEffect(() => {
    void loadFolder(storageNodeId, currentPath);
  }, [currentPath, loadFolder, storageNodeId]);

  useEffect(() => {
    void loadRequests(storageNodeId);

    if (!storageNodeId) {
      return undefined;
    }

    const refreshTimer = window.setInterval(() => void loadRequests(storageNodeId), 2000);
    return () => window.clearInterval(refreshTimer);
  }, [loadRequests, storageNodeId]);

  useEffect(() => () => revokePreviewUrl(), [revokePreviewUrl]);
  useEffect(() => () => {
    uploadRefreshTimerIds.current.forEach((timerId) => window.clearTimeout(timerId));
    uploadRefreshTimerIds.current.clear();
    shareDeliveriesAwaitingCompletion.current.clear();
    if (shareCopyTimerId.current !== null) {
      window.clearTimeout(shareCopyTimerId.current);
    }
  }, []);

  const requestsByPath = useMemo(() => new Map(requests.map((request) => [request.relativePath, request])), [requests]);
  const imageEntries = useMemo(() => entries.filter((entry) => !entry.isDirectory && isPreviewableImage(entry.name)), [entries]);
  const breadcrumbs = getBreadcrumbs(currentPath);
  const previewIndex = previewEntry ? imageEntries.findIndex((entry) => entry.relativePath === previewEntry.relativePath) : -1;

  const loadPreviewImage = useCallback(async (request, relativePath) => {
    const sequence = ++previewLoadSequence.current;
    setPreviewRequestId(null);
    setPreviewDownloadRequest(request);
    setIsPreviewLoading(true);
    setPreviewError('');

    try {
      const imageFile = await downloadCompletedFile(request.requestId);
      const previewFile = new Blob([imageFile], { type: getImageContentType(relativePath) });
      const objectUrl = URL.createObjectURL(previewFile);

      if (sequence !== previewLoadSequence.current || previewPath.current !== relativePath) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

      revokePreviewUrl();
      previewObjectUrl.current = objectUrl;
      setPreviewUrl(objectUrl);
    } catch (loadError) {
      if (sequence === previewLoadSequence.current && previewPath.current === relativePath) {
        setPreviewError(toUserMessage(loadError, 'The image preview could not be loaded.'));
      }
    } finally {
      if (sequence === previewLoadSequence.current && previewPath.current === relativePath) {
        setIsPreviewLoading(false);
      }
    }
  }, [revokePreviewUrl]);

  const closePreview = () => {
    previewLoadSequence.current += 1;
    previewPath.current = null;
    revokePreviewUrl();
    setPreviewEntry(null);
    setPreviewUrl('');
    setPreviewRequestId(null);
    setPreviewDownloadRequest(null);
    setIsPreviewLoading(false);
    setPreviewError('');
  };

  const openImagePreview = async (entry) => {
    previewLoadSequence.current += 1;
    previewPath.current = entry.relativePath;
    revokePreviewUrl();
    setPreviewEntry(entry);
    setPreviewUrl('');
    setPreviewRequestId(null);
    setPreviewDownloadRequest(null);
    setPreviewError('');

    const existingRequest = requestsByPath.get(entry.relativePath);

    if (existingRequest?.status === 'Ready') {
      void loadPreviewImage(existingRequest, entry.relativePath);
      return;
    }

    if (existingRequest && CANCELLABLE_STATUSES.has(existingRequest.status)) {
      setPreviewRequestId(existingRequest.requestId);
      setIsPreviewLoading(true);
      return;
    }

    setIsPreviewLoading(true);
    setRequestingPaths((paths) => [...paths, entry.relativePath]);

    try {
      const request = await createDownloadRequest(storageNodeId, entry.relativePath);
      setRequests((currentRequests) => [request, ...currentRequests.filter((currentRequest) => currentRequest.requestId !== request.requestId)]);

      if (previewPath.current !== entry.relativePath) {
        return;
      }

      if (request.status === 'Ready') {
        void loadPreviewImage(request, entry.relativePath);
      } else if (CANCELLABLE_STATUSES.has(request.status)) {
        setPreviewRequestId(request.requestId);
      } else {
        setPreviewError('The image preview could not be requested.');
        setIsPreviewLoading(false);
      }
    } catch (previewRequestError) {
      if (previewPath.current === entry.relativePath) {
        setPreviewError(toUserMessage(previewRequestError, 'The image preview could not be requested.'));
        setIsPreviewLoading(false);
      }
    } finally {
      setRequestingPaths((paths) => paths.filter((path) => path !== entry.relativePath));
    }
  };

  useEffect(() => {
    if (!previewEntry || !previewRequestId) {
      return;
    }

    const previewRequest = requests.find((request) => request.requestId === previewRequestId);

    if (!previewRequest) {
      return;
    }

    if (previewRequest.status === 'Ready') {
      void loadPreviewImage(previewRequest, previewEntry.relativePath);
    } else if (previewRequest.status === 'Failed' || previewRequest.status === 'Cancelled') {
      setPreviewRequestId(null);
      setIsPreviewLoading(false);
      setPreviewError('The image preview could not be delivered.');
    }
  }, [loadPreviewImage, previewEntry, previewRequestId, requests]);

  const navigateToFolder = useCallback((folderPath, { targetStorageNodeId = storageNodeId, historyAction = 'push' } = {}) => {
    requestSequence.current += 1;
    if (targetStorageNodeId !== storageNodeId) {
      preservePathOnStorageNodeChange.current = true;
      setStorageNodeId(targetStorageNodeId);
    }
    setCurrentPath(folderPath);
    setEntries([]);
    setNextCursor(null);
    setHasMore(false);

    if (historyAction !== 'none') {
      const browserState = window.history.state && typeof window.history.state === 'object'
        ? window.history.state
        : {};
      const nextState = {
        ...browserState,
        folderExplorer: { storageNodeId: targetStorageNodeId, currentPath: folderPath },
      };

      if (historyAction === 'replace') {
        window.history.replaceState(nextState, '', window.location.href);
      } else {
        window.history.pushState(nextState, '', window.location.href);
      }
    }
  }, [storageNodeId]);

  useEffect(() => {
    if (!storageNodeId || hasInitializedBrowserHistory.current) {
      return;
    }

    if (!window.history.state?.folderExplorer) {
      const browserState = window.history.state && typeof window.history.state === 'object'
        ? window.history.state
        : {};
      window.history.replaceState({
        ...browserState,
        folderExplorer: { storageNodeId, currentPath },
      }, '', window.location.href);
    }

    hasInitializedBrowserHistory.current = true;
  }, [currentPath, storageNodeId]);

  useEffect(() => {
    const handlePopState = (event) => {
      const savedLocation = event.state?.folderExplorer;

      navigateToFolder(savedLocation?.currentPath || ROOT_PATH, {
        targetStorageNodeId: savedLocation?.storageNodeId || storageNodeId,
        historyAction: 'none',
      });
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [navigateToFolder, storageNodeId]);

  const handleDownload = useCallback(async (request, viewerWindow = null) => {
    setDownloadingRequestIds((ids) => [...ids, request.requestId]);
    setNotice('');

    try {
      const file = await downloadCompletedFile(request.requestId);
      const contentType = getBrowserContentType(request.fileName) || 'application/octet-stream';
      const objectUrl = URL.createObjectURL(new Blob([file], { type: contentType }));

      if (isBrowserViewableFile(request.fileName) && viewerWindow && !viewerWindow.closed) {
        viewerWindow.location.replace(objectUrl);
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        setNotice(`${request.fileName} opened in a new browser tab.`);
      } else {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = request.fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
        setNotice(`${request.fileName} download started.`);
      }
    } catch (downloadError) {
      if (viewerWindow && !viewerWindow.closed) {
        viewerWindow.close();
      }
      setError(toUserMessage(downloadError, `Could not download ${request.fileName}.`));
    } finally {
      setDownloadingRequestIds((ids) => ids.filter((id) => id !== request.requestId));
    }
  }, []);

  useEffect(() => {
    for (const request of requests) {
      if (!automaticDeliveryWindows.current.has(request.requestId)) {
        continue;
      }

      const viewerWindow = automaticDeliveryWindows.current.get(request.requestId);

      if (request.status === 'Ready') {
        automaticDeliveryWindows.current.delete(request.requestId);
        void handleDownload(request, viewerWindow);
      } else if (request.status === 'Failed' || request.status === 'Cancelled') {
        automaticDeliveryWindows.current.delete(request.requestId);
        if (viewerWindow && !viewerWindow.closed) {
          viewerWindow.close();
        }
        setError(`The delivery for ${request.fileName} did not complete.`);
      }
    }
  }, [handleDownload, requests]);

  const handleRequestDownload = async (entry) => {
    setRequestingPaths((paths) => [...paths, entry.relativePath]);
    setNotice('');
    const viewerWindow = openBrowserViewer(entry.name);

    try {
      const request = await createDownloadRequest(storageNodeId, entry.relativePath);
      setRequests((currentRequests) => [request, ...currentRequests.filter((currentRequest) => currentRequest.requestId !== request.requestId)]);

      if (request.status === 'Ready') {
        void handleDownload(request, viewerWindow);
        setError('');
      } else if (CANCELLABLE_STATUSES.has(request.status)) {
        automaticDeliveryWindows.current.set(request.requestId, viewerWindow);
        setNotice(`${entry.name} was sent to the NAS and will open or download when ready.`);
        setError('');
      } else {
        if (viewerWindow && !viewerWindow.closed) {
          viewerWindow.close();
        }
        setError(`The delivery for ${entry.name} could not be requested.`);
      }
    } catch (requestError) {
      if (viewerWindow && !viewerWindow.closed) {
        viewerWindow.close();
      }
      setError(toUserMessage(requestError, `Could not request ${entry.name}.`));
    } finally {
      setRequestingPaths((paths) => paths.filter((path) => path !== entry.relativePath));
    }
  };

  const createAndCopyShare = useCallback(async (entry, targetStorageNodeId) => {
    try {
      const share = await createShareLink(targetStorageNodeId, entry.relativePath);
      await copyToClipboard(share.url);

      if (shareCopyTimerId.current !== null) {
        window.clearTimeout(shareCopyTimerId.current);
      }

      setCopiedSharePath(entry.relativePath);
      shareCopyTimerId.current = window.setTimeout(() => {
        setCopiedSharePath(null);
        shareCopyTimerId.current = null;
      }, 3000);
      setNotice(`Share link for ${entry.name} copied to the clipboard.`);
    } catch (shareError) {
      setError(toUserMessage(shareError, `Could not create a share link for ${entry.name}.`));
    } finally {
      setSharingPaths((paths) => paths.filter((path) => path !== entry.relativePath));
      setShareUploadPaths((paths) => paths.filter((path) => path !== entry.relativePath));
    }
  }, []);

  useEffect(() => {
    for (const request of requests) {
      const pendingShare = shareDeliveriesAwaitingCompletion.current.get(request.requestId);
      if (!pendingShare) {
        continue;
      }

      if (request.status === 'Ready') {
        shareDeliveriesAwaitingCompletion.current.delete(request.requestId);
        setShareUploadPaths((paths) => paths.filter((path) => path !== pendingShare.entry.relativePath));
        void createAndCopyShare(pendingShare.entry, pendingShare.storageNodeId);
      } else if (request.status === 'Failed' || request.status === 'Cancelled') {
        shareDeliveriesAwaitingCompletion.current.delete(request.requestId);
        setSharingPaths((paths) => paths.filter((path) => path !== pendingShare.entry.relativePath));
        setShareUploadPaths((paths) => paths.filter((path) => path !== pendingShare.entry.relativePath));
        setError(`The upload needed to share ${pendingShare.entry.name} did not complete.`);
      }
    }
  }, [createAndCopyShare, requests]);

  const handleShare = async (entry) => {
    if (!storageNodeId) {
      return;
    }

    setSharingPaths((paths) => [...paths, entry.relativePath]);
    setError('');
    setNotice('');

    if (entry.isCached) {
      await createAndCopyShare(entry, storageNodeId);
      return;
    }

    const existingRequest = requestsByPath.get(entry.relativePath);
    if (existingRequest?.status === 'Ready') {
      await createAndCopyShare(entry, storageNodeId);
      return;
    }

    try {
      const request = existingRequest && CANCELLABLE_STATUSES.has(existingRequest.status)
        ? existingRequest
        : await createDownloadRequest(storageNodeId, entry.relativePath);

      if (request !== existingRequest) {
        setRequests((currentRequests) => [request, ...currentRequests.filter((currentRequest) => currentRequest.requestId !== request.requestId)]);
      }

      if (request.status === 'Ready') {
        await createAndCopyShare(entry, storageNodeId);
      } else if (CANCELLABLE_STATUSES.has(request.status)) {
        shareDeliveriesAwaitingCompletion.current.set(request.requestId, { entry, storageNodeId });
        setShareUploadPaths((paths) => [...paths, entry.relativePath]);
        setNotice(`${entry.name} is uploading to S3. Its share link will be copied when ready.`);
      } else {
        setError(`The upload needed to share ${entry.name} could not be requested.`);
        setSharingPaths((paths) => paths.filter((path) => path !== entry.relativePath));
      }
    } catch (shareError) {
      setError(toUserMessage(shareError, `Could not upload ${entry.name} for sharing.`));
      setSharingPaths((paths) => paths.filter((path) => path !== entry.relativePath));
    }
  };

  const handleCancel = async (request) => {
    setCancellingRequestIds((ids) => [...ids, request.requestId]);

    try {
      const cancelledRequest = await cancelDownloadRequest(request.requestId);
      setRequests((currentRequests) => currentRequests.map((currentRequest) =>
        currentRequest.requestId === cancelledRequest.requestId ? cancelledRequest : currentRequest));
      setNotice(`${request.fileName} delivery was cancelled.`);
    } catch (cancelError) {
      setError(toUserMessage(cancelError, `Could not cancel ${request.fileName}.`));
    } finally {
      setCancellingRequestIds((ids) => ids.filter((id) => id !== request.requestId));
    }
  };

  const refreshCurrentView = () => {
    void loadStorageNodes();
    void loadFolder(storageNodeId, currentPath);
    void loadRequests(storageNodeId);
  };

  const refreshUploadedFolder = useCallback((targetStorageNodeId, targetFolderPath) => {
    let attempt = 0;

    const refresh = async () => {
      const currentLocation = currentLocationRef.current;
      if (currentLocation.storageNodeId !== targetStorageNodeId || currentLocation.currentPath !== targetFolderPath) {
        return;
      }

      await loadFolder(targetStorageNodeId, targetFolderPath);
      attempt += 1;

      if (attempt < 8) {
        const timerId = window.setTimeout(() => {
          uploadRefreshTimerIds.current.delete(timerId);
          void refresh();
        }, 1_000);
        uploadRefreshTimerIds.current.add(timerId);
      }
    };

    void refresh();
  }, [loadFolder]);

  const queueFilesForUpload = async (fileList) => {
    const files = Array.from(fileList || []);

    if (!storageNodeId || !files.length || isUploadingFiles) {
      return;
    }

    const targetStorageNodeId = storageNodeId;
    const targetFolderPath = currentPath;
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    uploadRefreshTimerIds.current.forEach((timerId) => window.clearTimeout(timerId));
    uploadRefreshTimerIds.current.clear();
    setIsUploadingFiles(true);
    setError('');
    setNotice('');
    setUploadState({
      phase: 'Preparing files for upload',
      uploadedBytes: 0,
      totalBytes,
      files: files.map((file) => ({ name: file.name, size: file.size, status: 'Waiting to upload' })),
    });

    try {
      const results = await uploadFiles(targetStorageNodeId, targetFolderPath, files, {
        onProgress: (loadedBytes) => {
          const payloadBytes = Math.min(loadedBytes, totalBytes);
          let bytesBeforeFile = 0;

          setUploadState({
            phase: 'Sending files to File Sync',
            uploadedBytes: payloadBytes,
            totalBytes,
            files: files.map((file) => {
              const fileEndByte = bytesBeforeFile + file.size;
              const status = payloadBytes >= fileEndByte
                ? 'Received by File Sync'
                : payloadBytes > bytesBeforeFile
                  ? 'Uploading to File Sync'
                  : 'Waiting to upload';
              bytesBeforeFile = fileEndByte;
              return { name: file.name, size: file.size, status };
            }),
          });
        },
        onRequestBodyUploaded: () => {
          setUploadState({
            phase: 'Saving files to the NAS folder',
            uploadedBytes: totalBytes,
            totalBytes,
            files: files.map((file) => ({ name: file.name, size: file.size, status: 'Waiting for NAS agent' })),
          });
        },
      });
      const uploaded = results.filter((result) => result.isUploaded);
      const failed = results.filter((result) => !result.isUploaded);

      setUploadState({
        phase: failed.length ? 'Upload finished with issues' : 'Upload complete',
        uploadedBytes: totalBytes,
        totalBytes,
        files: files.map((file, index) => {
          const result = results[index];
          return {
            name: file.name,
            size: file.size,
            status: result?.isUploaded ? 'Saved to NAS' : result?.errorMessage || 'Upload failed',
            isFailed: Boolean(result && !result.isUploaded),
          };
        }),
      });

      if (uploaded.length) {
        setNotice(`Uploaded ${uploaded.length} file${uploaded.length === 1 ? '' : 's'} to ${targetFolderPath || 'the NAS root folder'}.`);
      }

      if (failed.length) {
        const failedNames = failed.slice(0, 3).map((result) => result.fileName).join(', ');
        const remainingFailureCount = failed.length - 3;
        setError(`${failed.length} file${failed.length === 1 ? '' : 's'} could not be uploaded: ${failedNames}${remainingFailureCount > 0 ? ` and ${remainingFailureCount} more` : ''}.`);
      }

      const currentLocation = currentLocationRef.current;
      if (uploaded.length &&
          currentLocation.storageNodeId === targetStorageNodeId &&
          currentLocation.currentPath === targetFolderPath) {
        refreshUploadedFolder(targetStorageNodeId, targetFolderPath);
      }
    } catch (uploadError) {
      setUploadState((currentState) => currentState && {
        ...currentState,
        phase: 'Upload failed',
        files: currentState.files.map((file) => ({ ...file, status: 'Upload failed', isFailed: true })),
      });
      setError(toUserMessage(uploadError, 'Could not upload the selected files to this NAS folder.'));
    } finally {
      setIsUploadingFiles(false);
    }
  };

  return (
    <>
      <main className="file-server-page">
      <header className="file-server-header">
        <div>
          <p className="file-server-eyebrow">Project workspace</p>
          <h1>Folder Explorer</h1>
          <p>Browse the published NAS catalog and request files for secure delivery.</p>
        </div>
        <div className="file-server-header-actions">
          <button className="file-server-button" type="button" onClick={refreshCurrentView} disabled={isLoadingNodes || isLoadingFolder}>
            Refresh
          </button>
        </div>
      </header>

      <section className="folder-explorer-controls" aria-label="NAS storage node">
        <label className="file-server-field">
          NAS storage node
          <select value={storageNodeId} onChange={(event) => navigateToFolder(ROOT_PATH, { targetStorageNodeId: event.target.value })} disabled={isLoadingNodes || storageNodes.length === 0}>
            {storageNodes.map((nodeId) => <option key={nodeId} value={nodeId}>{nodeId}</option>)}
          </select>
        </label>
        {!isLoadingNodes && storageNodes.length === 0 && <p className="file-server-muted">No NAS catalog is available yet.</p>}
      </section>

      {error && <p className="file-server-message error" role="alert">{error}</p>}
      {notice && <p className="file-server-message success" role="status">{notice}</p>}

      <section className="folder-explorer-upload" aria-label="Upload files to the current NAS folder">
        <div className="folder-explorer-upload-heading">
          <div>
            <h2>Upload to this folder</h2>
            <p>Choose or drag multiple files. They will be saved to the folder shown below.</p>
          </div>
          <button
            className="file-server-button primary"
            type="button"
            disabled={!storageNodeId || isUploadingFiles}
            onClick={() => uploadInputRef.current?.click()}
          >
            {isUploadingFiles ? 'Uploading filesâ€¦' : 'Choose files'}
          </button>
          <input
            ref={uploadInputRef}
            className="file-server-visually-hidden"
            type="file"
            multiple
            disabled={!storageNodeId || isUploadingFiles}
            onChange={(event) => {
              void queueFilesForUpload(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
        <div
          className={`file-server-dropzone folder-explorer-dropzone ${isDraggingFiles ? 'is-dragging' : ''}${!storageNodeId || isUploadingFiles ? ' is-disabled' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!isUploadingFiles && storageNodeId) setIsDraggingFiles(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDraggingFiles(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDraggingFiles(false);
            void queueFilesForUpload(event.dataTransfer.files);
          }}
        >
          <strong>Drop files here to upload</strong>
          <span>{isUploadingFiles ? 'Uploading the selected filesâ€¦' : 'Multiple files and phone photo selections are supported.'}</span>
        </div>
        {uploadState && (
          <section className={`folder-explorer-upload-status${uploadState.phase.includes('failed') || uploadState.phase.includes('issues') ? ' has-failures' : ''}`} aria-live="polite">
            <div className="folder-explorer-upload-progress">
              <div>
                <strong>{uploadState.phase}</strong>
                <span>{formatBytes(uploadState.uploadedBytes)} of {formatBytes(uploadState.totalBytes)}</span>
              </div>
              <progress value={uploadState.uploadedBytes} max={uploadState.totalBytes || 1} />
            </div>
            <ul>
              {uploadState.files.map((file, index) => (
                <li key={`${file.name}-${index}`} className={file.isFailed ? 'failed' : ''}>
                  <span><strong>{file.name}</strong> <em>{formatBytes(file.size)}</em></span>
                  <span>{file.status}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>

      <nav className="file-server-breadcrumbs" aria-label="NAS folder location">
        <button className="file-server-crumb" type="button" onClick={() => navigateToFolder(ROOT_PATH)}>NAS files</button>
        {breadcrumbs.map((crumb) => (
          <span key={crumb.path}>
            <span aria-hidden="true">/</span>{' '}
            <button className="file-server-crumb" type="button" onClick={() => navigateToFolder(crumb.path)}>{crumb.name}</button>
          </span>
        ))}
      </nav>

      <section className="file-server-browser folder-explorer-browser" aria-label="NAS folder explorer">
        <div className="file-server-browser-heading">
          <span>Name</span><span>Size</span><span>Modified</span><span>Status</span><span>Actions</span>
        </div>
        {isLoadingFolder ? <p className="file-server-empty">Loading folder…</p> : (
          <>
            {entries.map((entry) => {
              const entryRequest = requestsByPath.get(entry.relativePath);
              const isRequesting = requestingPaths.includes(entry.relativePath);

              return entry.isDirectory ? (
                <article className="file-server-row folder" key={entry.relativePath}>
                  <button className="file-server-name-button" type="button" onClick={() => navigateToFolder(entry.relativePath)}>
                    <FileIcon entry={entry} /><span className="file-server-file-name">{entry.name}</span>
                  </button>
                  <span>Folder</span>
                  <span>{formatDate(entry.lastModifiedUtc)}</span>
                  <span className="folder-explorer-status">Available</span>
                  <div className="file-server-row-actions"><button className="file-server-button compact" type="button" onClick={() => navigateToFolder(entry.relativePath)}>Open</button></div>
                </article>
              ) : (
                <article className={`file-server-row${isPreviewableImage(entry.name) ? ' image-file' : ''}`} key={entry.relativePath}>
                  {isPreviewableImage(entry.name) ? (
                    <button className="file-server-name-button" type="button" onClick={() => void openImagePreview(entry)} aria-label={`Preview ${entry.name}`}>
                      <FileIcon entry={entry} /><span className="file-server-file-name">{entry.name}</span>
                    </button>
                  ) : <div className="file-server-file-name file-explorer-entry-name"><FileIcon entry={entry} /> {entry.name}</div>}
                  <span>{formatBytes(entry.sizeBytes)}</span>
                  <span>{formatDate(entry.lastModifiedUtc)}</span>
                  <span className={`folder-explorer-status ${getEntryStatus(entryRequest, isRequesting).toLowerCase()}`}>
                    {getEntryStatus(entryRequest, isRequesting)}
                  </span>
                  <div className="file-server-row-actions">
                    <button
                      className="file-server-button compact primary"
                      type="button"
                      onClick={() => isPreviewableImage(entry.name)
                        ? void openImagePreview(entry)
                        : entryRequest?.status === 'Ready'
                          ? void handleDownload(entryRequest, openBrowserViewer(entryRequest.fileName))
                          : void handleRequestDownload(entry)}
                      disabled={isRequesting || Boolean(entryRequest && CANCELLABLE_STATUSES.has(entryRequest.status)) || downloadingRequestIds.includes(entryRequest?.requestId)}
                    >
                      Download
                    </button>
                    <button
                      className="file-server-button compact share"
                      type="button"
                      disabled={sharingPaths.includes(entry.relativePath)}
                      title={entry.isCached
                        ? 'Create and copy a public Adimari share link'
                        : 'Upload the current file version to S3, then create and copy a public Adimari share link'}
                      onClick={() => void handleShare(entry)}
                    >
                      {sharingPaths.includes(entry.relativePath)
                        ? shareUploadPaths.includes(entry.relativePath) ? 'Uploadingâ€¦' : 'Creatingâ€¦'
                        : copiedSharePath === entry.relativePath ? 'Copied!' : 'Share'}
                    </button>
                  </div>
                </article>
              );
            })}
            {!entries.length && <p className="file-server-empty">This folder is empty.</p>}
          </>
        )}
      </section>

      {hasMore && (
        <button className="file-server-button file-server-load-more" type="button" disabled={isLoadingMore} onClick={() => void loadFolder(storageNodeId, currentPath, nextCursor, true)}>
          {isLoadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}

      <section className="folder-explorer-requests" aria-labelledby="folder-explorer-requests-title">
        <button
          className="folder-explorer-requests-toggle"
          type="button"
          id="folder-explorer-requests-title"
          aria-expanded={isRecentDeliveriesExpanded}
          aria-controls="folder-explorer-requests-content"
          onClick={() => setIsRecentDeliveriesExpanded((isExpanded) => !isExpanded)}
        >
          <span>Recent file deliveries</span>
          <span aria-hidden="true">{isRecentDeliveriesExpanded ? '−' : '+'}</span>
        </button>
        {isRecentDeliveriesExpanded && (
          <div id="folder-explorer-requests-content">
        {!storageNodeId ? <p className="file-server-muted">Select a NAS storage node to view delivery status.</p> : !requests.length ? (
          <p className="file-server-muted">No file deliveries have been requested for this NAS node.</p>
        ) : (
          <div className="folder-explorer-request-list">
            {requests.slice(0, 10).map((request) => (
              <article key={request.requestId}>
                <div><strong>{request.fileName}</strong><span>{request.relativePath}</span></div>
                <span className={`folder-explorer-status ${request.status.toLowerCase()}`}>{request.status}</span>
                <span>{formatTransferProgress(request.bytesTransferred, request.totalBytes)}</span>
                <div className="file-server-row-actions">
                  {request.status === 'Ready' && <button className="file-server-button compact primary" type="button" onClick={() => isPreviewableImage(request.fileName)
                    ? void openImagePreview({ isDirectory: false, name: request.fileName, relativePath: request.relativePath })
                    : void handleDownload(request, openBrowserViewer(request.fileName))} disabled={downloadingRequestIds.includes(request.requestId)}>Download</button>}
                  {CANCELLABLE_STATUSES.has(request.status) && <button className="file-server-button compact danger" type="button" onClick={() => void handleCancel(request)} disabled={cancellingRequestIds.includes(request.requestId)}>{cancellingRequestIds.includes(request.requestId) ? 'Cancelling…' : 'Cancel'}</button>}
                  {request.status === 'Failed' && <span className="folder-explorer-failure">Delivery failed. Try again or contact an administrator.</span>}
                </div>
              </article>
            ))}
          </div>
        )}
          </div>
        )}
      </section>
      </main>

      {previewEntry && (
        <FileExplorerImageLightbox
          title={previewEntry.name}
          imageUrl={previewUrl}
          loading={isPreviewLoading}
          loadingLabel="Requesting the image from the NAS…"
          error={previewError}
          onClose={closePreview}
          onDownload={previewDownloadRequest ? () => void handleDownload(previewDownloadRequest) : undefined}
          onPrevious={previewIndex > 0 ? () => void openImagePreview(imageEntries[previewIndex - 1]) : undefined}
          onNext={previewIndex >= 0 && previewIndex < imageEntries.length - 1 ? () => void openImagePreview(imageEntries[previewIndex + 1]) : undefined}
        />
      )}
    </>
  );
}

function getBreadcrumbs(path) {
  if (!path) {
    return [];
  }

  const parts = path.split('/');
  return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join('/') }));
}

function isPreviewableImage(fileName) {
  return IMAGE_FILE_PATTERN.test(fileName);
}

function getEntryStatus(request, isRequesting) {
  if (isRequesting) {
    return 'Requesting';
  }

  return request?.status || 'Available';
}

// eslint-disable-next-line react/prop-types
function FileIcon({ entry }) {
  const iconName = getFileIconName(entry);

  return (
    <img
      className="file-explorer-file-icon"
      src={`${FILE_ICON_DIRECTORY}${encodeURIComponent(iconName)}`}
      alt=""
      aria-hidden="true"
      onError={(event) => {
        event.currentTarget.onerror = null;
        event.currentTarget.src = `${FILE_ICON_DIRECTORY}file.png`;
      }}
    />
  );
}

function getFileIconName(entry) {
  if (entry.isDirectory) {
    return 'folder.png';
  }

  const extension = entry.name.includes('.') ? entry.name.split('.').pop().toLowerCase() : '';
  const iconExtension = FILE_ICON_ALIASES[extension] || extension;
  return iconExtension ? `${iconExtension}.png` : 'file.png';
}

function getImageContentType(fileName) {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();

  return {
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  }[extension] || 'application/octet-stream';
}

function getBrowserContentType(fileName) {
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  return BROWSER_VIEWABLE_CONTENT_TYPES[extension] || '';
}

function isBrowserViewableFile(fileName) {
  return Boolean(getBrowserContentType(fileName));
}

function openBrowserViewer(fileName) {
  if (!isBrowserViewableFile(fileName)) {
    return null;
  }

  const viewerWindow = window.open('', '_blank');

  if (viewerWindow) {
    viewerWindow.opener = null;
    viewerWindow.document.title = `Preparing ${fileName}`;
    viewerWindow.document.body.textContent = 'Preparing file…';
  }

  return viewerWindow;
}

async function copyToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand('copy');
  textArea.remove();

  if (!copied) {
    throw new Error('The browser could not copy the share link.');
  }
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number') {
    return '—';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

function formatTransferProgress(bytesTransferred, totalBytes) {
  if (typeof totalBytes !== 'number' || totalBytes <= 0) {
    return typeof bytesTransferred === 'number' ? formatBytes(bytesTransferred) : '—';
  }

  return `${formatBytes(bytesTransferred || 0)} / ${formatBytes(totalBytes)}`;
}

function toUserMessage(error, fallback) {
  if (error?.status === 401 || error?.status === 403) {
    return 'Your sign-in has expired. Please sign in again before using the NAS explorer.';
  }

  if (typeof error?.status === 'number') {
    return `${fallback} File Sync returned HTTP ${error.status}.`;
  }

  if (error instanceof TypeError) {
    return `${fallback} The File Sync service could not be reached.`;
  }

  return fallback;
}

export default FolderExplorer;
