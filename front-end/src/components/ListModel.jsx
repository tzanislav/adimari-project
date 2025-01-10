import React, { useState } from "react";
import { Link } from "react-router-dom";
import "../CSS/ListModel.css";

function ListModel({ model }) {

    const [copied, setCopied] = useState(false);

    const copyToClipboard = () => {
        navigator.clipboard.writeText(model.path);
        setCopied(true);
        setTimeout(() => {
            setCopied(false);
        }, 2000);
    }

    return (
        <div className="list-model-item">
            <div className="list-model-part">
                <Link to={`/models3d/${model._id}`}>
                <img src={model.images[0]} alt={model.name} />
                </Link>
                <div className="list-model-part-info">
                    <h3>{model.name}</h3>
                    <p> Price: {model.price} EUR</p>
                    <p> Brand: {model.brand}</p>
                    <p> Class: {model.class}</p>
                </div>
            </div>
            <button onClick={copyToClipboard}>
                {copied ? "Copied!" : "Copy path"}
            </button>
        </div>
    );
}

export default ListModel;