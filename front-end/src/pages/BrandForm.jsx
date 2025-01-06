import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import '../CSS/EditBrand.css';

function BrandForm() {
  const { id } = useParams(); // Get ID from URL
  const isEditing = Boolean(id); // Check if the page is for editing
  const [isDeleting, setIsDeleting] = useState(false); // State for delete confirmation

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    website: '',
    images: [],
    category: '', // Default value
    class: 'Low',
    distributor: '',
    location: '',
    personToContact: '',
    email: '',
    phone: '',
    discount: 0,
    tags: [], // Ensure this is always an array
    models3D: [], // Ensure this is always an array
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
          const response = await axios.get(`http://localhost:5000/brands/${id}`);
          const data = response.data;
          setFormData({
            ...data,
            tags: data.tags || [], // Default to an empty array
            models3D: data.models3D || [], // Default to an empty array
          });
        } catch (error) {
          console.error('Failed to fetch brand:', error);
          setErrorMessage('Failed to fetch brand data.');
        } finally {
          setLoading(false);
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
      ? `http://localhost:5000/brands/${id}` // PUT URL for editing
      : 'http://localhost:5000/brands'; // POST URL for creating

    const method = isEditing ? 'PUT' : 'POST'; // HTTP method

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
      //wait 0.5s before redirecting to the brands page
      setTimeout(() => {
        window.location.href = '/brands';
      }, 500);

      setErrorMessage('');
      if (!isEditing) {
        // Reset form for new creation
        setFormData({
          name: '',
          description: '',
          website: '',
          images: [],
          category: 'Low',
          class: '',
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
      setErrorMessage('Failed to submit form: ' + error.message);
      setSuccessMessage('');

    }
  };

  //Delete brand
  const handleDelete = async () => {
    try {
      await axios.delete(`http://localhost:5000/brands/${id}`);
      setSuccessMessage('Brand deleted successfully!');
      setErrorMessage('');
      //wait 0.5s before redirecting to the brands page
      setTimeout(() => {
        window.location.href = '/brands';
      }, 500);
    } catch (error) {
      setErrorMessage('Failed to delete brand: ' + error.message);
      setSuccessMessage('');
    }
  };

  return (
    <div className="brand-form">
      <h2>{isEditing ? 'Edit Brand' : 'Create New Brand'}</h2>
      {loading && <p>Loading brand data...</p>}

      <div className="delete-box">
        {isDeleting && (
          <>
            <div className="overlay"></div>
            <div className="delete-box-content">
              <p>Are you sure you want to delete this brand?</p>
              <button type="button" onClick={() => setIsDeleting(false)}>
                Cancel
              </button>
              <button type="button" className="deleteButton" onClick={handleDelete}>
                Delete Brand
              </button>
            </div>
          </>
        )}
      </div>

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
            Website:
            <input
              type="url"
              name="website"
              value={formData.website || ''}
              onChange={handleChange}
            />
          </label>

          <label>
            Category:
            <input
              type="text"
              name="category"
              value={formData.category || ''} // Ensure value is not null
              onChange={handleChange}
              required
            />
          </label>

          <label>
            Class:
            <select
              name="class"
              value={formData.class || ''} // Ensure value is not null
              onChange={handleChange}
              required
            >
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Luxury">Luxury</option>
            </select>
          </label>

          <label>
            Distributor:
            <input
              type="text"
              name="distributor"
              value={formData.distributor || ''}
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

          <label>
            Tags (comma-separated):
            <input
              type="text"
              name="tags"
              value={formData.tags?.join(', ') || ''} // Safe .join() usage
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  tags: e.target.value.split(',').map((tag) => tag.trim()),
                }))
              }
            />
          </label>

          <label>
            3D Models:
            <input
              type="text"
              name="models3D"
              value={formData.models3D?.join(', ') || ''} // Safe .join() usage
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  models3D: e.target.value.split(',').map((model) => model.trim()),
                }))
              }
            />
          </label>

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
          <div className='buttons'>
            <button type="submit">
              {isEditing ? 'Update Brand' : 'Create Brand'}
            </button>

            <button type="button" onClick={() => window.history.back()}>
              Back
            </button>

            {isEditing && (
              <button type="button" className='deleteButton' onClick={() => setIsDeleting(true)}>
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
