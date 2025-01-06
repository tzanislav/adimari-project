import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

function Brand({ brandId }) {
    const [brand, setBrand] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showDetails, setShowDetails] = useState(false);

    useEffect(() => {
        // Fetch brand data by ID
        const fetchBrand = async () => {
            try {
                const response = await fetch(`http://localhost:5000/brands/${brandId}`); // Adjust URL
                if (!response.ok) {
                    throw new Error('Failed to fetch brand data');
                }
                const data = await response.json();
                setBrand(data);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchBrand();
    }, [brandId]);

    if (loading) {
        return <p>Loading...</p>;
    }

    if (error) {
        return <p>Error: {error}</p>;
    }

    if (!brand) {
        return <p>No brand found.</p>;
    }

    return (
        <div className="brand-details" onClick={() => setShowDetails(!showDetails)}>
            
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
                                {brand.images.map((image, index) => (
                                    <img key={index} src={image} alt={`${brand.name} image ${index + 1}`} />
                                ))}
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
