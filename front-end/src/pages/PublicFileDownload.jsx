import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import logo from '../assets/LogoBlack.png';
import '../CSS/PublicFileDownload.css';

const serverUrl = import.meta.env.VITE_SERVER_URL || '';

const formatBytes = (value = 0) => {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** unitIndex)).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const readResponse = async (response) => {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'This download link is unavailable.');
  return data;
};

const isArchivePending = (status) => ['queued', 'preparing'].includes(status);

const archiveStatusMessage = (status, folder) => {
  if (status === 'queued') return 'The server has queued this folder snapshot and will package it into one ZIP file shortly.';
  if (status === 'preparing') {
    const processedFiles = Number(folder?.archive?.processedFiles || 0);
    const fileCount = Number(folder?.fileCount || 0);
    const progress = fileCount > 0 ? ` (${processedFiles.toLocaleString()} of ${fileCount.toLocaleString()} files)` : '';
    return `The server is packaging the folder into one ZIP file${progress}. This page will update automatically when it is ready.`;
  }
  if (status === 'failed') return 'The ZIP archive could not be prepared. Please ask the person who shared this folder to create a new link.';
  return 'One ZIP file is prepared before this folder can be downloaded.';
};

function PublicFileDownload() {
  const { token } = useParams();
  const [share, setShare] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState('');

  const loadShareInfo = useCallback(async () => {
    const response = await fetch(`${serverUrl}/download/${encodeURIComponent(token)}/info`);
    return readResponse(response);
  }, [token]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setShare(null);
      setError('');
      setDownloadNotice('');
      try {
        const result = await loadShareInfo();
        if (!active) return;
        setShare(result);
      } catch (requestError) {
        if (active) setError(requestError.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [loadShareInfo]);

  const isFolderShare = share?.type === 'folder' || Boolean(share?.folder);
  const folder = share?.folder;
  const archiveStatus = folder?.archive?.status;
  const archivePending = isFolderShare && isArchivePending(archiveStatus);
  const archiveFailed = isFolderShare && archiveStatus === 'failed';

  useEffect(() => {
    if (!archivePending) return undefined;
    let active = true;
    const refreshArchiveStatus = async () => {
      try {
        const result = await loadShareInfo();
        if (!active) return;
        setShare(result);
        setError('');
      } catch (requestError) {
        if (active) setError(requestError.message);
      }
    };
    const intervalId = window.setInterval(() => void refreshArchiveStatus(), 3000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [archivePending, loadShareInfo]);

  const startDownload = async () => {
    try {
      setDownloading(true);
      setError('');
      setDownloadNotice('');
      const response = await fetch(`${serverUrl}/download/${encodeURIComponent(token)}/download`, { method: 'POST' });
      const result = await readResponse(response);
      if (response.status === 202) {
        setShare((previous) => (previous?.folder ? {
          ...previous,
          folder: {
            ...previous.folder,
            archive: { ...previous.folder.archive, ...result.archive },
          },
        } : previous));
        setDownloadNotice('The server is preparing one ZIP file for this folder. This page will update automatically when it is ready.');
        setDownloading(false);
        return;
      }
      if (!result.downloadUrl) throw new Error('The download is not ready yet. Please try again shortly.');
      window.location.assign(result.downloadUrl);
    } catch (requestError) {
      setError(requestError.message);
      setDownloading(false);
    }
  };

  return (
    <main className="public-file-download-page">
      <video className="public-file-download-video" autoPlay muted loop playsInline aria-hidden="true">
        <source src="/home_Back.mp4" type="video/mp4" />
      </video>
      <div className="public-file-download-overlay" />
      <header className="public-file-download-topbar">Adimari Database</header>
      <section className="public-file-download-content">
        <img src={logo} alt="Adimari" className="public-file-download-logo" />
        <article className={`public-file-download-card${isFolderShare ? ' is-folder-share' : ''}`} aria-live="polite">
          {loading && <p>Loading share details...</p>}
          {!loading && !share && error && <><h1>Link unavailable</h1><p>{error}</p></>}
          {!loading && share && !isFolderShare && <>
            <p className="public-file-download-eyebrow">Shared file</p>
            <h1 title={share.file.name}>{share.file.name}</h1>
            <p className="public-file-download-size">{formatBytes(share.file.size)}</p>
            {error && <p className="public-file-download-error">{error}</p>}
            <button type="button" onClick={() => void startDownload()} disabled={downloading}>
              {downloading ? 'Preparing download...' : 'Download'}
            </button>
          </>}
          {!loading && share && isFolderShare && <>
            <p className="public-file-download-eyebrow">Shared folder</p>
            <h1 title={folder.name}>{folder.name}</h1>
            <p className="public-file-download-size">
              {Number(folder.fileCount || 0).toLocaleString()} file{folder.fileCount === 1 ? '' : 's'} · {formatBytes(folder.totalBytes)}
            </p>
            <p className={`public-file-download-archive-status ${archiveStatus || 'pending'}`} role={archivePending ? 'status' : undefined}>
              {archiveStatus === 'ready' ? `ZIP ready${folder.archive?.size ? ` · ${formatBytes(folder.archive.size)}` : ''}` : archiveStatusMessage(archiveStatus, folder)}
            </p>
            {downloadNotice && <p className="public-file-download-notice" role="status">{downloadNotice}</p>}
            {error && <p className="public-file-download-error">{error}</p>}
            <div className="public-file-download-file-list" aria-label="Files in this shared folder">
              {(folder.files || []).length > 0 ? (
                <ul>
                  {folder.files.map((item) => (
                    <li key={item.path || item.name}>
                      <span title={item.path || item.name}>{item.path || item.name}</span>
                      <span>{formatBytes(item.size)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{folder.fileCount ? 'The folder file list is unavailable.' : 'This shared folder is empty.'}</p>
              )}
            </div>
            <button type="button" onClick={() => void startDownload()} disabled={downloading || archivePending || archiveFailed}>
              {downloading ? 'Starting download...' : archivePending ? 'Preparing ZIP...' : archiveFailed ? 'Archive unavailable' : 'Download all files'}
            </button>
          </>}
        </article>
      </section>
    </main>
  );
}

export default PublicFileDownload;
