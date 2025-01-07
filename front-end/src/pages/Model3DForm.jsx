import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import '../CSS/EditBrand.css';

function Model3DForm() {
  const { id } = useParams(); // Get ID from URL
  const isEditing = Boolean(id); // Check if the page is for editing

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    images: [], // This will now hold uploaded image URLs
    category: '',
    class: 'Low',
    tags: [],
    brand: '',
    price: 0,
    path: '',
  });

  const [imageFiles, setImageFiles] = useState([]); // For file uploads
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [brands, setBrands] = useState([]);

  // Fetch brands for dropdown
  useEffect(() => {
    const fetchBrands = async () => {
      try {
        const response = await axios.get('http://localhost:5000/brands');
        setBrands(response.data);
      } catch (error) {
        console.error('Failed to fetch brands:', error);
      }
    };
    fetchBrands();
  }, []);

  // Fetch model data if editing
  useEffect(() => {
    if (isEditing) {
      const fetchModel = async () => {
        setLoading(true);
        try {
          const response = await axios.get(`http://localhost:5000/models/${id}`);
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
      fetchModel();
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

  // Handle file selection
  const handleFileChange = (e) => {
    setImageFiles(e.target.files);
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    setSuccessMessage('Working...');

    const url = isEditing
        ? `http://localhost:5000/models/${id}`
        : 'http://localhost:5000/models';

    const method = isEditing ? 'PUT' : 'POST';

    try {
        let uploadedImageUrls = [];

        // If images were selected, upload them
        if (imageFiles.length > 0) {
            const uploadFormData = new FormData();
            Array.from(imageFiles).forEach((file) => {
                uploadFormData.append('images', file);
                console.log('Uploading image:', file.name);
            });

            // Wait for the image upload to complete
            const uploadResponse = await axios.post(
                'http://localhost:5000/models/upload-images',
                uploadFormData,
                { headers: { 'Content-Type': 'multipart/form-data' } }
            );

            // Capture uploaded image URLs
            uploadedImageUrls = uploadResponse.data.imageUrls;
            console.log('Uploaded images:', uploadedImageUrls);
        }

        // Combine uploaded image URLs with the existing ones
        const finalFormData = {
            ...formData,
            images: [...formData.images, ...uploadedImageUrls],
        };

        // Submit the rest of the data to the backend
        const response = await axios({
            url,
            method,
            headers: { 'Content-Type': 'application/json' },
            data: finalFormData,
        });

        setSuccessMessage(
            isEditing
                ? `Model "${response.data.name}" updated successfully!`
                : `Model "${response.data.name}" created successfully!`
        );

        setErrorMessage('');
        if (!isEditing) {
            // Reset form for new creation
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
            setImageFiles([]);
        }
    } catch (error) {
        console.error('Error during form submission:', error);
        setErrorMessage('Failed to submit form: ' + error.message);
        setSuccessMessage('');
    }
};

  return (
    <div className="brand-form">
      <h2>{isEditing ? 'Edit 3D Model' : 'Create New 3D Model'}</h2>

      {loading && <p>Loading model data...</p>}
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
            Upload Images:
            <input
              type="file"
              name="images"
              multiple
              onChange={handleFileChange}
              accept="image/*"
            />
          </label>

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

          <div className="brand-search">
            <label>
              Select Brand:
              <select
                name="brand"
                value={formData.brand || ''}
                onChange={handleChange}
                required
              >
                <option value="">Select a brand</option>
                {brands.map((brand) => (
                  <option key={brand._id} value={brand.name}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

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
          </div>

          {successMessage && <p className="success">{successMessage}</p>}
          {errorMessage && <p className="error">{errorMessage}</p>}
        </form>
      )}
    </div>
  );
}

export default Model3DForm;
