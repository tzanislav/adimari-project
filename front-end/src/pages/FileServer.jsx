/* eslint-disable react/prop-types */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '../utils/authHeaders';
import '../CSS/FileServer.css';

const serverUrl = import.meta.env.VITE_SERVER_URL || '';
const apiBase = `${serverUrl}/api/files`;
const UPLOAD_URL_BATCH_SIZE = 20;
const UPLOAD_CONCURRENCY = 3;
const FOLDER_MARKER_FILE_NAME = '.keep';
const FILE_ICON_DIRECTORY = '/File%20Icons/';
const FILE_ICON_ALIASES = { docx: 'doc', xlsx: 'xls', xlsm: 'xls' };

class FileServerApiError extends Error {
  constructor(message, { status, data } = {}) {
    super(message);
    this.name = 'FileServerApiError';
    this.status = status;
    this.data = data;
  }
}

const apiRequest = async (path, { method = 'GET', body } = {}) => {
  const response = await fetchWithAuth(`${apiBase}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new FileServerApiError(data?.error || 'The file-server request failed.', {
      status: response.status,
      data,
    });
  }

  return data;
};

const formatBytes = (value = 0) => {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** unitIndex)).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDate = (value) => (value ? new Date(value).toLocaleString() : 'Never');

const folderPath = (folder, name) => (folder ? `${folder}/${name}` : name);

const relativePathSegments = (relativePath) => {
  if (typeof relativePath !== 'string' || !relativePath
    || relativePath.startsWith('/') || relativePath.includes('\\')) {
    return null;
  }
  const segments = relativePath.split('/');
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return null;
  }
  return segments;
};

const uploadItemForRelativePath = (file, relativePath, destinationRoot) => {
  const segments = relativePathSegments(relativePath);
  if (!segments) return null;

  const fileName = segments.at(-1);
  const relativeFolder = segments.slice(0, -1).join('/');
  return {
    file,
    fileName,
    targetFolder: relativeFolder ? folderPath(destinationRoot, relativeFolder) : destinationRoot,
    displayName: segments.join('/'),
  };
};

const readDirectoryEntries = (reader) => new Promise((resolve, reject) => {
  const entries = [];
  const readNextBatch = () => {
    reader.readEntries((batch) => {
      if (!batch.length) {
        resolve(entries);
        return;
      }
      entries.push(...batch);
      readNextBatch();
    }, reject);
  };
  readNextBatch();
});

const readFileEntry = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

const collectDroppedFiles = async (entries) => {
  const files = [];

  const visit = async (entry, parentPath = '') => {
    const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (entry.isFile) {
      files.push({ file: await readFileEntry(entry), relativePath });
      return;
    }
    if (!entry.isDirectory) return;

    const children = await readDirectoryEntries(entry.createReader());
    for (const child of children) {
      await visit(child, relativePath);
    }
  };

  for (const entry of entries) {
    await visit(entry);
  }
  return files;
};

const getFolderArchiveStatus = (share) => share?.archive?.status || 'queued';
const folderSnapshotNeedsNewLink = (share) => ['FILE_NOT_FOUND', 'FILE_CONFLICT', 'FOLDER_SHARE_SNAPSHOT_INVALID']
  .includes(share?.archive?.errorCode);

const folderArchiveStatusLabel = (status) => {
  switch (status) {
    case 'queued': return 'Archive queued';
    case 'preparing': return 'Preparing ZIP';
    case 'ready': return 'ZIP ready';
    case 'failed': return 'Archive failed';
    default: return 'Archive pending';
  }
};

const folderArchiveStatusDetail = (share) => {
  const status = getFolderArchiveStatus(share);
  if (status === 'queued') return 'The folder snapshot is waiting to be packaged.';
  if (status === 'preparing') {
    const processedFiles = Number(share.archive?.processedFiles || 0);
    const fileCount = Number(share.fileCount || 0);
    if (fileCount > 0) return `The server is packaging the folder into one ZIP file (${processedFiles.toLocaleString()} of ${fileCount.toLocaleString()} files).`;
    return 'The server is packaging the folder into one ZIP file.';
  }
  if (status === 'ready') {
    const fileName = share.archive?.fileName || 'Folder archive';
    return share.archive?.size ? `${fileName} · ${formatBytes(share.archive.size)}` : fileName;
  }
  if (status === 'failed') {
    return folderSnapshotNeedsNewLink(share)
      ? 'A source file changed or no longer exists. Create a new link for the current folder.'
      : 'The ZIP could not be prepared. You can retry it.';
  }
  return 'The folder archive is being set up.';
};

const isFolderArchivePending = (share) => ['queued', 'preparing'].includes(getFolderArchiveStatus(share));

const runWithConcurrency = async (items, limit, task) => {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await task(items[currentIndex]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
};

function ConflictDialog({ conflict, onReplace, onRename, onClose }) {
  const [name, setName] = useState(conflict.fileName);
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    setName(conflict.fileName);
    setRenaming(false);
  }, [conflict]);

  return (
    <div className="file-server-modal-backdrop" role="presentation">
      <section className="file-server-modal" role="dialog" aria-modal="true" aria-labelledby="file-conflict-title">
        <h2 id="file-conflict-title">A file with this name already exists</h2>
        <p><strong>{conflict.fileName}</strong> already exists in this folder.</p>
        {conflict.existingFile && (
          <p className="file-server-muted">Existing file: {formatBytes(conflict.existingFile.size)} · {formatDate(conflict.existingFile.lastModified)}</p>
        )}
        {renaming && (
          <label className="file-server-field">
            New file name
            <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </label>
        )}
        <div className="file-server-modal-actions">
          <button className="file-server-button danger" onClick={onReplace}>Replace</button>
          {renaming ? (
            <button className="file-server-button primary" onClick={() => onRename(name)}>Use new name</button>
          ) : (
            <button className="file-server-button" onClick={() => setRenaming(true)}>Rename</button>
          )}
          <button className="file-server-button ghost" onClick={onClose}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

function MoveDialog({ move, folders, loadingFolders, onSubmit, onClose }) {
  const [destinationFolder, setDestinationFolder] = useState(move.destinationFolder);
  const [destinationFileName, setDestinationFileName] = useState(move.destinationFileName);

  return (
    <div className="file-server-modal-backdrop" role="presentation">
      <section className="file-server-modal" role="dialog" aria-modal="true" aria-labelledby="move-file-title">
        <h2 id="move-file-title">Move or rename file</h2>
        <p className="file-server-muted">{move.file.name}</p>
        <label className="file-server-field">
          Destination folder
          <select value={destinationFolder} disabled={loadingFolders} onChange={(event) => setDestinationFolder(event.target.value)}>
            <option value="">Root folder</option>
            {folders.map((folderPath) => <option key={folderPath} value={folderPath}>{folderPath}</option>)}
          </select>
          {loadingFolders && <span className="file-server-field-hint">Loading folders…</span>}
        </label>
        <label className="file-server-field">
          File name
          <input value={destinationFileName} onChange={(event) => setDestinationFileName(event.target.value)} />
        </label>
        <div className="file-server-modal-actions">
          <button className="file-server-button primary" onClick={() => onSubmit({ destinationFolder, destinationFileName })}>Move file</button>
          <button className="file-server-button ghost" onClick={onClose}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

function DeleteDialog({ file, onDelete, onClose }) {
  return (
    <div className="file-server-modal-backdrop" role="presentation">
      <section className="file-server-modal" role="dialog" aria-modal="true" aria-labelledby="delete-file-title">
        <h2 id="delete-file-title">Delete file?</h2>
        <p><strong>{file.name}</strong> will be deleted. Any active share links for it will be revoked.</p>
        <div className="file-server-modal-actions">
          <button className="file-server-button danger" onClick={onDelete}>Delete file</button>
          <button className="file-server-button ghost" onClick={onClose}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

function DeleteFolderDialog({ folder, onDelete, onClose }) {
  return (
    <div className="file-server-modal-backdrop" role="presentation">
      <section className="file-server-modal" role="dialog" aria-modal="true" aria-labelledby="delete-folder-title">
        <h2 id="delete-folder-title">Delete folder and all contents?</h2>
        <p><strong>{folder.name}</strong>, every file in it, and all nested folders will be permanently deleted. Any active file and folder share links will be revoked.</p>
        <div className="file-server-modal-actions">
          <button className="file-server-button danger" onClick={onDelete}>Delete folder</button>
          <button className="file-server-button ghost" onClick={onClose}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

function ShareDialog({ state, onCreate, onRevoke, onCopy, onClose }) {
  const { file, shares, loading, createdUrl, busy } = state;
  return (
    <div className="file-server-modal-backdrop" role="presentation">
      <section className="file-server-modal file-server-share-modal" role="dialog" aria-modal="true" aria-labelledby="share-file-title">
        <h2 id="share-file-title">Share {file.name}</h2>
        <p className="file-server-muted">Anyone with an active link can download this file without signing in.</p>
        {createdUrl && (
          <div className="file-server-new-link">
            <label className="file-server-field">
              New share link
              <input readOnly value={createdUrl} onFocus={(event) => event.target.select()} />
            </label>
            <button className="file-server-button primary" onClick={() => onCopy(createdUrl)}>Copy link</button>
          </div>
        )}
        <div className="file-server-share-toolbar">
          <button className="file-server-button primary" disabled={busy} onClick={onCreate}>Create new link</button>
          <span>Links are only shown in full when first created.</span>
        </div>
        {loading ? <p>Loading share links…</p> : (
          <div className="file-server-share-list">
            {shares.length === 0 ? <p className="file-server-muted">No share links yet.</p> : shares.map((share) => (
              <article className="file-server-share-row" key={share._id}>
                <div>
                  <strong>{share.status === 'active' ? 'Active link' : 'Revoked link'}</strong>
                  <span>Created {formatDate(share.createdAt)}</span>
                  <span>{share.downloadCount || 0} download start{share.downloadCount === 1 ? '' : 's'} · Last: {formatDate(share.lastDownloadedAt)}</span>
                </div>
                {share.status === 'active' && (
                  <button className="file-server-button danger compact" disabled={busy} onClick={() => onRevoke(share._id)}>Revoke</button>
                )}
              </article>
            ))}
          </div>
        )}
        <div className="file-server-modal-actions">
          <button className="file-server-button ghost" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

function FolderShareDialog({ state, onCreate, onRevoke, onRetry, onCopy, onClose }) {
  const { folder, shares = [], loading, createdUrl, busy } = state;
  return (
    <div className="file-server-modal-backdrop" role="presentation">
      <section className="file-server-modal file-server-share-modal" role="dialog" aria-modal="true" aria-labelledby="share-folder-title">
        <h2 id="share-folder-title">Share {folder.name}</h2>
        <p className="file-server-muted">
          A snapshot of this folder and its nested files is packaged into one ZIP. Anyone with an active link can download it without signing in.
        </p>
        {createdUrl && (
          <div className="file-server-new-link">
            <label className="file-server-field">
              New folder share link
              <input readOnly value={createdUrl} onFocus={(event) => event.target.select()} />
            </label>
            <button className="file-server-button primary" onClick={() => onCopy(createdUrl)}>Copy link</button>
          </div>
        )}
        <div className="file-server-share-toolbar">
          <button className="file-server-button primary" disabled={busy} onClick={onCreate}>Create new link</button>
          <span>Links are only shown in full when first created.</span>
        </div>
        {loading ? <p>Loading folder share links...</p> : (
          <div className="file-server-share-list">
            {shares.length === 0 ? <p className="file-server-muted">No folder share links yet.</p> : shares.map((share) => {
              const archiveStatus = getFolderArchiveStatus(share);
              const isActive = share.status === 'active';
              return (
                <article className="file-server-share-row file-server-folder-share-row" key={share._id}>
                  <div>
                    <strong>{isActive ? 'Active folder link' : 'Revoked folder link'}</strong>
                    <span>{share.fileCount || 0} file{share.fileCount === 1 ? '' : 's'} · {formatBytes(share.totalBytes)}</span>
                    <span>Created {formatDate(share.createdAt)} · {share.downloadCount || 0} download start{share.downloadCount === 1 ? '' : 's'}</span>
                    <span>Last: {formatDate(share.lastDownloadedAt)}</span>
                    {isActive && (
                      <span className={`file-server-archive-status ${archiveStatus}`}>
                        <strong>{folderArchiveStatusLabel(archiveStatus)}</strong> {folderArchiveStatusDetail(share)}
                      </span>
                    )}
                  </div>
                  {isActive && (
                    <div className="file-server-share-row-actions">
                      {archiveStatus === 'failed' && !folderSnapshotNeedsNewLink(share) && (
                        <button className="file-server-button compact" disabled={busy} onClick={() => onRetry(share._id)}>Retry archive</button>
                      )}
                      <button className="file-server-button danger compact" disabled={busy} onClick={() => onRevoke(share._id)}>Revoke</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
        <div className="file-server-modal-actions">
          <button className="file-server-button ghost" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

function FileServer() {
  const [folder, setFolder] = useState('');
  const [listing, setListing] = useState({ files: [], folders: [], nextContinuationToken: null });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [folderName, setFolderName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [readingDroppedFolder, setReadingDroppedFolder] = useState(false);
  const [uploadState, setUploadState] = useState(null);
  const [moveDialog, setMoveDialog] = useState(null);
  const [moveFolders, setMoveFolders] = useState([]);
  const [loadingMoveFolders, setLoadingMoveFolders] = useState(false);
  const [deleteFile, setDeleteFile] = useState(null);
  const [deleteFolder, setDeleteFolder] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [shareDialog, setShareDialog] = useState(null);
  const [folderShareDialog, setFolderShareDialog] = useState(null);
  const [stats, setStats] = useState(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const uploadInProgressRef = useRef(false);
  const uploadQueueRef = useRef(null);
  const dropCollectionInProgressRef = useRef(false);

  const setFolderInputRef = useCallback((input) => {
    folderInputRef.current = input;
    if (input) {
      // `webkitdirectory` is the directory-picker API supported by current
      // Chromium, Safari, and Firefox browsers. Setting the attribute here
      // avoids React treating the non-standard property as a boolean prop.
      input.setAttribute('webkitdirectory', '');
    }
  }, []);

  const navigateToFolder = (nextFolder) => {
    if (uploadInProgressRef.current || dropCollectionInProgressRef.current) return;
    setFolder(nextFolder);
  };

  const loadFolder = useCallback(async ({ cursor = null, append = false, targetFolder = folder } = {}) => {
    try {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError('');
      const query = new URLSearchParams({ folder: targetFolder, limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const result = await apiRequest(`?${query.toString()}`);
      setListing((previous) => (append ? {
        ...result,
        files: [...previous.files, ...result.files],
        folders: [...previous.folders, ...result.folders],
      } : result));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [folder]);

  const loadStats = useCallback(async () => {
    try {
      const result = await apiRequest('/stats');
      setStats(result);
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);

  useEffect(() => {
    void loadFolder({ targetFolder: folder });
    void loadStats();
  }, [folder, loadFolder, loadStats]);

  const refresh = async () => {
    await Promise.all([loadFolder({ targetFolder: folder }), loadStats()]);
  };

  const createFolder = async (event) => {
    event.preventDefault();
    const trimmedName = folderName.trim();
    if (!trimmedName) return;
    try {
      await apiRequest('/folders', { method: 'POST', body: { folder: folderPath(folder, trimmedName) } });
      setFolderName('');
      setNotice(`Created folder “${trimmedName}”.`);
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const uploadFile = async (file, {
    fileName = file.name,
    targetFolder = folder,
    displayName = fileName,
    statusPrefix = '',
    conflictStrategy = 'cancel',
    refreshAfterUpload = true,
    showSuccessNotice = true,
  } = {}) => {
    let operationId = null;
    const withStatusPrefix = (status) => `${statusPrefix}${status}`;
    try {
      setError('');
      setNotice('');
      setUploadState({ fileName: displayName, totalBytes: file.size, uploadedBytes: 0, status: withStatusPrefix('Preparing upload…') });
      const upload = await apiRequest('/uploads', {
        method: 'POST',
        body: {
          folder: targetFolder,
          fileName,
          size: file.size,
          contentType: file.type || 'application/octet-stream',
          conflictStrategy,
        },
      });

      // Zero-byte files are saved by the API immediately because S3 multipart
      // uploads require at least one non-empty part.
      if (upload.completed) {
        setUploadState((previous) => ({ ...previous, uploadedBytes: previous.totalBytes, status: withStatusPrefix('Upload complete') }));
        if (showSuccessNotice) setNotice(`Uploaded “${fileName}”.`);
        if (refreshAfterUpload) await refresh();
        return { status: 'completed' };
      }

      operationId = upload.operationId;
      const partCount = Math.ceil(file.size / upload.partSize);
      const completedParts = [];

      for (let batchStart = 1; batchStart <= partCount; batchStart += UPLOAD_URL_BATCH_SIZE) {
        const partNumbers = Array.from(
          { length: Math.min(UPLOAD_URL_BATCH_SIZE, partCount - batchStart + 1) },
          (_, index) => batchStart + index,
        );
        setUploadState((previous) => ({ ...previous, status: withStatusPrefix(`Uploading part ${batchStart} of ${partCount}…`) }));
        const signedParts = await apiRequest(`/uploads/${operationId}/parts`, { method: 'POST', body: { partNumbers } });
        await runWithConcurrency(signedParts.parts, UPLOAD_CONCURRENCY, async ({ partNumber, url }) => {
          const startByte = (partNumber - 1) * upload.partSize;
          const part = file.slice(startByte, Math.min(startByte + upload.partSize, file.size));
          const response = await fetch(url, { method: 'PUT', body: part });
          if (!response.ok) {
            throw new Error(`S3 rejected upload part ${partNumber}.`);
          }
          const eTag = response.headers.get('etag');
          if (!eTag) {
            throw new Error(`S3 did not return an ETag for upload part ${partNumber}.`);
          }
          completedParts.push({ partNumber, eTag });
          setUploadState((previous) => ({
            ...previous,
            uploadedBytes: Math.min(previous.totalBytes, previous.uploadedBytes + part.size),
          }));
        });
      }

      setUploadState((previous) => ({ ...previous, status: withStatusPrefix('Finalising file…') }));
      await apiRequest(`/uploads/${operationId}/complete`, { method: 'POST', body: { parts: completedParts } });
      setUploadState((previous) => ({ ...previous, uploadedBytes: previous.totalBytes, status: withStatusPrefix('Upload complete') }));
      if (showSuccessNotice) setNotice(`Uploaded “${fileName}”.`);
      if (refreshAfterUpload) await refresh();
      return { status: 'completed' };
    } catch (requestError) {
      if (requestError instanceof FileServerApiError && requestError.status === 409 && requestError.data?.code === 'FILE_NAME_CONFLICT') {
        setUploadState({ fileName: displayName, totalBytes: file.size, uploadedBytes: 0, status: 'Waiting for your conflict choice' });
        setConflict({
          kind: 'upload',
          file,
          fileName,
          targetFolder,
          displayName,
          existingFile: requestError.data.existingFile,
        });
        return { status: 'conflict' };
      }
      if (operationId) {
        try {
          await apiRequest(`/uploads/${operationId}/abort`, { method: 'POST' });
        } catch {
          // The S3 lifecycle rule cleans up an unfinished upload if this best-effort abort fails.
        }
      }
      setUploadState((previous) => (previous ? { ...previous, status: 'Upload failed' } : null));
      setError(requestError.message || 'Upload failed.');
      return { status: 'failed', error: requestError.message || 'Upload failed.' };
    }
  };

  const finishUploadQueue = async (queue, { failureMessage, cancelled = false } = {}) => {
    if (uploadQueueRef.current === queue) uploadQueueRef.current = null;
    try {
      if (queue.completedCount) await refresh();
      if (failureMessage) {
        // Refreshing successful earlier files clears request errors, so restore
        // the actionable failure once the list has been updated.
        setError(failureMessage);
      } else if (cancelled) {
        setNotice(`Stopped after uploading ${queue.completedCount} file${queue.completedCount === 1 ? '' : 's'}.`);
      } else {
        setNotice(`Uploaded ${queue.completedCount} file${queue.completedCount === 1 ? '' : 's'}${queue.preservesFolderStructure ? ' with its folder structure preserved' : ''}.`);
      }
    } finally {
      uploadInProgressRef.current = false;
      setUploadState(null);
    }
  };

  const continueUploadQueue = async () => {
    const queue = uploadQueueRef.current;
    if (!queue) return;

    try {
      while (queue.nextIndex < queue.items.length) {
        const item = queue.items[queue.nextIndex];
        const result = await uploadFile(item.file, {
          fileName: item.fileName,
          targetFolder: item.targetFolder,
          displayName: item.displayName,
          statusPrefix: queue.items.length > 1 ? `File ${queue.nextIndex + 1} of ${queue.items.length} — ` : '',
          refreshAfterUpload: false,
          showSuccessNotice: false,
        });
        if (result.status === 'completed') {
          queue.nextIndex += 1;
          queue.completedCount += 1;
          continue;
        }
        if (result.status === 'conflict') return;
        await finishUploadQueue(queue, { failureMessage: result.error });
        return;
      }
      await finishUploadQueue(queue);
    } catch (queueError) {
      await finishUploadQueue(queue, { failureMessage: queueError.message || 'Upload failed.' });
    }
  };

  const queueUploadItems = (items, { preservesFolderStructure = false } = {}) => {
    const selectedItems = items.filter(Boolean);
    if (!selectedItems.length || uploadInProgressRef.current) return;
    const markerFile = selectedItems.find((item) => item.fileName === FOLDER_MARKER_FILE_NAME);
    if (markerFile) {
      setError(`“${markerFile.displayName}” cannot be uploaded because .keep is reserved for File Server folder markers. Rename it and try again.`);
      return;
    }
    uploadInProgressRef.current = true;
    uploadQueueRef.current = {
      items: selectedItems,
      nextIndex: 0,
      completedCount: 0,
      preservesFolderStructure,
    };
    void continueUploadQueue();
  };

  const queueFiles = (files) => {
    const selectedFiles = Array.from(files || []);
    queueUploadItems(selectedFiles.map((file) => ({
      file,
      fileName: file.name,
      targetFolder: folder,
      displayName: file.name,
    })));
  };

  const queueFolderFiles = (files) => {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) {
      setNotice('No files were found in that folder. Browser folder pickers cannot include empty folders.');
      return;
    }
    const uploadItems = selectedFiles.map((file) => uploadItemForRelativePath(file, file.webkitRelativePath, folder));
    if (uploadItems.some((item) => !item)) {
      setError('This browser did not provide the folder paths. Use a current version of Chrome, Edge, Safari, or Firefox to upload a folder.');
      return;
    }
    queueUploadItems(uploadItems, { preservesFolderStructure: true });
  };

  const openFolderPicker = () => {
    const input = folderInputRef.current;
    if (!input) return;
    if (!('webkitdirectory' in input)) {
      setError('This browser does not support folder uploads. Use a current version of Chrome, Edge, Safari, or Firefox.');
      return;
    }
    input.click();
  };

  const queueDroppedFiles = async (dataTransfer) => {
    if (uploadInProgressRef.current || dropCollectionInProgressRef.current) return;

    const entries = Array.from(dataTransfer.items || [])
      .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
      .filter(Boolean);
    if (!entries.length) {
      queueFiles(dataTransfer.files);
      return;
    }

    dropCollectionInProgressRef.current = true;
    setReadingDroppedFolder(true);
    try {
      const droppedFiles = await collectDroppedFiles(entries);
      if (!droppedFiles.length) {
        setNotice('No files were found in the dropped folder. Browser folder uploads cannot preserve empty folders.');
        return;
      }
      const uploadItems = droppedFiles.map(({ file, relativePath }) => uploadItemForRelativePath(file, relativePath, folder));
      if (uploadItems.some((item) => !item)) {
        setError('A dropped item has an invalid folder path and was not uploaded.');
        return;
      }
      queueUploadItems(uploadItems, { preservesFolderStructure: entries.some((entry) => entry.isDirectory) });
    } catch (dropError) {
      setError(dropError.message || 'The dropped folder could not be read.');
    } finally {
      dropCollectionInProgressRef.current = false;
      setReadingDroppedFolder(false);
    }
  };

  const submitMove = async ({ destinationFolder, destinationFileName }, conflictStrategy = 'cancel') => {
    const move = moveDialog || conflict?.move;
    if (!move) return;
    try {
      setError('');
      await apiRequest('/move', {
        method: 'POST',
        body: {
          sourceKey: move.file.key,
          destinationFolder,
          destinationFileName,
          conflictStrategy,
        },
      });
      setMoveDialog(null);
      setConflict(null);
      setNotice(`Moved “${move.file.name}”.`);
      await refresh();
    } catch (requestError) {
      if (requestError instanceof FileServerApiError && requestError.status === 409 && requestError.data?.code === 'FILE_NAME_CONFLICT') {
        setMoveDialog(null);
        setConflict({
          kind: 'move',
          move: { ...move, destinationFolder, destinationFileName },
          fileName: destinationFileName,
          existingFile: requestError.data.existingFile,
        });
        return;
      }
      setError(requestError.message);
    }
  };

  const confirmDelete = async () => {
    if (!deleteFile) return;
    try {
      await apiRequest(`/object?key=${encodeURIComponent(deleteFile.key)}`, { method: 'DELETE' });
      setNotice(`Deleted “${deleteFile.name}”.`);
      setDeleteFile(null);
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const confirmFolderDelete = async () => {
    if (!deleteFolder) return;
    try {
      const result = await apiRequest(`/folder?folder=${encodeURIComponent(deleteFolder.path)}`, { method: 'DELETE' });
      setNotice(`Deleted folder “${deleteFolder.name}” and ${result.deletedCount} object${result.deletedCount === 1 ? '' : 's'}.`);
      setDeleteFolder(null);
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const openMoveDialog = (file) => {
    setMoveDialog({ file, destinationFolder: folder, destinationFileName: file.name });
    setLoadingMoveFolders(true);
    void apiRequest('/folders')
      .then((result) => setMoveFolders(result.folders || []))
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoadingMoveFolders(false));
  };

  const downloadFile = async (file) => {
    try {
      setError('');
      const result = await apiRequest(`/download?key=${encodeURIComponent(file.key)}`);
      if (result.openInNewTab) {
        window.open(result.url, '_blank', 'noopener,noreferrer');
        return;
      }
      const link = document.createElement('a');
      link.href = result.url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const loadShares = async (file, { preserveUrl = false } = {}) => {
    setShareDialog((previous) => ({
      ...(previous || { file }),
      file,
      loading: true,
      ...(preserveUrl ? {} : { createdUrl: null }),
    }));
    try {
      const result = await apiRequest(`/shares?key=${encodeURIComponent(file.key)}`);
      setShareDialog((previous) => ({ ...previous, file, shares: result.shares, loading: false, busy: false }));
    } catch (requestError) {
      setError(requestError.message);
      setShareDialog((previous) => (previous ? { ...previous, loading: false, busy: false } : previous));
    }
  };

  const openShares = (file) => {
    setShareDialog({ file, shares: [], loading: true, busy: false, createdUrl: null });
    void loadShares(file);
  };

  const createShare = async () => {
    if (!shareDialog) return;
    try {
      setShareDialog((previous) => ({ ...previous, busy: true }));
      const result = await apiRequest('/shares', { method: 'POST', body: { key: shareDialog.file.key } });
      setShareDialog((previous) => ({
        ...previous,
        shares: [result.share, ...previous.shares],
        createdUrl: result.url,
        busy: false,
      }));
      setNotice('New share link created. Copy it now; it will not be shown again.');
    } catch (requestError) {
      setError(requestError.message);
      setShareDialog((previous) => ({ ...previous, busy: false }));
    }
  };

  const revokeShare = async (shareId) => {
    if (!shareDialog) return;
    try {
      setShareDialog((previous) => ({ ...previous, busy: true }));
      const result = await apiRequest(`/shares/${shareId}/revoke`, { method: 'POST' });
      setShareDialog((previous) => ({
        ...previous,
        shares: previous.shares.map((share) => (share._id === shareId ? result.share : share)),
        busy: false,
      }));
      setNotice('Share link revoked.');
    } catch (requestError) {
      setError(requestError.message);
      setShareDialog((previous) => ({ ...previous, busy: false }));
    }
  };

  const loadFolderShares = useCallback(async (shareFolder, { preserveUrl = false, silent = false } = {}) => {
    setFolderShareDialog((previous) => {
      if (!previous || previous.folder.path !== shareFolder.path) return previous;
      return {
        ...previous,
        loading: silent ? previous.loading : true,
        ...(preserveUrl || silent ? {} : { createdUrl: null }),
      };
    });
    try {
      const result = await apiRequest(`/folder-shares?folder=${encodeURIComponent(shareFolder.path)}`);
      setFolderShareDialog((previous) => {
        if (!previous || previous.folder.path !== shareFolder.path) return previous;
        return {
          ...previous,
          shares: result.shares || [],
          loading: false,
          busy: silent ? previous.busy : false,
        };
      });
    } catch (requestError) {
      if (!silent) setError(requestError.message);
      setFolderShareDialog((previous) => {
        if (!previous || previous.folder.path !== shareFolder.path) return previous;
        return { ...previous, loading: false, busy: false };
      });
    }
  }, []);

  const openFolderShares = (item) => {
    const shareFolder = { name: item.name, path: folderPath(folder, item.name) };
    setFolderShareDialog({ folder: shareFolder, shares: [], loading: true, busy: false, createdUrl: null });
    void loadFolderShares(shareFolder);
  };

  const createFolderShare = async () => {
    if (!folderShareDialog) return;
    const shareFolder = folderShareDialog.folder;
    try {
      setFolderShareDialog((previous) => (previous ? { ...previous, busy: true } : previous));
      const result = await apiRequest('/folder-shares', { method: 'POST', body: { folder: shareFolder.path } });
      setFolderShareDialog((previous) => {
        if (!previous || previous.folder.path !== shareFolder.path) return previous;
        return {
          ...previous,
          shares: [result.share, ...previous.shares],
          createdUrl: result.url,
          loading: false,
          busy: false,
        };
      });
      setNotice('New folder share link created. The ZIP is being prepared in the background.');
    } catch (requestError) {
      setError(requestError.message);
      setFolderShareDialog((previous) => (previous ? { ...previous, busy: false } : previous));
    }
  };

  const revokeFolderShare = async (shareId) => {
    if (!folderShareDialog) return;
    try {
      setFolderShareDialog((previous) => (previous ? { ...previous, busy: true } : previous));
      const result = await apiRequest(`/shares/${shareId}/revoke`, { method: 'POST' });
      setFolderShareDialog((previous) => (previous ? {
        ...previous,
        shares: previous.shares.map((share) => (share._id === shareId ? result.share : share)),
        busy: false,
      } : previous));
      setNotice('Folder share link revoked.');
    } catch (requestError) {
      setError(requestError.message);
      setFolderShareDialog((previous) => (previous ? { ...previous, busy: false } : previous));
    }
  };

  const retryFolderShareArchive = async (shareId) => {
    if (!folderShareDialog) return;
    try {
      setFolderShareDialog((previous) => (previous ? { ...previous, busy: true } : previous));
      const result = await apiRequest(`/folder-shares/${shareId}/retry`, { method: 'POST' });
      setFolderShareDialog((previous) => (previous ? {
        ...previous,
        shares: previous.shares.map((share) => (share._id === shareId ? result.share : share)),
        busy: false,
      } : previous));
      setNotice('Archive retry queued. The folder is being packaged into one ZIP.');
    } catch (requestError) {
      setError(requestError.message);
      setFolderShareDialog((previous) => (previous ? { ...previous, busy: false } : previous));
    }
  };

  useEffect(() => {
    if (!folderShareDialog?.shares?.some((share) => share.status === 'active' && isFolderArchivePending(share))) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      void loadFolderShares(folderShareDialog.folder, { preserveUrl: true, silent: true });
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, [folderShareDialog, loadFolderShares]);

  const copyShareUrl = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Share link copied.');
    } catch {
      window.prompt('Copy this share link:', url);
    }
  };

  const resolveConflict = (choice, newName) => {
    if (!conflict) return;
    if (conflict.kind === 'upload') {
      const fileName = choice === 'rename' ? newName : conflict.fileName;
      const displayName = conflict.displayName || conflict.fileName;
      const targetFolder = conflict.targetFolder;
      const queue = uploadQueueRef.current;
      const nextDisplayName = choice === 'rename' ? displayName.replace(/[^/]+$/, fileName) : displayName;
      setConflict(null);
      void (async () => {
        if (queue?.items[queue.nextIndex]?.file === conflict.file) {
          queue.items[queue.nextIndex] = {
            ...queue.items[queue.nextIndex],
            fileName,
            targetFolder,
            displayName: nextDisplayName,
          };
        }
        const result = await uploadFile(conflict.file, {
          fileName,
          targetFolder,
          displayName: nextDisplayName,
          conflictStrategy: choice === 'replace' ? 'replace' : 'cancel',
          refreshAfterUpload: !queue,
          showSuccessNotice: !queue,
        });
        if (!queue || uploadQueueRef.current !== queue) return;
        if (result.status === 'completed') {
          queue.nextIndex += 1;
          queue.completedCount += 1;
          void continueUploadQueue();
        } else if (result.status === 'failed') {
          await finishUploadQueue(queue, { failureMessage: result.error });
        }
      })();
      return;
    }

    const move = conflict.move;
    setConflict(null);
    void submitMove({
      destinationFolder: move.destinationFolder,
      destinationFileName: choice === 'rename' ? newName : move.destinationFileName,
    }, choice === 'replace' ? 'replace' : 'cancel');
  };

  const dismissConflict = () => {
    if (conflict?.kind !== 'upload') {
      setConflict(null);
      return;
    }
    const queue = uploadQueueRef.current;
    setConflict(null);
    if (queue) {
      void finishUploadQueue(queue, { cancelled: true });
      return;
    }
    uploadInProgressRef.current = false;
    setUploadState(null);
  };

  const breadcrumbs = folder ? folder.split('/') : [];
  const uploadBusy = Boolean(uploadState) || readingDroppedFolder;

  return (
    <main className="file-server-page">
      <header className="file-server-header">
        <div>
          <p className="file-server-eyebrow">Project workspace</p>
          <h1>File Sharing Server</h1>
          <p>Upload files and folders and share them with anyone.</p>
        </div>
        <button className="file-server-button" onClick={() => void refresh()} disabled={loading}>Refresh</button>
      </header>



      <section className="file-server-toolbar" aria-label="File actions">
        <form className="file-server-new-folder" onSubmit={createFolder}>
          <input value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="New folder name" aria-label="New folder name" />
          <button className="file-server-button" type="submit">New folder</button>
        </form>
        <div className="file-server-toolbar-buttons">
          <button className="file-server-button primary" type="button" disabled={uploadBusy} onClick={() => fileInputRef.current?.click()}>
          <img src="/File%20Icons/file.png" alt="File" className="file-server-icon" />
            
            Upload files
          </button>
          <button className="file-server-button primary " type="button" disabled={uploadBusy} onClick={openFolderPicker}>
            <img src="/File%20Icons/folder.png" alt="Folder" className="file-server-icon" />
            Upload folder
          </button>
        </div>
        <input ref={fileInputRef} className="file-server-visually-hidden" type="file" multiple onChange={(event) => { queueFiles(event.target.files); event.target.value = ''; }} />
        <input ref={setFolderInputRef} className="file-server-visually-hidden" type="file" multiple onChange={(event) => { queueFolderFiles(event.target.files); event.target.value = ''; }} />
      </section>

      <section
        className={`file-server-dropzone ${dragging ? 'is-dragging' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); if (!uploadBusy) setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); if (!uploadBusy) void queueDroppedFiles(event.dataTransfer); }}
      >
        <strong>Drop files or folders here to upload</strong>
        <span>Folders are recreated below the current location, including nested folders. Files upload directly from this browser to private S3 storage.</span>
      </section>

      {readingDroppedFolder && (
        <section className="file-server-upload-status" aria-live="polite">
          <div><strong>Reading dropped folder</strong><span>Finding nested files before upload begins…</span></div>
        </section>
      )}
      {uploadState && (
        <section className="file-server-upload-status" aria-live="polite">
          <div><strong>{uploadState.fileName}</strong><span>{uploadState.status}</span></div>
          <progress value={uploadState.uploadedBytes} max={uploadState.totalBytes || 1} />
          <span>{formatBytes(uploadState.uploadedBytes)} of {formatBytes(uploadState.totalBytes)}</span>
        </section>
      )}
      {error && <p className="file-server-message error" role="alert">{error}</p>}
      {notice && <p className="file-server-message success" role="status">{notice}</p>}

      <nav className="file-server-breadcrumbs " aria-label="File location">
        <img src="/File%20Icons/folder.png" alt="Folder" className="file-server-icon-32" />
        <button className="file-server-crumb" disabled={uploadBusy} onClick={() => navigateToFolder('')}>Files</button>
        {breadcrumbs.map((segment, index) => {
          const path = breadcrumbs.slice(0, index + 1).join('/');
          return (
            <span key={path}>
              <span aria-hidden="true">/</span>
              <button className="file-server-crumb" disabled={uploadBusy} onClick={() => navigateToFolder(path)}>{segment}</button>
            </span>
          );
        })}
      </nav>

      <section className="file-server-browser" aria-label="File browser">
        <div className="file-server-browser-heading">
          <span>Name</span><span>Size</span><span>Modified</span><span>Actions</span>
        </div>
        {loading ? <p className="file-server-empty">Loading files…</p> : (
          <>
            {listing.folders.map((item) => (
              <article className="file-server-row folder" key={item.prefix}>
                <button className="file-server-name-button" disabled={uploadBusy} onClick={() => navigateToFolder(folderPath(folder, item.name))}>
                  <FileIcon isDirectory />
                  <span className="file-server-file-name">{item.name}</span>
                </button>
                <span>Folder</span><span>—</span>
                <div className="file-server-row-actions">
                  <button className="file-server-button compact" onClick={() => openFolderShares(item)}>Share</button>
                  <button className="file-server-button danger compact" onClick={() => setDeleteFolder({ name: item.name, path: folderPath(folder, item.name) })}>Delete</button>
                </div>
              </article>
            ))}
            {listing.files.map((file) => (
              <article className="file-server-row" key={file.key}>
                <div className="file-server-file-name file-explorer-entry-name">
                  <FileIcon fileName={file.name} />
                  {file.name}
                </div>
                <span>{formatBytes(file.size)}</span>
                <span>{formatDate(file.lastModified)}</span>
                <div className="file-server-row-actions">
                  <button className="file-server-button compact" onClick={() => void downloadFile(file)}>Download</button>
                  <button className="file-server-button compact" onClick={() => openShares(file)}>Share</button>
                  <button className="file-server-button compact" onClick={() => openMoveDialog(file)}>Move</button>
                  <button className="file-server-button danger compact" onClick={() => setDeleteFile(file)}>Delete</button>
                </div>
              </article>
            ))}
            {!listing.files.length && !listing.folders.length && <p className="file-server-empty">This folder is empty.</p>}
          </>
        )}
      </section>

      {listing.nextContinuationToken && (
        <button className="file-server-button file-server-load-more" disabled={loadingMore} onClick={() => void loadFolder({ cursor: listing.nextContinuationToken, append: true })}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}

      <section className="file-server-stats" aria-label="File server storage statistics">
        <span>Storage: {stats ? formatBytes(stats.totalBytes) : 'Loading…'}</span>
        <span>Files: {stats ? stats.fileCount.toLocaleString() : '—'}</span>
        <span>Folders: {stats ? stats.folderCount.toLocaleString() : '—'}</span>
        <span>Last file change: {stats ? formatDate(stats.lastModified) : '—'}</span>
      </section>

      {moveDialog && <MoveDialog move={moveDialog} folders={moveFolders} loadingFolders={loadingMoveFolders} onSubmit={submitMove} onClose={() => setMoveDialog(null)} />}
      {deleteFile && <DeleteDialog file={deleteFile} onDelete={() => void confirmDelete()} onClose={() => setDeleteFile(null)} />}
      {deleteFolder && <DeleteFolderDialog folder={deleteFolder} onDelete={() => void confirmFolderDelete()} onClose={() => setDeleteFolder(null)} />}
      {conflict && <ConflictDialog conflict={conflict} onReplace={() => resolveConflict('replace')} onRename={(name) => resolveConflict('rename', name)} onClose={dismissConflict} />}
      {shareDialog && <ShareDialog state={shareDialog} onCreate={() => void createShare()} onRevoke={(shareId) => void revokeShare(shareId)} onCopy={(url) => void copyShareUrl(url)} onClose={() => setShareDialog(null)} />}
      {folderShareDialog && <FolderShareDialog state={folderShareDialog} onCreate={() => void createFolderShare()} onRevoke={(shareId) => void revokeFolderShare(shareId)} onRetry={(shareId) => void retryFolderShareArchive(shareId)} onCopy={(url) => void copyShareUrl(url)} onClose={() => setFolderShareDialog(null)} />}
    </main>
  );
}

function FileIcon({ fileName = '', isDirectory = false }) {
  const iconName = getFileIconName(fileName, isDirectory);

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

function getFileIconName(fileName, isDirectory) {
  if (isDirectory) {
    return 'folder.png';
  }

  const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
  const iconExtension = FILE_ICON_ALIASES[extension] || extension;
  return iconExtension ? `${iconExtension}.png` : 'file.png';
}

export default FileServer;
