import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import FileUploader from '../components/FileUploader'; // Ensure correct import path
import '../CSS/EditBrand.css';
import { showOnlyName } from '../utils/utils';
import DeleteBox from "../components/DeleteBox";

function BrandForm() {
  const { id } = useParams(); // Get ID from URL
  const isEditing = Boolean(id); // Check if the page is for editing
  const [isDeleting, setIsDeleting] = useState(false); // State for delete confirmation

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    website: '',
    files: [], // Field for uploaded file URLs
    category: '',
    class: 'Low',
    distributor: '',
    location: '',
    personToContact: '',
    email: '',
    phone: '',
    discount: 0,
    tags: [],
    has3dmodels: false,
    hasDWGmodels: false,
  });

  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch brand data if editing
  useEffect(() => {
    if (isEditing) {
      const fetchBrand = async () => {
        setLoading(true);
        try {
          const response = await axios.get(`http://adimari-tzani:5000/brands/${id}`);
          const data = response.data;
          setFormData({
            ...data,
            tags: data.tags || [],
            models3D: data.models3D || [],
            files: data.files || [], // Ensure files are loaded
          });
        } catch (error) {
          console.error('Failed to fetch brand:', error);
          setErrorMessage('Failed to fetch brand data.');
        } finally {
          setLoading(false);
          setIsDeleting(false);
        }
      };
      fetchBrand();
    }
  }, [id, isEditing]);

  // Handle input changes
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing
      ? `http://adimari-tzani:5000/brands/${id}`
      : 'http://adimari-tzani:5000/brands';

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
          ? `Brand "${response.data.name}" updated successfully!`
          : `Brand "${response.data.name}" created successfully!`
      );
      setTimeout(() => {
        window.location.href = '/brands';
      }, 500);

      if (!isEditing) {
        setFormData({
          name: '',
          description: '',
          website: '',
          files: [],
          category: '',
          class: 'Low',
          distributor: '',
          location: '',
          personToContact: '',
          email: '',
          phone: '',
          discount: 0,
          tags: [],
          models3D: [],
          has3dmodels: false,
          hasDWGmodels: false,
        });
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      setErrorMessage('Failed to submit form: ' + error.message);
    }
  };

  // Delete brand
  const handleDelete = async () => {
    try {
      await axios.delete(`http://adimari-tzani:5000/brands/${id}`);
      setSuccessMessage('Brand deleted successfully!');
      setTimeout(() => {
        window.location.href = '/brands';
      }, 500);
    } catch (error) {
      setErrorMessage('Failed to delete brand: ' + error.message);
    }
  };

  return (
    <div className="brand-form">
      <h2>{isEditing ? 'Edit Brand' : 'Create New Brand'}</h2>
      {loading && <p>Loading brand data...</p>}


        {isDeleting && (
          <DeleteBox
            itemName="Brand"
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

          <label>
            Distributor:
            <input
              name="distributor"
              value={formData.distributor || ''}
              onChange={handleChange}
            />
          </label>



          <label>
            Website:
            <input
              type="text"
              name="website"
              value={formData.website || ''}
              onChange={handleChange}
            />
          </label>

          <label>
            Location:
            <input
              type="text"
              name="location"
              value={formData.location || ''}
              onChange={handleChange}
            />
          </label>

          <label>
            Contact Person:
            <input
              type="text"
              name="personToContact"
              value={formData.personToContact || ''}
              onChange={handleChange}
            />
          </label>

          <label>
            Email:
            <input
              type="email"
              name="email"
              value={formData.email || ''}
              onChange={handleChange}
            />
          </label>

          <label>
            Phone:
            <input
              type="tel"
              name="phone"
              value={formData.phone || ''}
              onChange={handleChange}
            />
          </label>

          <label>
            Discount:
            <input
              type="number"
              name="discount"
              value={formData.discount || '0'}
              onChange={handleChange}
            />
          </label>

          {formData.name ? (
            <label>
              Files:
              <FileUploader
                folderName={formData.name}
                onUploadComplete={(uploadedUrls) => {
                  setFormData((prev) => ({
                    ...prev,
                    files: [...prev.files, ...uploadedUrls],
                  }));
                }} onRemove={(deletedUrl) => {
                  setFormData((prev) => ({
                    ...prev,
                    files: prev.files.filter((url) => url !== deletedUrl),
                  }));
                }}
              />
            </label>) :

            <label>
              Files:
              <p className='error' >Upload files after entering a name</p>
            </label>

          }


          {formData.files.length > 0 && (
            <>
              <p>Existing files Files:</p>
              <ul>
                {formData.files.map((file, index) => (
                  <li key={index}>
                    <p>
                      {showOnlyName(file)}
                    </p>
                    <button onClick={(e) => {
                      e.preventDefault();
                      setFormData((prev) => ({
                        ...prev,
                        files: prev.files.filter((_, i) => i !== index),
                      }));
                    }}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}


          <label>
            Category:
            <input
              type="text"
              name="category"
              value={formData.category || ''}
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Class:
            <select
              name="class"
              value={formData.class || ''}
              onChange={handleChange}
              required
            >
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Luxury">Luxury</option>
            </select>
          </label>
          <div className='checkboxes'>
            <label>
              <input
                type="checkbox"
                name="has3dmodels"
                checked={formData.has3dmodels || false}
                onChange={handleChange}
              />
              3D Models on Site
            </label>

            <label>
              <input
                type="checkbox"
                name="hasDWGmodels"
                checked={formData.hasDWGmodels || false}
                onChange={handleChange}
              />
              DWG Models on Site
            </label>
          </div>

          <label>
            Tags (comma-separated):
            <input
              type="text"
              name="tags"
              value={formData.tags?.join(', ') || ''}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  tags: e.target.value.split(',').map((tag) => tag.trim()),
                }))
              }
            />
          </label>

          <div className="buttons">
            <button type="submit">
              {isEditing ? 'Update Brand' : 'Create Brand'}
            </button>

            <button type="button" onClick={() => window.history.back()}>
              Back
            </button>

            {isEditing && (
              <button type="button" className="deleteButton" onClick={() => setIsDeleting(true)}>
                Delete Brand
              </button>
            )}
          </div>
          {successMessage && <p className="success">{successMessage}</p>}
          {errorMessage && <p className="error">{errorMessage}</p>}
        </form>
      )}
    </div>
  );
}

export default BrandForm;
