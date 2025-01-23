import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { showOnlyName } from '../utils/utils';
import '../CSS/ItemCard.css';
import { useActiveSelection } from "../context/selectionContext";
import { useAuth } from '../context/AuthContext';


function Item({ item, handleClickItem, _handleAddRemoveModel, isWorking, handleShowDetails }) {

    const parentRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showDetails, setShowDetails] = useState(false);
    const [images, setImages] = useState([]);
    const [files, setFiles] = useState([]);
    const [models, setModels] = useState([]);
    const { activeSelection } = useActiveSelection();
    const [isPresent, setIsPresent] = useState(false);
    const { user } = useAuth();

    useEffect(() => {
        if (activeSelection) {
            setIsPresent(
                activeSelection.items?.some((obj) => obj._id === item._id)
            );
        }
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

    const handleImageClick = () => {
        //Click
    };


    const handleAddRemoveModel = (isAdding, item) => {
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
                                <button
                                    onClick={(e) => {
                                        e.preventDefault();
                                        if (handleAddRemoveModel) {
                                            handleAddRemoveModel(!isPresent, item); // Toggle based on isPresent
                                        } else {
                                            console.log("No handleAddRemoveModel function provided");
                                        }
                                    }}
                                    className={isPresent ? "remove-button" : "add-button"}
                                >
                                    {isPresent ? "Remove" : "Add"}
                                </button>
                            </>
                        }
                        <div className='item-thumbnail'>
                            {item.modelPath &&
                                <img src='https://mesharch.s3.eu-west-1.amazonaws.com/cube.png' className='item-model-icon' alt='3D Model' />
                            }
                            {images.length > 0 ? (
                                <img
                                    src={images[0]}
                                    className='thumbnail'
                                    alt={`${item.name} image`}
                                    onClick={() => { handleShowDetails(item) }}
                                />
                            ) : (
                                <img
                                    src='https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/No_image_available.svg/300px-No_image_available.svg.png'
                                    className='thumbnail'
                                    alt='placeholder'

                                    onClick={() => { handleShowDetails(item) }}
                                />
                            )}
                        </div>
                    </div>
                    <div className="item-properties-above-fold">
                        <div className="item-property">
                            <h4>Brand:</h4>
                            <p className='item-property-button' onClick={() => { handleClickProperty(item.brand) }}>{item.brand}</p>
                        </div>
                        <div className="item-property item-property-right">
                            <h4>Price:</h4>
                            <h2 >{item.price} EUR</h2>
                            <p>{item.priceMethod}</p>
                        </div>
                    </div>

                </div>
            </div>
        </div >
    );
}

export default Item;
