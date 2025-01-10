import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { showOnlyName } from '../utils/utils';
import '../CSS/Model.css';
import { useActiveSelection } from "../components/selectionContext";

function Model({ modelId, handleAddModel, _selection }) {
    const [model, setModel] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showDetails, setShowDetails] = useState(false);
    const [images, setImages] = useState([]);
    const [files, setFiles] = useState([]);
    const { activeSelection } = useActiveSelection();

    // Helper function to filter image files
    const filterImages = (files) => {
        if (!files || !Array.isArray(files)) return [];
        setFiles(files);
        return files.filter((file) => file.match(/\.(jpeg|jpg|gif|png|webp)$/i));
    };

    useEffect(() => {
        // Fetch model data by ID
        const fetchModel = async () => {
            try {
                const response = await fetch(`http://localhost:5000/models3d/${modelId}`); // Adjust API endpoint
                if (!response.ok) {
                    throw new Error('Failed to fetch model data');
                }
                const data = await response.json();
                setModel(data); // Set the full model data
                setImages(filterImages(data.images)); // Filter and set images
            } catch (err) {
                setError(err.message); // Handle and display errors
            } finally {
                setLoading(false); // Set loading to false in all cases
            }
        };

        fetchModel();
    }, [modelId]);



    const handleCLick = () => {
        //Open model page
        window.location.href = `/models3d/${modelId}`;

    }




    if (loading) {
        return <p>Loading...</p>;
    }

    if (error) {
        return <p>Error is: {error}</p>;
    }

    if (!model) {
        return <p>No model found.</p>;
    }

    return (
        <div className="model-details">

            <div className='model-data'>
                <div className='model-image'>
                    <img src={images[0]} className='hero-image-thumbnail' alt={model.name} onClick={() => handleCLick()} />
                    {activeSelection &&

                        <>
                            {_selection?.models?.includes(modelId) ? (
                                // Remove Button
                                <button
                                    onClick={(e) => {
                                        e.preventDefault();
                                        if (handleAddModel) {
                                            handleAddModel(modelId, false); // Pass false for Remove
                                        }
                                    }}
                                    className="remove-button"
                                >
                                    Remove
                                </button>
                            ) : (
                                // Add Button
                                <button
                                    onClick={(e) => {
                                        e.preventDefault();
                                        if (handleAddModel) {
                                            handleAddModel(modelId, true); // Pass true for Add
                                        }
                                    }}
                                    className="add-button"
                                >
                                    Add
                                </button>
                            )}
                        </>

                    }
                </div>
                <h1>{model.name}</h1>

                <p><strong>Category:</strong> {model.category}</p>
                <p><strong>Class:</strong> {model.class}</p>

                {showDetails && (
                    <>
                        <p><strong>Description:</strong> {model.description || 'N/A'}</p>
                        <p><strong>Brand:</strong> {model.brand || 'N/A'}</p>
                        <p><strong>Price:</strong> {model.price !== null ? `$${model.price.toFixed(2)}` : 'N/A'}</p>
                        <p><strong>Path:</strong> {model.path || 'N/A'}</p>
                        <p><strong>Tags:</strong> {model.tags?.join(', ') || 'N/A'}</p>
                        {model.images?.length > 0 && (
                            <div className="model-images">
                                <h3>Images:</h3>
                                {images.map((image, index) => (
                                    <a href={image} target="_blank" rel="noreferrer" key={index}>
                                        <img src={image} alt={`${model.name} image ${index + 1}`} />
                                    </a>
                                ))}
                            </div>
                        )}
                        {files.length > images.length && (
                            <div className="model-files">
                                <h3>Files:</h3>
                                <ul>
                                    {files.map((file, index) => {
                                        if (!images.includes(file)) {
                                            return (
                                                <li key={index}>
                                                    <a href={file} target="_blank" rel="noreferrer">{showOnlyName(file)}</a>
                                                </li>
                                            );
                                        }
                                        return null;
                                    })}
                                </ul>
                            </div>
                        )}
                    </>
                )}
                <Link to={`/models3d/edit/${modelId}`} className="edit-link">Edit</Link>


            </div>
        </div>
    );
}

export default Model;
