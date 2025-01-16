import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

function ListProject({ _project, onDelete }) {
    const navigate = useNavigate();

    const handleClick = () => {
        navigate(`/projects/${_project._id}`);
    };

    return (
        <div 
            className='list-project-item' 
            onClick={handleClick}
            style={{ cursor: 'pointer' }}
        >
            <div className='list-project-title'>
                <h2>{_project.name}</h2>
                <p>{_project.description}</p>
            </div>
            <div className='list-project-buttons'>
                <button 
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete(_project._id);
                    }}
                >
                    Delete
                </button>
            </div>
        </div>
    );
}

export default ListProject;
