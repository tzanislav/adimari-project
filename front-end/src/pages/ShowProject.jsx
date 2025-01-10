import React, { useState, useEffect, act } from "react";
import { useParams } from "react-router-dom";
import { useActiveSelection } from "../components/selectionContext";
import EditSelection from "../components/EditSelection";
import axios from "axios";
import '../CSS/EditProject.css';

function ProjectPage() {
    const { id } = useParams(); // Get project ID from URL
    const [loading, setLoading] = useState(true);
    const [project, setProject] = useState(null);
    const [error, setError] = useState(null);
    const [isEditingSelection, setIsEditingSelection] = useState(false);
    const [editId, setEditId] = useState(null);
    const [selections, setSelections] = useState([]);
    const [refreshKey, setRefreshKey] = useState(0); // Trigger re-fetches
    const { setActiveSelection } = useActiveSelection();
    const { clearActiveSelection } = useActiveSelection();

    // Fetch project data
    useEffect(() => {
        const fetchProject = async () => {
            try {
                const response = await axios.get(`http://localhost:5000/projects/${id}`);
                setProject(response.data);

                // Fetch selections
                const selectionResponse = await axios.get(`http://localhost:5000/projects/${id}/selections`);
                const sortedSelections = selectionResponse.data.sort(
                    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
                );
                setSelections(sortedSelections);
            } catch (error) {
                console.error("Failed to load project:", error);
                setError(error);
            } finally {
                setLoading(false);
            }
        };

        fetchProject();
    }, [id, refreshKey]); // Trigger whenever `id` or `refreshKey` changes

    // Handle successful creation or edit of a selection
    const onSuccessfulSelectionEdit = async (selectionId) => {
        console.log("Received selection ID:", selectionId);

        try {
            const response = await axios.put(`http://localhost:5000/projects/${id}`, {
                selection: selectionId,
            });
            // Update the project state with the updated selection data
            const updatedProject = response.data.project;
            setProject(updatedProject);

            // Reset editing state and trigger refresh
            setIsEditingSelection(false);
            setEditId(null);
            setRefreshKey((prev) => prev + 1); // Increment refreshKey to refetch
        } catch (error) {
            console.error("Failed to update project:", error);
            setError(error);
        }
    };

    const handleDelete = async (deleteId) => {
        try {
            await axios.delete(`http://localhost:5000/selects/${deleteId}`);
            project.selections = project.selections.filter((selection) => selection._id !== deleteId);

            setEditId(null);
            setIsEditingSelection(false);
            setRefreshKey((prev) => prev + 1); // Increment refreshKey to refetch
            clearActiveSelection();
        } catch (error) {
            console.error("Failed to delete selection:", error);
            setError(error);
        }
    };



    if (loading) {
        return <p>Loading...</p>;
    }

    if (error) {
        return <p>Error: {error.message}</p>;
    }

    return (
        <div className="project-page">
            <h1>{project.name}</h1>
            <p>{project.description}</p>

            <button onClick={() => { setIsEditingSelection(!isEditingSelection); setEditId(null); }}>
                Create Selection
            </button>

            {/* Render the SelectForm for creating or editing */}

            {isEditingSelection && !editId && (
                <div className="create-selection">
                    <h2>New Selection</h2>
                    <EditSelection parent={id} onSuccess={onSuccessfulSelectionEdit} />
                </div>
            )}


            <ul className="selection-list">
                {selections.map((selection) => (
                    <li key={selection._id} className="selection-item">
                        {isEditingSelection && editId === selection._id ? (
                            <EditSelection
                                id={selection._id}
                                parent={id}
                                onSuccess={onSuccessfulSelectionEdit}
                            />
                        ) : (
                            <>
                                <h3>{selection.name}</h3>
                                <div className="selection-item-buttons">
                                    <button onClick={() => handleDelete(selection._id)}>
                                        Delete
                                    </button>
                                    <button onClick={() => { setEditId(selection._id); setIsEditingSelection(true); }}>
                                        Rename
                                    </button>
                                    <button onClick={() => { setEditId(selection._id); setIsEditingSelection(true); }}>
                                        Open
                                    </button>
                                    <button onClick={() => setActiveSelection([selection.name, project.name, selection._id, project._id])}>Select</button>
                                </div>
                            </>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default ProjectPage;
