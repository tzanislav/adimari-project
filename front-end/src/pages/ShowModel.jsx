import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import '../CSS/ShowPage.css';
import { Link } from 'react-router-dom';


function ShowModel() {

    const { id } = useParams();

    const [model, setModel] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [copyText, setCopyText] = useState('Copy Path');

    const [showImageIndex, setShowImageIndex] = useState(0);

    useEffect(() => {
        const fetchModel = async () => {
            try {
                const response = await fetch(`${serverUrl}/api/models3d/${id}`);
                if (!response.ok) {
                    throw new Error('Failed to fetch model data');
                }
                const data = await response.json();
                setModel(data);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchModel();
    }, [id]);

    const copyToClipboard = () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard
                .writeText(model.path)
                .then(() => {
                    setCopyText('Copied!');
                })
                .catch((err) => {
                    console.error('Failed to copy path:', err);
                    alert('Failed to copy path.');
                });
        } else {
            alert('Clipboard API is not supported in this browser.');
        }
    };


    if (loading) {
        return <p>Loading...</p>;
    }



    return (
        <div className="model-page-container">
            <h1>{model.name}</h1>
            <button onClick={() => window.history.back()}>Back</button>
            <div className="model-data-container">
                {model.images.length > 0 ? (

                    <>
                        <div className="hero-image-container">
                            <img src={model.images[showImageIndex]} alt={model.name} className="hero-image" />
                            <div className="thumbnails">
                                {model.images.map((image, index) => (
                                    <img
                                        key={index}
                                        src={image}
                                        alt={model.name}
                                        className={index === showImageIndex ? 'active' : ''}
                                        onClick={() => setShowImageIndex(index)}
                                    />
                                ))}
                            </div>
                        </div>
                    </>

                ) : null}
                <div className="model-show-data">
                    <p>Description: <br /><strong>{model.description}</strong></p>
                    <p>Category: <br /><strong>{model.category}</strong></p>
                    <p>Class: <br /><strong>{model.class}</strong></p>
                    <p>Tags: <br /><strong>{model.tags.map((tag, index) => (
                        <span key={index} className='tag'>{tag}</span>
                    ))}</strong></p>
                    <p>Brand: <br /><strong>{model.brand}</strong></p>
                    <p>Price: <br /><strong>{model.price}</strong></p>
                    <p>Path: <br /><strong>{model.path}</strong></p>
                    <button onClick={copyToClipboard}>{copyText}</button>                    
                    <Link to={`/api/models3d/edit/${model._id}/`} className="edit-link">Edit</Link>
                </div>
            </div>
        </div >
    );
}

export default ShowModel;
