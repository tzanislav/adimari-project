import React, {useState, useEffect} from "react";
import { Link } from "react-router-dom";
import ListProject from "../components/ListProject";
import DeleteBox from "../components/DeleteBox";
import '../CSS/projects.css';
import { useActiveSelection } from "../components/selectionContext";

function Projects() {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const {serverUrl} = useActiveSelection();

    useEffect(() => {
        fetch(`${serverUrl}/api/projects`)
            .then((response) => response.json())
            .then((data) => {
                setProjects(data);
                setLoading(false);
                setIsDeleting(false);
            })
            .catch((error) => {
                setError(error);
                setLoading(false);
            });
    }, []);


    const handleDelete = async (id) => {
        try {
            await fetch(`${serverUrl}/api/projects/${id}`, {
                method: 'DELETE',
            });
            setProjects((prev) => prev.filter((project) => project._id !== id));
            setIsDeleting(false);
        } catch (error) {
            console.error("Failed to delete project:", error);
        }
    };

    if (loading) {
        return <p>Loading...</p>;
    }

    if (error) {
        return <p>Failed to load projects: {error.toString()}</p>;
    }

    return (
        <div className="projects-page"> 
            <h1>Projects</h1>
            <Link to="/projects/new" className="link">Add a new project</Link>

            {isDeleting && (
                <DeleteBox itemName="project" deleteFunction={() => handleDelete(isDeleting)} closeFunction={() => setIsDeleting(false)}/>
            )}

                {projects.map((project) => (
                    <div key={project._id} className='list-project-container'>
                        <ListProject _project={project} onDelete={setIsDeleting} />
                    </div>
                ))}

        </div>
    );
}

export default Projects;