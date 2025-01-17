import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import "../CSS/ListModel.css";

function ListItem({ item, handleRemove }) {

    const [copied, setCopied] = useState(false);
    const [images, setImages] = useState([]);

    useEffect(() => {
        setImages(filterImages(item.files));
    }, [item.files]);


    const copyToClipboard = () => {
        navigator.clipboard.writeText(item.path);
        setCopied(true);
        setTimeout(() => {
            setCopied(false);
        }, 2000);
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
                    <button onClick={copyToClipboard}>
                        {copied ? "Copied!" : "Copy path"}
                    </button>
                )}

                <div className="list-item-info">
                    <div className="list-item-propery">
                        <h4>Brnad</h4>
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
                </div>
            </div>

            <button onClick={() => handleRemove(item._id)}>Remove from selection</button>

        </div>
    );
}

export default ListItem;