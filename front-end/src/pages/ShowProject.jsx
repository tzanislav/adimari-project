import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import SelectForm from "../components/SelectForm";
import axios from "axios";

function ProjectPage() {
    const { id } = useParams(); // Get project ID from URL
    const [loading, setLoading] = useState(true);
    const [project, setProject] = useState(null);
    const [error, setError] = useState(null);
    const [isEditingSelection, setIsEditingSelection] = useState(false);
    const [editId, setEditId] = useState(null);
    const [selections, setSelections] = useState([]);

    // Fetch project data
    useEffect(() => {
        const fetchProject = async () => {
            try {
                const response = await axios.get(`http://localhost:5000/projects/${id}`);
                setProject(response.data);
                //Fetch selections
                const selectionResponse = await axios.get(`http://localhost:5000/projects/${id}/selections`);
                setSelections(selectionResponse.data);

            } catch (error) {
                console.error("Failed to load project:", error);
                setError(error);
            } finally {
                setLoading(false);
            }
        };
        fetchProject();
    }, [id]);

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

            // Reset editing state
            setIsEditingSelection(false);
            setEditId(null);
        } catch (error) {
            console.error("Failed to update project:", error);
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
        <div>
            <h1>{project.name}</h1>
            <p>{project.description}</p>

            <button onClick={() => setIsEditingSelection(true)}>Create Selection</button>

            {/* Render the SelectForm for creating or editing */}
            {isEditingSelection && !editId && (
                <SelectForm parent={id} onSuccess={onSuccessfulSelectionEdit} />
            )}

            <ul>
                {selections.map((selection) => (
                    <li key={selection._id}>
                        <h2>{selection.name}</h2>
                        {isEditingSelection && editId === selection ? (
                            <SelectForm
                                id={selection._id}
                                parent={id}
                                onSuccess={onSuccessfulSelectionEdit}
                            />
                        ) : (
                            <button onClick={() => { setIsEditingSelection(true); setEditId(selection._id); }} >
                                Edit Selection
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default ProjectPage;
