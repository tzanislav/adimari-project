import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { showOnlyName } from '../utils/utils';
import '../CSS/ItemCard.css';

function Item({ itemId: itemId, handleClickItem }) {
    const [item, setItem] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showDetails, setShowDetails] = useState(false);

    const [images, setImages] = useState([]);
    const [files, setFiles] = useState([]);

    const [models, setModels] = useState([]);

    const parentRef = useRef(null);




    // Helper function to filter image files
    const filterImages = (files) => {
        if (!files || !Array.isArray(files)) return [];
        setFiles(files);
        return files.filter((file) => file.match(/\.(jpeg|jpg|gif|png|webp)$/i));
    };

    const handleClickProperty = (property) => {
        if (handleClickProperty) {
            handleClickItem(property);
        }
    };



    useEffect(() => {
        // Fetch item data by ID
        const fetchItems = async () => {
            try {
                const response = await fetch(`http://adimari-tzani:5000/items/${itemId}`); // Adjust API endpoint
                if (!response.ok) {
                    throw new Error('Failed to fetch items data');
                }
                const data = await response.json();
                setItem(data); // Set the full item data
                setImages(filterImages(data.files)); // Filter and set images
            } catch (err) {
                setError(err.message); // Handle and display errors
            } finally {
                setLoading(false); // Set loading to false in all cases
            }
        };

        fetchItems();
    }, [itemId]);

    const handleImageClick = () => {
        setShowDetails(!showDetails);

        setTimeout(() => {
            if (parentRef.current) {
                parentRef.current.scrollIntoView({ behavior: 'smooth' });
            }
        }, 150); // 0.3 seconds delay
    };
    /*
        // Fetch models data for this item
        useEffect(() => {
            const fetchModels = async () => {
                try {
                    const response = await fetch(`http://adimari-tzani:5000/items/${itemId}/models`);
                    if (!response.ok) {
                        throw new Error('Failed to fetch models');
                    }
                    const data = await response.json();
                    setModels(data);
                } catch (err) {
                    setError(err.message);
                }
            };
    
            fetchModels();
        }, [itemId]);
    
    */
    if (loading) {
        return <p>Loading...</p>;
    }

    if (error) {
        return <p>Error is: {error}</p>;
    }

    if (!item) {
        return <p>No Items found.</p>;
    }

    return (

        <div
            className="item-container"
            style={showDetails ? { width: '100%' } : {}}
            ref={parentRef}
        >


            <div className='item-data'>
                <div className="item-property">
                    <p className='item-property-button' onClick={() => { handleClickProperty(item.category) }}>{item.category}</p>
                </div>
                <h1>{item.name}</h1>
                <div className="item-above-fold" >
                    {images.length > 0 ? (
                        <img
                            src={images[0]}
                            className='thumbnail'
                            alt={`${item.name} image`}

                            onClick={handleImageClick}
                        />
                    ) : (
                        <img
                            src='https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/No_image_available.svg/300px-No_image_available.svg.png'
                            className='thumbnail'
                            alt='placeholder'

                            onClick={handleImageClick}
                        />
                    )}
                    <div className="item-properties-above-fold">



                        <div className="item-property">
                            <h4>Brand:</h4>
                            <p className='item-property-button' onClick={() => { handleClickProperty(item.brand) }}>{item.brand}</p>
                        </div>
                    </div>


                </div>


                {showDetails && (
                    <>
                        {images?.length > 0 && (
                            <div className="item-images">
                                <h3>Images:</h3>
                                {images.map((image, index) => (
                                    <a href={image} target="_blank" rel="noreferrer">
                                        <img key={index} src={image} alt={`${item.name} image ${index + 1}`} />
                                    </a>
                                ))}
                            </div>
                        )}
                        {files.length > images.length && (
                            <div className="item-files">
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
                                    })}
                                </ul>
                            </div>
                        )}


                        <div className="item-property">
                            <h4>Class:</h4>
                            <p className='item-property-button' onClick={() => { handleClickProperty(item.class) }}>{item.class}</p>
                        </div>
                        <div className="item-property">
                            <h4>Distributor:</h4>
                            <p className='item-property-button' onClick={() => handleClickProperty(item.distributor)}>{item.distributor || 'N/A'}</p>
                        </div>

                        <div className='item-checkboxes'>
                            <div className="item-checkbox">
                                <p>3D Models on Site</p>
                                <input
                                    className="toggle-input"
                                    id="has3dmodels"
                                    type="checkbox"
                                    checked={item.has3dmodels}
                                    disabled
                                />
                                <label className="toggle-label" htmlFor="has3dmodels"></label>
                            </div>

                            <div className="item-checkbox">
                                <p>DWG Models on Site</p>
                                <input
                                    className="toggle-input"
                                    id="hasDWGmodels"
                                    type="checkbox"
                                    checked={item.hasDWGmodels}
                                    disabled
                                />
                                <label className="toggle-label" htmlFor="hasDWGmodels"></label>
                            </div>
                        </div>


                        <p><strong>Description:</strong></p>
                        <p>{item.description || 'N/A'}</p>

                        <p><strong>Website:</strong></p>
                        <p className='item-property-button' onClick={() => window.open(item.website, '_blank', 'noopener noreferrer')}>{item.website || 'N/A'}</p>

                        <p><strong>Tags:</strong></p>
                        <div className='tags'>
                            {item.tags?.map((tag, index) => (
                                <p className='item-property-button' onClick={() => handleClickProperty(tag)}>{tag}</p>
                            ))}
                        </div>

                            
                        <Link to={`/items/${itemId}`} className="edit-link item-button">Edit</Link>
                    </>
                )}
            </div>
        </div >
    );
}

export default Item;
