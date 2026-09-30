import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ProjectLinkCard from '../components/ProjectLinkCard';
import { useAuth } from '../context/AuthContext';
import { fetchWithAuth } from '../utils/authHeaders';
import '../CSS/Projects.css';

const serverUrl = import.meta.env.VITE_SERVER_URL || '';

function Projects() {
  const { user, role } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const response = await (user ? fetchWithAuth : fetch)(`${serverUrl}/api/project-directory`);
        if (!response.ok) throw new Error('Could not load projects.');
        const result = await response.json();
        if (!cancelled) { setProjects(result); setError(''); }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, role]);

  return (
    <main className="project-directory">
      <h1>Projects</h1>
      <p className="project-directory-intro">Choose a project to continue.</p>
      {loading && <p>Loading projects…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && (
        <div className="project-link-card-grid">
          {projects.map((project) => <ProjectLinkCard key={project.id} {...project} />)}
        </div>
      )}
      {role === 'admin' && <Link className="project-directory-edit" to="/projects/manage">Edit projects</Link>}
    </main>
  );
}

export default Projects;
