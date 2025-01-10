import React, { useState, useEffect } from "react";

import axios from "axios";
import { Link } from "react-router-dom";


function SelectForm({ id, parent, onSuccess }) {

    const isEditing = Boolean(id); // Check if the page is for editing
    const [isDeleting, setIsDeleting] = useState(false); // State for delete confirmation
    const [formData, setFormData] = useState({
        name: '',
        description: '',
    });

    const [loading, setLoading] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    // Fetch project data if editing
    useEffect(() => {
        if (isEditing) {
            const fetchProject = async () => {
                setLoading(true);
                try {
                    const response = await axios.get(`http://localhost:5000/selects/${id}`);
                    const data = response.data;
                    setFormData({
                        name: data.name || '',
                        description: data.description || '',
                    });
                } catch (error) {
                    console.error('Failed to fetch selection:', error);
                    setErrorMessage('Failed to fetch selection data.');
                } finally {
                    setLoading(false);
                }
            };
            fetchProject();
        }
    }, [id, isEditing]);

    // Handle input changes
    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: value,
        }));

        if (parent) {
            setFormData((prev) => ({
                ...prev,
                project: parent,
            }));
        }
    };

    // Handle form submission
    const handleSubmit = async (e) => {
        e.preventDefault();
        const url = isEditing
            ? `http://localhost:5000/selects/${id}`
            : 'http://localhost:5000/selects';

        const method = isEditing ? 'PUT' : 'POST';

        setLoading(true);
        try {
            const response = await axios({
                method,
                url,
                data: formData,
            });
            console.log('Server response:', response);
            setSuccessMessage('Selections saved successfully.');
            if (onSuccess) {
                console.log('onSuccess:', response.data.selection._id);
                onSuccess(response.data.selection._id);

            }
        } catch (error) {
            console.error('Failed to save selection:', error);
            setErrorMessage('Failed to save selection.');
        } finally {
            setLoading(false);
        }
    };


    // Handle delete
    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            await axios.delete(`http://localhost:5000/selects/${id}`);
            setSuccessMessage('Project deleted successfully.');
        } catch (error) {
            console.error('Failed to delete selection:', error);
            setErrorMessage('Failed to delete selection.');
        } finally {
            setIsDeleting(false);
        }
    };


    if (loading) {
        return <p>Loading...</p>;
    }

    if (isDeleting) {
        return <p>Deleting...</p>;
    }

    return (
        <div className="brand-form" >
            <h2>{isEditing ? 'Edit Selection' : 'Create New Selection'}</h2>

            {!loading && (
                <>
                {successMessage && <p className="success">{successMessage}</p>}
                {errorMessage && <p className="error">{errorMessage}</p>}
                { id ? (<p> Editing selection: {id}</p>) : null }
                <form onSubmit={handleSubmit}>
                    <label>
                        Name:
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                        />
                    </label>
                    <button type="submit">Save</button>
                </form>
                </>
            )}

        </div>
    );



}

export default SelectForm;
