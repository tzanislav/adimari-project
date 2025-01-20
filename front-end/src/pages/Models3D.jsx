import React, { useEffect, useState } from 'react';
import Model from '../components/Model';
import { Link } from 'react-router-dom';
import '../CSS/Model.css';
import '../CSS/ListPage.css';
import { useActiveSelection } from "../context/selectionContext";


function Models() {
    const [models, setModels] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filteredModels, setFilteredModels] = useState([]);
    const [activeSelectionObject, setActiveSelectionObject] = useState(null);
    const { activeSelection } = useActiveSelection();
    const {serverUrl} = useActiveSelection();

    useEffect(() => {
        const fetchModels = async () => {
            try {
                const response = await fetch(`${serverUrl}/api/models3d`);
                if (!response.ok) {
                    throw new Error('Failed to fetch models');
                }
                const data = await response.json();
                setModels(data);
                setFilteredModels(data);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchModels();
    }, []);

    //Get active selection
    useEffect(() => {
        const fetchActiveProject = async () => {
            if (activeSelection === null) {
                console.log('No active project selected');
                return;
            }
            try {
                const response = await fetch(`${serverUrl}/api/selections/${activeSelection[2]}`);
                if (!response.ok) {
                    throw new Error('Failed to fetch active project');
                }
                const data = await response.json();
                console.log('Active project response:', data.name);
                setActiveSelectionObject(data);
            } catch (err) {
                setError(err.message);
            }
        };

        fetchActiveProject();

    }, [activeSelection]);

    useEffect(() => {
        if (search !== '') {
            setFilteredModels(
                models.filter((model) => {
                    const searchLower = search.toLowerCase();

                    // Define fields to search
                    const fieldsToSearch = ['name', 'description', 'category', 'class', 'brand', 'path'];

                    // Check if any field matches
                    const matchesFields = fieldsToSearch.some((field) =>
                        model[field]?.toLowerCase().includes(searchLower)
                    );

                    // Check if tags array includes the search term
                    const matchesTags = model.tags?.some((tag) =>
                        tag.toLowerCase().includes(searchLower)
                    );

                    return matchesFields || matchesTags;
                })
            );
        } else {
            setFilteredModels(models);
        }
    }, [search, models]);


    const handleAddToSelection = (model_id, isAdding) => {
        if (!activeSelectionObject) {
            console.error("activeSelectionObject is not defined");
            return;
        }

        console.log(
            `${isAdding ? "Add" : "Remove"} model to selection ${activeSelectionObject.name} model: ${model_id}`
        );

        // Modify the models array based on `isAdding`
        const updatedModels = isAdding
            ? [...(activeSelectionObject.models || []), model_id] // Add model
            : (activeSelectionObject.models || []).filter((id) => id !== model_id); // Remove model

        const newSelection = {
            ...activeSelectionObject,
            models: updatedModels,
        };

        // Update state
        setActiveSelectionObject(newSelection);
        console.log('New selection: ', newSelection);

        // Update the backend
        const updateSelection = async () => {
            try {
                const response = await fetch(`${serverUrl}/api/selections/${activeSelectionObject._id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(newSelection),
                });

                if (!response.ok) {
                    throw new Error('Failed to update selection');
                }

                console.log('Selection updated successfully');
            } catch (err) {
                setError(err.message);
            }
        };

        updateSelection();
    };




    if (loading) {
        return <p>Loading...</p>;
    }

    if (error) {
        return <p>Error: {error}</p>;
    }

    return (
        <div className="items-container">
            <h1>Models Page</h1>
            <div className="search-container">
                <input
                    className='search-box'
                    type="text"
                    placeholder="Search Models"
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>
            <Link className='link button' to="/api/models3d/new">Add New Model</Link>
            {filteredModels.map((model) => (
                <Model key={model._id} modelId={model._id} handleAddModel={handleAddToSelection} _selection={activeSelectionObject} />
            ))}
        </div>
    );
}

export default Models;
