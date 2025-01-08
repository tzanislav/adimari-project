import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import FileUploader from '../components/FileUploader'; // Ensure correct import path
import '../CSS/EditBrand.css';
import { showOnlyName } from '../utils/utils';

function Model3dForm() {
  const { id } = useParams(); // Get ID from URL
  const isEditing = Boolean(id); // Check if the page is for editing
  const [isDeleting, setIsDeleting] = useState(false); // State for delete confirmation
  const [brands, setBrands] = useState([]); // State for brand data

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    images: [], // Field for uploaded image URLs
    category: '',
    class: 'Low',
    tags: [],
    brand: '',
    price: 0,
    path: '',
  });

  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  

  // Fetch model data if editing
  useEffect(() => {
    if (isEditing) {
      const fetchModel3d = async () => {
        setLoading(true);
        try {
          const response = await axios.get(`http://localhost:5000/models3d/${id}`);
          const data = response.data;
          setFormData({
            ...data,
            tags: data.tags || [],
            images: data.images || [],
          });
        } catch (error) {
          console.error('Failed to fetch model:', error);
          setErrorMessage('Failed to fetch model data.');
        } finally {
          setLoading(false);
        }
      };
      fetchModel3d();
    }
  }, [id, isEditing]);


//Fetch brands data
  useEffect(() => {
    const fetchBrands = async () => {
      try {
        const response = await axios.get('http://localhost:5000/brands');
        setBrands(response.data);
      } catch (error) {
        console.error('Failed to fetch brands:', error);
        setErrorMessage('Failed to fetch brand data.');
      }
    };
    fetchBrands();
  }, []);



  // Handle input changes
  const handleChange = (e) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'number' ? parseFloat(value) : value,
    }));
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing
      ? `http://localhost:5000/models3d/${id}`
      : 'http://localhost:5000/models3d';

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
          ? `Model "${response.data.name}" updated successfully!`
          : `Model "${response.data.name}" created successfully!`
      );
      setTimeout(() => {
        window.location.href = '/models3d';
      }, 500);

      if (!isEditing) {
        setFormData({
          name: '',
          description: '',
          images: [],
          category: '',
          class: 'Low',
          tags: [],
          brand: '',
          price: 0,
          path: '',
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
      await axios.delete(`http://localhost:5000/models3d/${id}`);
      setSuccessMessage('Model deleted successfully!');
      setTimeout(() => {
        window.location.href = '/models3d';
      }, 500);
    } catch (error) {
      setErrorMessage('Failed to delete model: ' + error.message);
    }
  };

  return (
    <div className="brand-form">
      <h2>{isEditing ? 'Edit Model' : 'Create New Model'}</h2>
      {loading && <p>Loading model data...</p>}

      <div className="delete-box">
        {isDeleting && (
          <>
            <div className="overlay"></div>
            <div className="delete-box-content">
              <p>Are you sure you want to delete this model?</p>
              <button type="button" onClick={() => setIsDeleting(false)}>
                Cancel
              </button>
              <button type="button" className="deleteButton" onClick={handleDelete}>
                Delete Model
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

          {formData.name ? (
            <label>
              Images:
              <FileUploader
                folderName={formData.name}
                onUploadComplete={(uploadedUrls) => {
                  setFormData((prev) => ({
                    ...prev,
                    images: [...prev.images, ...uploadedUrls],
                  }));
                }} onRemove={(deletedUrl) => {
                  setFormData((prev) => ({
                    ...prev,
                    images: prev.images.filter((url) => url !== deletedUrl),
                  }));
                }}
              />
            </label>) :

            <label>
              Files:
              <p className='error' >Upload files after entering a name</p>
            </label>

          }

          {formData.images.length > 0 && (
            <>
              <p>Existing Images:</p>
              <ul>
                {formData.images.map((image, index) => (
                  <li key={index}>
                    <p>{showOnlyName(image)}</p>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        setFormData((prev) => ({
                          ...prev,
                          images: prev.images.filter((_, i) => i !== index),
                        }));
                      }}
                    >
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

          <label>
            Brand:
            <input
              type="text"
              name="brand"
              value={formData.brand || ''}
              onChange={handleChange}
            />
          </label>

          
          <label>
            Existing Brand:
            <select
              name="brand"
              value={formData.brand || ''}
              onChange={handleChange}
            >
              <option value="">Select a brand</option>
              {brands.map((brand) => (
                <option key={brand._id} value={brand.name}>
                  {brand.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Price:
            <input
              type="number"
              name="price"
              value={formData.price || 0}
              onChange={handleChange}
            />
          </label>

          <label>
            Path:
            <input
              type="text"
              name="path"
              value={formData.path || ''}
              onChange={handleChange}
            />
          </label>

          <div className="buttons">
            <button type="submit">
              {isEditing ? 'Update Model' : 'Create Model'}
            </button>

            <button type="button" onClick={() => window.history.back()}>
              Back
            </button>

            {isEditing && (
              <button
                type="button"
                className="deleteButton"
                onClick={() => setIsDeleting(true)}
              >
                Delete Model
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

export default Model3dForm;
