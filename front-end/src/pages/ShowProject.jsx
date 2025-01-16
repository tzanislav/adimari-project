import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useActiveSelection } from "../components/selectionContext";
import EditSelection from "../components/EditSelection";
import DeleteBox from "../components/DeleteBox";
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
    const { setActiveSelection, clearActiveSelection } = useActiveSelection();
    const [isDeleting, setIsDeleting] = useState(false);

    // Fetch project data
    useEffect(() => {
        const fetchProject = async () => {
            try {
                // Fetch project data
                const response = await axios.get(`${serverUrl}/api/projects/${id}`);
                console.log("Project response:", response.data);

                if (!response.data) {
                    console.error("Project data is undefined in the API response");
                    setProject(null); // Explicitly set project to null
                    return;
                }

                setProject(response.data); // Update project state

                // Fetch selections
                const selectionResponse = await axios.get(`${serverUrl}/api/projects/${id}/selections`);

                if (!selectionResponse.data) {
                    console.warn("Selections data is undefined or empty in the API response");
                    setSelections([]); // Explicitly set selections to an empty array
                } else {
                    const sortedSelections = selectionResponse.data.sort(
                        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
                    );
                    setSelections(sortedSelections);
                }

            } catch (error) {
                console.error("Failed to load project or selections:", error);
                setError(error);
            } finally {
                setLoading(false);
            }
        };

        fetchProject();
    }, [id, refreshKey]); // Trigger whenever `id` or `refreshKey` changes


    // Handle successful creation or edit of a selection
    const onSuccessfulSelectionEdit = async (e, selectionId) => {
        e.stopPropagation();
        console.log("Received selection ID:", selectionId);

        try {
            const response = await axios.put(`${serverUrl}/api/projects/${id}`, {
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

    const handleDelete = async () => {
        try {
            console.log("Deleting selection with ID:", editId);

            // Perform the deletion
            await axios.delete(`${serverUrl}/api/selects/${editId}`);

            // Update the selections state directly
            setSelections((prevSelections) =>
                prevSelections.filter((selection) => selection._id !== editId)
            );

            setEditId(null);
            setIsDeleting(false);
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
            {isDeleting && (
                <DeleteBox deleteFunction={handleDelete} closeFunction={() => setIsDeleting(false)} itemName="Selection" />
            )

            }

            {selections.length === 0 && <p>No selections available.</p>}

            <ul className="selection-list">
                {selections.map((selection) => (
                    <li
                        key={selection._id}
                        className="selection-item"
                        onClick={() => window.location.href = `/selections/${selection._id}`}
                    >
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
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation(); // Prevent triggering the parent `onClick`
                                            setIsDeleting(true);
                                            setEditId(selection._id);
                                        }}
                                    >
                                        Delete
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation(); // Prevent triggering the parent `onClick`
                                            setEditId(selection._id);
                                            setIsEditingSelection(true);
                                        }}
                                    >
                                        Rename
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation(); // Prevent triggering the parent `onClick`
                                            setActiveSelection([
                                                selection.name,
                                                project.name,
                                                selection._id,
                                                project._id,
                                            ]);
                                        }}
                                    >
                                        Select
                                    </button>
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
