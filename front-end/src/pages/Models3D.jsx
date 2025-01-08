import React, { useEffect, useState } from 'react';
import Model from '../components/Model';
import { Link } from 'react-router-dom';
import '../CSS/Model.css';

function Models() {
    const [models, setModels] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filteredModels, setFilteredModels] = useState([]);

    useEffect(() => {
        const fetchModels = async () => {
            try {
                const response = await fetch('http://localhost:5000/models3d');
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

    if (loading) {
        return <p>Loading...</p>;
    }

    if (error) {
        return <p>Error: {error}</p>;
    }

    return (
        <div className="models">
            <h1>Models Page</h1>
            <input
                className='search-box'
                type="text"
                placeholder="Search Models"
                onChange={(e) => setSearch(e.target.value)}
            />
            <Link className='link button' to="/models3d/new">Add New Model</Link>
            {filteredModels.map((model) => (
                <Model key={model._id} modelId={model._id} />
            ))}
        </div>
    );
}

export default Models;
