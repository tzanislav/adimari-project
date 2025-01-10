import React from "react";
import "../CSS/DeleteBox.css";

function DeleteBox({ deleteFunction, closeFunction, itemName = "item" }) {
    return (
        <div className="delete-box">
            <h2>Are you sure you want to delete {itemName}</h2>
            <div className="delete-box-buttons">
                <button onClick={deleteFunction}>Yes</button>
                <button onClick={closeFunction}>No</button>
            </div>
        </div>
    );
}

export default DeleteBox;