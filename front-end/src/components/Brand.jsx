import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { showOnlyName } from '../utils/utils';
import '../CSS/Brand.css';


function Brand({ brandId, handleClickItem }) {
    const [brand, setBrand] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showDetails, setShowDetails] = useState(false);

    const [images, setImages] = useState([]);
    const [files, setFiles] = useState([]);

    const [models, setModels] = useState([]);




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
        // Fetch brand data by ID
        const fetchBrand = async () => {
            try {
                const response = await fetch(`http://localhost:5000/brands/${brandId}`); // Adjust API endpoint
                if (!response.ok) {
                    throw new Error('Failed to fetch brand data');
                }
                const data = await response.json();
                setBrand(data); // Set the full brand data
                setImages(filterImages(data.files)); // Filter and set images
            } catch (err) {
                setError(err.message); // Handle and display errors
            } finally {
                setLoading(false); // Set loading to false in all cases
            }
        };

        fetchBrand();
    }, [brandId]);


    // Fetch models data for this brand
    useEffect(() => {
        const fetchModels = async () => {
            try {
                const response = await fetch(`http://localhost:5000/brands/${brandId}/models`);
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
    }, [brandId]);


    if (loading) {
        return <p>Loading...</p>;
    }

    if (error) {
        return <p>Error is: {error}</p>;
    }

    if (!brand) {
        return <p>No brand found.</p>;
    }

    return (

        <div className="brand-details"  >

            <div className='brand-data'>
                <div className="brand-above-fold">
                    {images.length > 0 ? (
                        <img src={images[0]} className='thumbnail' alt={`${brand.name} image`} onClick={() => setShowDetails(!showDetails)} />) : (
                            <img src='https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/No_image_available.svg/300px-No_image_available.svg.png' className='thumbnail' alt='placeholder' onClick={() => setShowDetails(!showDetails)} />)}
                    <h1>{brand.name}</h1>

                    <div className="brand-property">
                        <h4>Category:</h4>
                        <p className='brand-property-button' onClick={() => { handleClickProperty(brand.category) }}>{brand.category}</p>
                    </div>

                    <div className="brand-property">
                        <h4>Class:</h4>
                        <p className='brand-property-button' onClick={() => { handleClickProperty(brand.class) }}>{brand.class}</p>
                    </div>
                    <div className="brand-property">
                        <h4>Distributor:</h4>
                        <p className='brand-property-button' onClick={() => handleClickProperty(brand.distributor)}>{brand.distributor || 'N/A'}</p>
                    </div>
                    <div className='brand-checkboxes'>
                        <div className="brand-checkbox">
                            <p>3D Models on Site</p>
                            <input
                                className="toggle-input"
                                id="has3dmodels"
                                type="checkbox"
                                checked={brand.has3dmodels}
                                disabled
                            />
                            <label className="toggle-label" htmlFor="has3dmodels"></label>
                        </div>

                        <div className="brand-checkbox">
                            <p>DWG Models on Site</p>
                            <input
                                className="toggle-input"
                                id="hasDWGmodels"
                                type="checkbox"
                                checked={brand.hasDWGmodels}
                                disabled
                            />
                            <label className="toggle-label" htmlFor="hasDWGmodels"></label>
                        </div>
                    </div>
                </div>

                <button className="show-details-button" onClick={() => setShowDetails(!showDetails)}>{showDetails ? 'Hide Details' : 'Show Details'}</button>
                {showDetails && (
                    <>
                        <p><strong>Description:</strong></p>
                        <p>{brand.description || 'N/A'}</p>

                        <p><strong>Website:</strong></p>
                        <p className='brand-property-button' onClick={() => window.open(brand.website, '_blank', 'noopener noreferrer')}>{brand.website || 'N/A'}</p>

                        <p><strong>Location:</strong></p>
                        <p className='brand-property-button' onClick={() => handleClickProperty(brand.location)}>{brand.location || 'N/A'}</p>

                        <p><strong>Contact:</strong></p>
                        <p className='brand-property-button' onClick={() => handleClickProperty(brand.personToContact)}>{brand.personToContact || 'N/A'}</p>

                        <p><strong>Email:</strong></p>
                        <p>{brand.email || 'N/A'}</p>

                        <p><strong>Phone:</strong></p>
                        <p>{brand.phone || 'N/A'}</p>

                        <p><strong>Discount:</strong></p>
                        <p>{brand.discount !== null ? `${brand.discount}%` : 'N/A'}</p>

                        <p><strong>Tags:</strong></p>
                        <div className='tags'>
                            {brand.tags?.map((tag, index) => (
                                <p className='brand-property-button' onClick={() => handleClickProperty(tag)}>{tag}</p>
                            ))}
                        </div>

                        <p><strong>Files:</strong></p>
                        <p className='brand-property-button' onClick={() => handleClickProperty(brand.models3D?.join(', '))}>{brand.models3D?.join(', ') || 'N/A'}</p>

                        {brand.images?.length > 0 && (
                            <div className="brand-images">
                                <h3>Images:</h3>
                                {images.map((image, index) => (
                                    <a href={image} target="_blank" rel="noreferrer">
                                        <img key={index} src={image} alt={`${brand.name} image ${index + 1}`} />
                                    </a>
                                ))}
                            </div>
                        )}
                        {files.length > images.length && (
                            <div className="brand-files">
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

                        <div className="brand-models thumbnails">
                            <h3>Models:</h3>
                            {models.map((model) => (
                                model.images.length > 0 ? (
                                    <Link key={model._id} to={`/models3d/${model._id}`}><img src={`${model.images[0]}`} alt={`${model.name} image`} className='thumbnail' /></Link>
                                ) : (
                                    <Link key={model._id} to={`/modelsdwg/${model._id}`}>{model.name}</Link>
                                )
                            ))}
                        </div>
                        <Link to={`/brands/${brandId}`} className="edit-link brand-button">Edit</Link>
                    </>
                )}
            </div>
        </div >
    );
}

export default Brand;
