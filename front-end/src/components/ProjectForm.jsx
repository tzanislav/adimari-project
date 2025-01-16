import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import DeleteBox from '../components/DeleteBox';
import axios from 'axios';
import '../CSS/EditBrand.css';
import { useActiveSelection } from "../components/selectionContext";


function ProjectForm() {
  const { id } = useParams(); // Get ID from URL
  const isEditing = Boolean(id); // Check if the page is for editing
  const [isDeleting, setIsDeleting] = useState(false); // State for delete confirmation
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    selections: [], // Field for uploaded selection URLs
  });

  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const {serverUrl} = useActiveSelection();

  // Fetch project data if editing
  useEffect(() => {
    if (isEditing) {
      const fetchProject = async () => {
        setLoading(true);
        try {
          const response = await axios.get(`${serverUrl}/api/projects/${id}`);
          const data = response.data;
          setFormData({
            name: data.name || '',
            description: data.description || '',
            selections: data.selections || [],
          });
        } catch (error) {
          console.error('Failed to fetch project:', error);
          setErrorMessage('Failed to fetch project data.');
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
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing
      ? `${serverUrl}/api/projects/${id}`
      : `${serverUrl}/api/projects`;

    const method = isEditing ? 'PUT' : 'POST';

    try {
      const response = await axios({
        url,
        method,
        headers: { 'Content-Type': 'application/json' },
        data: formData,
      });

      setSuccessMessage(
        isEditing
          ? `Project "${response.data.name}" updated successfully!`
          : `Project "${response.data.name}" created successfully!`
      );
      setTimeout(() => {
        window.location.href = '/api/projects';
      }, 500);

      if (!isEditing) {
        setFormData({
          name: '',
          description: '',
          selections: [],
        });
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      setErrorMessage('Failed to submit form: ' + error.message);
    }
  };

  // Delete model
  const handleDelete = async () => {
    try {
      await axios.delete(`${serverUrl}/api/projects/${id}`);
      setSuccessMessage('Model deleted successfully!');
      setTimeout(() => {
        window.location.href = '/api/projects';
      }, 500);
    } catch (error) {
      setErrorMessage('Failed to delete model: ' + error.message);
    }
  };

  return (
    <div className="brand-form">
      <h2>{isEditing ? 'Edit Project' : 'Create New Project'}</h2>
      {loading && <p>Loading project data...</p>}

      {isDeleting && (
        <DeleteBox
          itemName="Project"
          deleteFunction={handleDelete}
          closeFunction={() => setIsDeleting(false)}
        />
      )}


      {!loading && (
        <form onSubmit={handleSubmit}>
          <label>
            Name:
            <input
              type="text"
              name="name"
              value={formData.name || ''}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Description:
            <textarea
              name="description"
              value={formData.description || ''}
              onChange={handleChange}
            />
          </label>

          <div className="buttons">
            <button type="submit">
              {isEditing ? 'Update Project' : 'Create Project'}
            </button>

            {isEditing && (
              <button
                type="button"
                onClick={() => setIsDeleting(true)}
                className="deleteButton"
              >
                Delete Project
              </button>
            )}


            <button type="button" onClick={() => window.history.back()}>
              Back
            </button>
          </div>

          {successMessage && <p className="success">{successMessage}</p>}
          {errorMessage && <p className="error">{errorMessage}</p>}
        </form>
      )}
    </div>
  );
}

export default ProjectForm;
