import { useEffect, useState } from 'react';
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

function PublicFileDownload() {
  const { token } = useParams();
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`${serverUrl}/download/${encodeURIComponent(token)}/info`);
        const result = await readResponse(response);
        if (active) setFile(result.file);
      } catch (requestError) {
        if (active) setError(requestError.message);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [token]);

  const startDownload = async () => {
    try {
      setDownloading(true);
      setError('');
      const response = await fetch(`${serverUrl}/download/${encodeURIComponent(token)}/download`, { method: 'POST' });
      const result = await readResponse(response);
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
        <article className="public-file-download-card" aria-live="polite">
          {loading && <p>Loading file details…</p>}
          {!loading && error && <><h1>Link unavailable</h1><p>{error}</p></>}
          {!loading && file && <>
            <p className="public-file-download-eyebrow">Shared file</p>
            <h1 title={file.name}>{file.name}</h1>
            <p className="public-file-download-size">{formatBytes(file.size)}</p>
            {error && <p className="public-file-download-error">{error}</p>}
            <button type="button" onClick={() => void startDownload()} disabled={downloading}>
              {downloading ? 'Preparing download…' : 'Download'}
            </button>
          </>}
        </article>
        
      </section>
    </main>
  );
}

export default PublicFileDownload;
