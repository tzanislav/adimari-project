import React, {useState, useEffect} from "react";
import { Link } from "react-router-dom";
import ListProject from "../components/ListProject";
import '../CSS/Projects.css';

function Projects() {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetch('http://localhost:5000/projects')
            .then((response) => response.json())
            .then((data) => {
                setProjects(data);
                setLoading(false);
            })
            .catch((error) => {
                setError(error);
                setLoading(false);
            });
    }, []);


    const handleDelete = async (id) => {
        try {
            await fetch(`http://localhost:5000/projects/${id}`, {
                method: 'DELETE',
            });
            setProjects((prev) => prev.filter((project) => project._id !== id));
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
            <Link to="/projects/new">Create a new project</Link>

                {projects.map((project) => (
                    <div key={project._id} className='list-project-container'>
                        <ListProject _project={project} onDelete={handleDelete} />
                    </div>
                ))}

        </div>
    );
}

export default Projects;