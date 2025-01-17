import React, { useState, useEffect } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import ListItem from "../components/ListItem";
import "../CSS/ShowSelection.css";
import { useActiveSelection } from "../components/selectionContext";

const ShowSelection = () => {

    const { id } = useParams();

    // Fetch selection data
    const [selection, setSelection] = useState(null);
    const [totalPrice, setTotalPrice] = useState(0);
    const [brandsUsed, setBrandsUsed] = useState([]);
    const { setActiveSelection, serverUrl } = useActiveSelection();
    const [project, setProject] = useState(null);

    useEffect(() => {
        if (selection) {
            const total = selection.itemDetails.reduce((sum, model) => sum + model.price, 0);
            setTotalPrice(total);

            const brands = selection.itemDetails.map((model) => model.brand);
            setBrandsUsed([...new Set(brands)]);
        }
    }, [selection]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const selectionResponse = await axios.get(`${serverUrl}/api/selections/${id}`);
                const fetchedSelection = selectionResponse.data;
                setSelection(fetchedSelection);

                if (fetchedSelection.parentProject) {
                    const projectResponse = await axios.get(`${serverUrl}/api/projects/${fetchedSelection.parentProject}`);
                    setProject(projectResponse.data);
                }
            } catch (error) {
                console.error("Error fetching data:", error);
            }
        };

        fetchData();
    }, [id, serverUrl]);

    const handleRemoveModel = (itemId) => {
        if (!selection) {
            console.error("selection is not defined");
            return;
        }
        console.log(selection);
        console.log(`Remove model from selection ${selection._id}, model: ${itemId}`);

        // Remove the model from the `items` array
        const updatedItems = (selection.items || []).filter((id) => id !== itemId);

        const newSelection = {
            ...selection,
            items: updatedItems,
        };

        console.log(newSelection);
        setSelection(newSelection);

        // Update the backend
        const updateSelection = async () => {
            try {
                const response = await fetch(`${serverUrl}/api/selections/${selection._id}`, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(newSelection),
                });

                if (!response.ok) {
                    throw new Error("Failed to update selection");
                }

                // Use functional updates to ensure React re-renders
                setSelection((prevSelection) => ({
                    ...prevSelection,
                    items: updatedItems,
                }));
                console.log("Selection updated successfully");
            } catch (err) {
                console.error("Error updating selection:", err.message);
            }
        };

        updateSelection();
    };


    if (!selection) {
        return <div>Loading...</div>;
    }

    return (
        <div className="show-selection">
            <h1>{selection.name}</h1>
            <button onClick={() => {
                setActiveSelection(selection._id);
            }}>Set to Active Selection</button>
            {selection.itemDetails?.map((item) => (
                <ListItem key={item._id} item={item} selection={selection} handleRemove={handleRemoveModel} />
            ))}
            <div className="show-selection-summary">
                <div className="show-selection-brands">
                    <p>Brands Used:</p>
                    <hr />
                    <ul>
                        {brandsUsed.map((brand) => (
                            <li key={brand}>{brand}</li>
                        ))}
                    </ul>
                </div>
                <div className="show-selection-total">
                    <p>Total Price:</p>
                    <hr />
                    <h1>{totalPrice} EUR</h1>
                </div>
            </div>
        </div>
    );
};

export default ShowSelection;
