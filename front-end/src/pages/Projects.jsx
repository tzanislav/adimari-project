import React, {useState, useEffect} from "react";
import { Link } from "react-router-dom";


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

    if (loading) {
        return <p>Loading...</p>;
    }

    if (error) {
        return <p>Failed to load projects: {error.toString()}</p>;
    }

    return (
        <div>
            <h1>Projects</h1>
            <Link to="/projects/new">Create a new project</Link>
            <ul>
                {projects.map((project) => (
                    <li key={project.id}>
                        <h2>{project.name}</h2>
                        <p>{project.description}</p>
                        <Link to={`/projects/${project._id}`}>Open</Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default Projects;