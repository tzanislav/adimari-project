import React, { useState, useEffect } from "react";
import { useActiveSelection } from "../context/selectionContext";
import { Link } from "react-router-dom";
import { showOnlyName } from '../utils/utils';


function ItemDetails({ item, handleClickItem, user, onClose }) {
    const [images, setImages] = useState([]);
    const { activeSelection } = useActiveSelection();
    const [isPresent, setIsPresent] = useState(false);
    const [files, setFiles] = useState([]);


    useEffect(() => {
        if (activeSelection) {
            setIsPresent(
                activeSelection.items?.some((obj) => obj._id === item._id)
            );
        }

        setFiles(item.files || []);
        setImages(filterImages(item.files));


    }, [activeSelection, item._id]);

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



    if (!item) {
        return null;
    }

    return (
        <div className="item-box-container">
            <div className="overlay" onClick={(e) => { onClose(); e.stopPropagation; }}></div>
            <div className="item-box">
                <div className="item-box-content">
                    <h1>{item.name}</h1>
                    <div className="item-property">
                        <h3>Images:</h3>
                        {images?.length > 0 && (
                            <div className="item-images">
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
                    </div>
                    <div className="item-property">
                        <p><strong>Website:</strong></p>
                        <p className='item-property-button' onClick={() => window.open(item.website, '_blank', 'noopener noreferrer')}>{item.website || 'N/A'}</p>
                    </div>
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
                        <p><strong>Model Path:</strong></p>
                        <p>{item.modelPath || 'N/A'}</p>
                    </div>


                    <div className="item-property">
                        <p><strong>Tags:</strong></p>
                        <div className='tags'>
                            {item.tags?.map((tag, index) => (
                                <p className='item-property-button' key={`${tag}-${index}`} onClick={() => handleClickProperty(tag)}>{tag}</p>
                            ))}
                        </div>
                    </div>

                    <div className="item-property">
                        {user && <Link to={`/items/${item._id}`} className="edit-link item-button">Edit</Link>}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ItemDetails;
