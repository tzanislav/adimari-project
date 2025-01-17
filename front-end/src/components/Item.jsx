import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { showOnlyName } from '../utils/utils';
import '../CSS/ItemCard.css';
import { useActiveSelection } from "../components/selectionContext";


function Item({ item, handleClickItem, _handleAddRemoveModel, isWorking }) {

    const parentRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showDetails, setShowDetails] = useState(false);
    const [images, setImages] = useState([]);
    const [files, setFiles] = useState([]);
    const [models, setModels] = useState([]);
    const { activeSelection } = useActiveSelection();
    const [isPresent, setIsPresent] = useState(false);

    useEffect(() => {
        if (activeSelection) {
            setIsPresent(activeSelection.items?.includes(item._id));
        }
    }, [activeSelection]);




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

    const handleImageClick = () => {
        setShowDetails(!showDetails);

        setTimeout(() => {
            if (parentRef.current) {
                parentRef.current.scrollIntoView({ behavior: 'smooth' });
            }
        }, 150); // 0.3 seconds delay
    };

    
    const handleAddRemoveModel  = (isAdding, item) => {
        console.log(isAdding ? 'Local Adding model' : 'Local Deleting', item);
        setIsPresent(isAdding);
        _handleAddRemoveModel(isAdding, item);
    };




    if (loading) {
        if (item) {
            setImages(filterImages(item.files));
            setLoading(false); // Set loading to false in all cases
        }
        return <p>Loading...</p>;
    }

    if (error) {
        return <p className='error'>Error : {error}</p>;
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
                    <div className='thumbnail-container'>
                        {(activeSelection) &&
                            <>
                                {isPresent ? (
                                    // Remove Button
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault();
                                            if (handleAddRemoveModel) {
                                                handleAddRemoveModel(false, item); // Pass false for Remove
                                            }
                                            else {
                                                console.log("No handleAddRemoveModel function provided");
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
                                            if (handleAddRemoveModel) {
                                                handleAddRemoveModel(true, item); // Pass true for Add
                                            }
                                        }}
                                        className="add-button"
                                    >
                                        Add
                                    </button>
                                )}
                            </>
                        }
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
                    </div>
                    <div className="item-properties-above-fold">
                        <div className="item-property">
                            <h4>Brand:</h4>
                            <p className='item-property-button' onClick={() => { handleClickProperty(item.brand) }}>{item.brand}</p>
                        </div>
                    </div>
                </div>


                {showDetails && (
                    <div className="item-below">
                        {images?.length > 0 && (
                            <div className="item-images">
                                <h3>Images:</h3>
                                {images.map((image, index) => (
                                    <a key={`${image}-${index}`} href={image} target="_blank" rel="noreferrer">
                                        <img src={image} alt={`${item.name} image ${index + 1}`} />
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
                                                    <a href={file} target="_blank" rel="noreferrer">{showOnlyName(file, 50)}</a>
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
                        <div className="item-property">
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
                        </div>

                        <div className="item-property">
                            <p><strong>Description:</strong></p>
                            <p>{item.description || 'N/A'}</p>
                        </div>

                        <div className="item-property">
                            <p><strong>Website:</strong></p>
                            <p className='item-property-button' onClick={() => window.open(item.website, '_blank', 'noopener noreferrer')}>{item.website || 'N/A'}</p>
                        </div>

                        <div className="item-property">
                            <p><strong>Tags:</strong></p>
                            <div className='tags'>
                                {item.tags?.map((tag, index) => (
                                    <p className='item-property-button' key={`${tag}-${index}`} onClick={() => handleClickProperty(tag)}>{tag}</p>
                                ))}
                            </div>
                        </div>

                        <Link to={`/items/${item._id}`} className="edit-link item-button">Edit</Link>
                    </div>
                )}
            </div>
        </div >
    );
}

export default Item;
