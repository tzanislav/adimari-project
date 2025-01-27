import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import "../CSS/ListModel.css";

function ListItem({ item, handleRemove, count, handleUpdateItem }) {

    const [copied, setCopied] = useState(false);
    const [images, setImages] = useState([]);

    useEffect(() => {
        setImages(filterImages(item.files));
    }, [item.files]);


    const copyToClipboard = () => {
        console.log("Copying to clipboard:", item);
        try {
            navigator.clipboard.writeText(item.modelPath);
            setCopied(true);
            setTimeout(() => {
                setCopied(false);
            }, 2000);
        } catch (error) {
            console.error("Error copying to clipboard:", error);
        }
    }

    const filterImages = (files) => {
        if (!files || !Array.isArray(files)) return [];
        return files.filter((file) => file.match(/\.(jpeg|jpg|gif|png|webp)$/i));
    };


    return (
        <div className="list-item-container">
            <div className="list-item">
                <div className="list-item-left">
                    <div className="list-item-thumbnail">
                        <Link to={`/items/edit/${item._id}`}>
                            {images[0] ? (
                                <img src={images[0]} alt={item.name} />) : (
                                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/No_image_available.svg/300px-No_image_available.svg.png" alt={item.name} />
                            )}
                        </Link>
                        <div className="list-item-edit-overlay">
                            <p>EDIT</p>
                        </div>
                    </div>
                    <div className="list-item-propery">
                        <h4>Name</h4>
                        <h3>{item.name}</h3>
                    </div>
                </div>
                {item.modelPath && (
                    <div className='item-path'>
                        <h4>Model path</h4>
                        <h3>{item.modelPath}</h3>
                        <button className='button-small' onClick={copyToClipboard}>
                            {copied ? "Copied!" : "Copy path"}
                        </button>
                    </div>
                )}

                <div className="list-item-info">
                    <div className="list-item-propery">
                        <h4>Brand</h4>
                        <h3>{item.brand}</h3>
                    </div>
                    <div className="list-item-propery">
                        <h4>Category</h4>
                        <h3>{item.category}</h3>
                    </div>
                    <div className="list-item-propery">
                        <h4>Class</h4>
                        <h3>{item.class}</h3>
                    </div>
                    <div className="list-item-propery">
                        <h4>Price</h4>
                        <h3>{item.price} EUR</h3>
                    </div>
                    <div className="list-item-propery">
                        <h4>Count</h4>
                        <div className='count-buttons'>
                            <button className='button-small' onClick={() => handleUpdateItem(item._id, count - 1)}>Remove</button>
                            <h3>{count}</h3>
                            <button className='button-small' onClick={() => handleUpdateItem(item._id, count + 1)}>Add</button>
                        </div>
                    </div>
                </div>
            </div>

            <button className='button-small button-remove' onClick={() => handleRemove(item._id)}>Remove</button>

        </div>
    );
}

export default ListItem;