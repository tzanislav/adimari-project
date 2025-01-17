import React, { useState, useEffect } from "react";
import axios from "axios";
import { Link, useParams } from "react-router-dom";
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
    const [error, setError] = useState(null);
    const [project, setProject] = useState(null);
    const [number, setNumber] = useState(0);

    useEffect(() => {
        if (selection) {
            // Calculate the total count of items
            const count = selection.items.reduce((sum, item) => sum + item.count, 0);
    
            // Calculate the total price
            const total = selection.itemDetails.reduce((sum, model) => {
                const item = selection.items.find((item) => item._id === model._id); // Find matching item by ID
                const itemCount = item ? item.count : 0; // Get the count or default to 0
                return sum + model.price * itemCount; // Add price * count to the total
            }, 0);
    
            setTotalPrice(total);
    
            // Calculate unique brands
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
    }, [id, serverUrl, number]);

    const handleRemoveModel = (itemId) => {
        console.log('Removing item:', itemId);
    
        // Create a new selection object
        const newSelection = {
            ...selection,
            items: selection.items.filter((item) => item._id !== itemId), // Filter out by `_id`
        };
    
        // Update the local state
        setSelection(newSelection);
    
        console.log('New selection:', newSelection);
        console.log('Selection:', selection);
    
        // Update the backend
        const updateSelection = async () => {
            try {
                console.log(`${serverUrl}/api/selections/${selection._id}`);
                const response = await fetch(
                    `${serverUrl}/api/selections/${selection._id}`,
                    {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(newSelection), // Send updated selection
                    }
                );
    
                if (!response.ok) {
                    throw new Error('Failed to update selection');
                }
    
                setNumber(number + 1); // Trigger re-render or state update
                console.log('Selection updated successfully', response.message);
    
            } catch (err) {
                setError(err.message);
            }
        };
    
        updateSelection();
    };

    const handleUpdateItem = async (itemId, newCount) => {

        // Create a new selection object
        const newSelection = {
            ...selection,
            items: selection.items.map((item) => {
                if (item._id === itemId) {
                    return { ...item, count: newCount };
                }
                return item;
            }),
        };

        // Update the local state
        setSelection(newSelection);

        // Update the backend

        try {
            const response = await fetch(
                `${serverUrl}/api/selections/${selection._id}`,
                {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(newSelection), // Send updated selection
                }
            );

            if (!response.ok) {
                throw new Error('Failed to update selection');
            }
            setNumber(number + 1); // Trigger re-render or state update
            console.log('Selection updated successfully', response.message);

        } catch (err) {

            setError(err.message);
        }
    };



    



    if (!selection) {
        return <div>Loading...</div>;
    }

    return (
        <div className="show-selection">
            <h1>{selection.name}</h1>
            <Link to={`/projects/${project?._id}`}>Back to {project?.name}</Link>
            <button onClick={() => {
                setActiveSelection(selection._id);
            }}>Set to Active Selection</button>
            {selection.itemDetails?.map((item) => (
                <ListItem 
                key={item._id} 
                item={item} 
                selection={selection} 
                handleRemove={handleRemoveModel} 
                count={selection.items.find((obj) => obj._id === item._id)?.count || 0}
                handleUpdateItem={handleUpdateItem}
            />
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
