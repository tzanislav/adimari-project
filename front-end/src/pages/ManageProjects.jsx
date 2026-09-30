/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchWithAuth } from '../utils/authHeaders';
import { projectThumbnailUrl } from '../utils/projectDirectory';
import '../CSS/Projects.css';
import '../CSS/ManageProjects.css';

const baseUrl = `${import.meta.env.VITE_SERVER_URL || ''}/api/project-directory`;
const blankForm = { title: '', description: '', link: { type: 'internal', value: '' }, thumbnail: '', thumbnailAlt: '', access: 'public', healthUrl: '' };

async function api(path = '', options = {}) {
  const response = await fetchWithAuth(`${baseUrl}${path}`, options);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || `Request failed (${response.status}).`);
  }
  return response.status === 204 ? null : response.json();
}

function ProjectModal({ project, onClose, onSaved }) {
  const [form, setForm] = useState(project ? {
    title: project.title, description: project.description, link: { ...project.link },
    thumbnail: project.thumbnail, thumbnailAlt: project.thumbnailAlt || '',
    access: project.access, healthUrl: project.healthUrl || '',
  } : { ...blankForm, link: { ...blankForm.link } });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const firstInput = useRef(null);
  const dialog = useRef(null);

  useEffect(() => { firstInput.current?.focus(); }, []);
  useEffect(() => {
    if (!file) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const setField = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const setLink = (name, value) => setForm((current) => ({ ...current, link: { ...current.link, [name]: value } }));

  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && !saving) onClose();
    if (event.key !== 'Tab') return;
    const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      let thumbnail = form.thumbnail;
      if (file) {
        const body = new FormData();
        body.append('image', file);
        thumbnail = (await api('/images', { method: 'POST', body })).path;
      }
      await api(project ? `/${project.id}` : '', {
        method: project ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, thumbnail }),
      });
      onSaved();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="project-manage-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section ref={dialog} className="project-manage-modal" role="dialog" aria-modal="true" aria-labelledby="project-modal-title" onKeyDown={handleKeyDown}>
        <h2 id="project-modal-title">{project ? 'Edit project' : 'Add project'}</h2>
        <form onSubmit={save}>
          <label>Title<input ref={firstInput} required maxLength="100" value={form.title} onChange={(event) => setField('title', event.target.value)} /></label>
          <label>Description<textarea maxLength="500" rows="3" value={form.description} onChange={(event) => setField('description', event.target.value)} /></label>
          <div className="project-manage-field-pair">
            <label>Link type<select value={form.link.type} onChange={(event) => setLink('type', event.target.value)}><option value="internal">Inside this app</option><option value="external">External website</option></select></label>
            <label>Access level<select value={form.access} onChange={(event) => setField('access', event.target.value)}><option value="public">Public</option><option value="mod">Mod</option><option value="admin">Admin</option></select></label>
          </div>
          <label>{form.link.type === 'internal' ? 'App path' : 'Website URL'}<input required placeholder={form.link.type === 'internal' ? '/projects/...' : 'https://example.com'} value={form.link.value} onChange={(event) => setLink('value', event.target.value)} /></label>
          <label>Health check URL <span className="project-manage-hint">Optional. External links use their website URL when blank; internal pages show Not checked.</span><input type="url" placeholder="https://example.com/health" value={form.healthUrl} onChange={(event) => setField('healthUrl', event.target.value)} /></label>
          <label>Thumbnail <span className="project-manage-hint">PNG, JPEG, or WebP, up to 2 MB</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
          {(preview || form.thumbnail) && <img className="project-manage-preview" src={preview || projectThumbnailUrl(form.thumbnail)} alt="Thumbnail preview" />}
          <label>Thumbnail description<input maxLength="150" value={form.thumbnailAlt} onChange={(event) => setField('thumbnailAlt', event.target.value)} /></label>
          {error && <p className="project-manage-error" role="alert">{error}</p>}
          <div className="project-manage-actions">
            <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save project'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function healthLabel(health) {
  return { live: 'Live', unavailable: 'Unavailable', unknown: 'Unknown', checking: 'Checking…', not_checked: 'Not checked' }[health?.state] || 'Not checked';
}

function ManageProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalProject, setModalProject] = useState(undefined);
  const [moving, setMoving] = useState(false);
  const [draggedId, setDraggedId] = useState(null);

  const load = async () => {
    try { setProjects(await api('/manage')); setError(''); }
    catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (moving || modalProject !== undefined) return undefined;
    const timer = setInterval(() => { void load(); }, 60 * 1000);
    return () => clearInterval(timer);
  }, [moving, modalProject]);

  const saved = () => { setModalProject(undefined); void load(); };

  const remove = async (project) => {
    if (!window.confirm(`Delete “${project.title}” from the Projects page?`)) return;
    try { await api(`/${project.id}`, { method: 'DELETE' }); await load(); }
    catch (deleteError) { setError(deleteError.message); }
  };

  const reorder = async (from, to) => {
    if (moving || from < 0 || to < 0 || from >= projects.length || to >= projects.length || from === to) return;
    const next = [...projects];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setProjects(next);
    setMoving(true);
    try { await api('/order', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: next.map((project) => project.id) }) }); setError(''); }
    catch (orderError) { setProjects(projects); setError(orderError.message); }
    finally { setMoving(false); }
  };

  return (
    <main className="project-manage">
      <Link to="/projects" className="project-directory-back">← Back to Projects</Link>
      <div className="project-manage-heading"><div><h1>Edit projects</h1><p>Drag rows or use the arrows to set their order.</p></div><button type="button" onClick={() => setModalProject(null)}>Add project</button></div>
      {error && <p className="project-manage-error" role="alert">{error}</p>}
      {loading ? <p>Loading projects…</p> : (
        <ul className="project-manage-list">
          {projects.map((project, index) => (
            <li key={project.id} draggable={!moving} onDragStart={() => setDraggedId(project.id)} onDragEnd={() => setDraggedId(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void reorder(projects.findIndex((item) => item.id === draggedId), index); setDraggedId(null); }}>
              <span className="project-manage-grip" aria-hidden="true">⠿</span>
              {project.thumbnail ? <img src={projectThumbnailUrl(project.thumbnail)} alt="" /> : <span className="project-manage-empty-thumbnail" aria-hidden="true">—</span>}
              <div className="project-manage-details"><strong>{project.title}</strong><span>{project.link.value}</span><small>{project.access === 'mod' ? 'Mod' : project.access === 'admin' ? 'Admin' : 'Public'} · {healthLabel(project.health)}{project.health?.checkedAt ? ` · ${new Date(project.health.checkedAt).toLocaleString()}` : ''}</small></div>
              <div className="project-manage-row-actions"><button type="button" disabled={moving || index === 0} onClick={() => reorder(index, index - 1)} aria-label={`Move ${project.title} up`}>↑</button><button type="button" disabled={moving || index === projects.length - 1} onClick={() => reorder(index, index + 1)} aria-label={`Move ${project.title} down`}>↓</button><button type="button" onClick={() => setModalProject(project)}>Edit</button><button type="button" onClick={() => remove(project)}>Delete</button></div>
            </li>
          ))}
        </ul>
      )}
      {modalProject !== undefined && <ProjectModal key={modalProject?.id || 'new'} project={modalProject} onClose={() => setModalProject(undefined)} onSaved={saved} />}
    </main>
  );
}

export default ManageProjects;
