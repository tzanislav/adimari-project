import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import "../CSS/ListModel.css";

function ListItem({ item }) {

    const [copied, setCopied] = useState(false);
    const [images, setImages] = useState([]);

    useEffect(() => {
        console.log(item.files);
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
        <div className="list-model-item">
            <div className="list-model-part">
                <Link to={`/api/models3d/${item._id}`}>
                    {images[0] ? (
                        <img src={images[0]} alt={item.name} />) : (
                        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/No_image_available.svg/300px-No_image_available.svg.png" alt={item.name} />
                    )}
                </Link>
                <div className="list-model-part-info">
                    <h3>{item.name}</h3>
                    <p> Brand: {item.brand}</p>
                    <p> Class: {item.class}</p>
                    <p> Price: {item.price} EUR</p>
                </div>
            </div>
            {item.modelPath && (
            <button onClick={copyToClipboard}>
                {copied ? "Copied!" : "Copy path"}
            </button>
            )}
        </div>
    );
}

export default ListItem;