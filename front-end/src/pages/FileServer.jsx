/* eslint-disable react/prop-types */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '../utils/authHeaders';
import '../CSS/FileServer.css';

const serverUrl = import.meta.env.VITE_SERVER_URL || '';
const apiBase = `${serverUrl}/api/files`;
const UPLOAD_URL_BATCH_SIZE = 20;
const UPLOAD_CONCURRENCY = 3;

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
        <p><strong>{folder.name}</strong>, every file in it, and all nested folders will be permanently deleted. Any active share links for those files will be revoked.</p>
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

function FileServer() {
  const [folder, setFolder] = useState('');
  const [listing, setListing] = useState({ files: [], folders: [], nextContinuationToken: null });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [folderName, setFolderName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [uploadState, setUploadState] = useState(null);
  const [moveDialog, setMoveDialog] = useState(null);
  const [moveFolders, setMoveFolders] = useState([]);
  const [loadingMoveFolders, setLoadingMoveFolders] = useState(false);
  const [deleteFile, setDeleteFile] = useState(null);
  const [deleteFolder, setDeleteFolder] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [shareDialog, setShareDialog] = useState(null);
  const [stats, setStats] = useState(null);
  const fileInputRef = useRef(null);

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

  const uploadFile = async (file, { fileName = file.name, conflictStrategy = 'cancel' } = {}) => {
    let operationId = null;
    try {
      setError('');
      setNotice('');
      setUploadState({ fileName, totalBytes: file.size, uploadedBytes: 0, status: 'Preparing upload…' });
      const upload = await apiRequest('/uploads', {
        method: 'POST',
        body: {
          folder,
          fileName,
          size: file.size,
          contentType: file.type || 'application/octet-stream',
          conflictStrategy,
        },
      });
      operationId = upload.operationId;
      const partCount = Math.ceil(file.size / upload.partSize);
      const completedParts = [];

      for (let batchStart = 1; batchStart <= partCount; batchStart += UPLOAD_URL_BATCH_SIZE) {
        const partNumbers = Array.from(
          { length: Math.min(UPLOAD_URL_BATCH_SIZE, partCount - batchStart + 1) },
          (_, index) => batchStart + index,
        );
        setUploadState((previous) => ({ ...previous, status: `Uploading part ${batchStart} of ${partCount}…` }));
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

      setUploadState((previous) => ({ ...previous, status: 'Finalising file…' }));
      await apiRequest(`/uploads/${operationId}/complete`, { method: 'POST', body: { parts: completedParts } });
      setUploadState((previous) => ({ ...previous, uploadedBytes: previous.totalBytes, status: 'Upload complete' }));
      setNotice(`Uploaded “${fileName}”.`);
      await refresh();
      return true;
    } catch (requestError) {
      if (requestError instanceof FileServerApiError && requestError.status === 409 && requestError.data?.code === 'FILE_NAME_CONFLICT') {
        setUploadState(null);
        setConflict({
          kind: 'upload',
          file,
          fileName,
          existingFile: requestError.data.existingFile,
        });
        return false;
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
      return false;
    }
  };

  const queueFiles = (files) => {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length || uploadState) return;
    void (async () => {
      for (const file of selectedFiles) {
        const completed = await uploadFile(file);
        if (!completed) break;
      }
    })();
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
      setConflict(null);
      void uploadFile(conflict.file, {
        fileName: choice === 'rename' ? newName : conflict.fileName,
        conflictStrategy: choice === 'replace' ? 'replace' : 'cancel',
      });
      return;
    }

    const move = conflict.move;
    setConflict(null);
    void submitMove({
      destinationFolder: move.destinationFolder,
      destinationFileName: choice === 'rename' ? newName : move.destinationFileName,
    }, choice === 'replace' ? 'replace' : 'cancel');
  };

  const breadcrumbs = folder ? folder.split('/') : [];

  return (
    <main className="file-server-page">
      <header className="file-server-header">
        <div>
          <p className="file-server-eyebrow">Project workspace</p>
          <h1>File Server</h1>
          <p>Private team storage with download-only share links.</p>
        </div>
        <button className="file-server-button" onClick={() => void refresh()} disabled={loading}>Refresh</button>
      </header>



      <section className="file-server-toolbar" aria-label="File actions">
        <form className="file-server-new-folder" onSubmit={createFolder}>
          <input value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="New folder name" aria-label="New folder name" />
          <button className="file-server-button" type="submit">New folder</button>
        </form>
        <button className="file-server-button primary" type="button" disabled={Boolean(uploadState)} onClick={() => fileInputRef.current?.click()}>
          Upload files
        </button>
        <input ref={fileInputRef} className="file-server-visually-hidden" type="file" multiple onChange={(event) => { queueFiles(event.target.files); event.target.value = ''; }} />
      </section>

      <section
        className={`file-server-dropzone ${dragging ? 'is-dragging' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); queueFiles(event.dataTransfer.files); }}
      >
        <strong>Drop files here to upload</strong>
        <span>Files upload directly from this browser to private S3 storage.</span>
      </section>

      {uploadState && (
        <section className="file-server-upload-status" aria-live="polite">
          <div><strong>{uploadState.fileName}</strong><span>{uploadState.status}</span></div>
          <progress value={uploadState.uploadedBytes} max={uploadState.totalBytes || 1} />
          <span>{formatBytes(uploadState.uploadedBytes)} of {formatBytes(uploadState.totalBytes)}</span>
        </section>
      )}
      {error && <p className="file-server-message error" role="alert">{error}</p>}
      {notice && <p className="file-server-message success" role="status">{notice}</p>}

      <nav className="file-server-breadcrumbs" aria-label="File location">
        <button className="file-server-crumb" onClick={() => setFolder('')}>Files</button>
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

      <section className="file-server-browser" aria-label="File browser">
        <div className="file-server-browser-heading">
          <span>Name</span><span>Size</span><span>Modified</span><span>Actions</span>
        </div>
        {loading ? <p className="file-server-empty">Loading files…</p> : (
          <>
            {listing.folders.map((item) => (
              <article className="file-server-row folder" key={item.prefix}>
                <button className="file-server-name-button" onClick={() => setFolder(folderPath(folder, item.name))}>
                  <span aria-hidden="true">▸</span> {item.name}
                </button>
                <span>Folder</span><span>—</span>
                <div className="file-server-row-actions">
                  <button className="file-server-button danger compact" onClick={() => setDeleteFolder({ name: item.name, path: folderPath(folder, item.name) })}>Delete</button>
                </div>
              </article>
            ))}
            {listing.files.map((file) => (
              <article className="file-server-row" key={file.key}>
                <div className="file-server-file-name"><span aria-hidden="true">◻</span> {file.name}</div>
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
      {conflict && <ConflictDialog conflict={conflict} onReplace={() => resolveConflict('replace')} onRename={(name) => resolveConflict('rename', name)} onClose={() => setConflict(null)} />}
      {shareDialog && <ShareDialog state={shareDialog} onCreate={() => void createShare()} onRevoke={(shareId) => void revokeShare(shareId)} onCopy={(url) => void copyShareUrl(url)} onClose={() => setShareDialog(null)} />}
    </main>
  );
}

export default FileServer;
