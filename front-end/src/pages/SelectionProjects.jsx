import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ListProject from '../components/ListProject';
import DeleteBox from '../components/DeleteBox';
import '../CSS/Projects.css';
import { useActiveSelection } from '../context/selectionContext';
import { getAuthHeaders } from '../utils/authHeaders';

function SelectionProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { serverUrl } = useActiveSelection();

  useEffect(() => {
    fetch(`${serverUrl}/api/projects`)
      .then((response) => response.json())
      .then((data) => {
        setProjects(data);
        setLoading(false);
        setIsDeleting(false);
      })
      .catch((fetchError) => {
        setError(fetchError);
        setLoading(false);
      });
  }, [serverUrl]);

  const handleDelete = async (id) => {
    try {
      const headers = await getAuthHeaders();
      await fetch(`${serverUrl}/api/projects/${id}`, {
        method: 'DELETE',
        headers,
      });
      setProjects((previousProjects) => previousProjects.filter((project) => project._id !== id));
      setIsDeleting(false);
    } catch (deleteError) {
      console.error('Failed to delete project:', deleteError);
    }
  };

  if (loading) {
    return <p>Loading...</p>;
  }

  if (error) {
    return <p>Failed to load projects: {error.toString()}</p>;
  }

  return (
    <div className="projects-page selection-project-page">
      <Link to="/projects" className="project-directory-back">Back to Projects</Link>
      <h1>Selection</h1>
      <Link to="/projects/new" className="link">Add a new project</Link>

      {isDeleting && (
        <DeleteBox
          itemName="project"
          deleteFunction={() => handleDelete(isDeleting)}
          closeFunction={() => setIsDeleting(false)}
        />
      )}

      {projects.map((project) => (
        <div key={project._id} className="list-project-container">
          <ListProject _project={project} onDelete={setIsDeleting} />
        </div>
      ))}
    </div>
  );
}

export default SelectionProjects;
