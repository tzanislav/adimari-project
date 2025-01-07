import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { showOnlyName } from '../utils/utils';

function Brand({ brandId }) {
    const [brand, setBrand] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showDetails, setShowDetails] = useState(false);

    const [images, setImages] = useState([]);
    const [files, setFiles] = useState([]);
    // Helper function to filter image files
    const filterImages = (files) => {
        if (!files || !Array.isArray(files)) return [];
        setFiles(files);
        return files.filter((file) => file.match(/\.(jpeg|jpg|gif|png|webp)$/i));
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

        <div className="brand-details" onClick={() => setShowDetails(!showDetails)} >

            <div className='brand-data'>
                <h1>{brand.name}</h1>

                {/* Styled Checkboxes */}
                <div className="checkbox-wrapper">
                    <div className="checkbox-wrapper-38">
                        <input
                            className="toggle-input"
                            id="has3dmodels"
                            type="checkbox"
                            checked={brand.has3dmodels}
                            disabled
                        />
                        <label className="toggle-label" htmlFor="has3dmodels"></label>
                        <span>3D Models on Site</span>
                    </div>

                    <div className="checkbox-wrapper-38">
                        <input
                            className="toggle-input"
                            id="hasDWGmodels"
                            type="checkbox"
                            checked={brand.hasDWGmodels}
                            disabled
                        />
                        <label className="toggle-label" htmlFor="hasDWGmodels"></label>
                        <span>DWG Models on Site</span>
                    </div>
                </div>
                <p><strong>Category:</strong> {brand.category}</p>
                <p><strong>Class:</strong> {brand.class}</p>

                {showDetails && (
                    <>
                        <p><strong>Description:</strong> {brand.description || 'N/A'}</p>
                        <p><strong>Website:</strong> <a href={brand.website} target="_blank" rel="noopener noreferrer">{brand.website || 'N/A'}</a></p>
                        <p><strong>Distributor:</strong> {brand.distributor || 'N/A'}</p>
                        <p><strong>Location:</strong> {brand.location || 'N/A'}</p>
                        <p><strong>Contact:</strong> {brand.personToContact || 'N/A'}</p>
                        <p><strong>Email:</strong> {brand.email || 'N/A'}</p>
                        <p><strong>Phone:</strong> {brand.phone || 'N/A'}</p>
                        <p><strong>Discount:</strong> {brand.discount !== null ? `${brand.discount}%` : 'N/A'}</p>
                        <p><strong>Tags:</strong> {brand.tags?.join(', ') || 'N/A'}</p>
                        <p><strong>3D Models:</strong> {brand.models3D?.join(', ') || 'N/A'}</p>
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


                    </>
                )}
                <Link to={`/brands/${brandId}`} className="edit-link">Edit</Link>
            </div>
        </div>
    );
}

export default Brand;
