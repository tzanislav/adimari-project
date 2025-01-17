import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import FileUploader from '../components/FileUploader'; // Ensure correct import path
import '../CSS/EditBrand.css';
import { showOnlyName } from '../utils/utils';
import DeleteBox from "../components/DeleteBox";
import SuggestionsBox from '../components/SuggestionsBox';
import { useActiveSelection } from "../components/selectionContext";



function ItemForm() {
  const { id } = useParams(); // Get ID from URL
  const isEditing = Boolean(id); // Check if the page is for editing
  const [isDeleting, setIsDeleting] = useState(false); // State for delete confirmation
  const [analysedImage, setAnalysedImage] = useState(false); // State for analyzed image data
  const [items, setItems] = useState([]);
  const { serverUrl } = useActiveSelection();

  const [suggestions, setSuggestions] = useState({
    name: [],
    category: [],
    distributor: [],
    brand: []
  });

  const formRefs = {
    name: useRef(null),
    brand: useRef(null),
    distributor: useRef(null),
    category: useRef(null),
  };


  const [formData, setFormData] = useState({
    name: '',
    brand: '',
    distributor: '',
    description: '',
    website: '',
    files: [],
    category: '',
    class: 'Low',
    price: 0,
    tags: [],
    modelPath: '',
    has3dmodels: false,
    hasDWGmodels: false,
  });

  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch item data if editing
  useEffect(() => {
    if (isEditing) {
      const fetchItem = async () => {
        setLoading(true);
        try {
          const response = await axios.get(`${serverUrl}/api/items/${id}`);
          const data = response.data;
          setFormData({
            ...data,
            tags: data.tags || [],
            files: data.files || [],
          });
        } catch (error) {
          console.error('Failed to fetch item:', error);
          setErrorMessage('Failed to fetch item data.');
        } finally {
          setLoading(false);
          setIsDeleting(false);
        }
      };
      fetchItem();
    }
  }, [id, isEditing]);


  // Fetch items data
  useEffect(() => {
    const fetchItems = async () => {
      try {
        const response = await axios.get(`${serverUrl}/api/items`);
        setItems(response.data);
      } catch (error) {
        console.error('Failed to fetch items:', error);
        setErrorMessage('Failed to fetch items data.');
      }
    };
    fetchItems();

  }, []);



  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const inputValue = type === 'checkbox' ? checked : value;

    setFormData((prev) => ({ ...prev, [name]: inputValue }));

    if (type !== 'checkbox' && value) {
      const filteredSuggestions = [...new Set(
        items
          .map((item) => item[name])
          .filter((val) => typeof val === 'string' && val.toLowerCase().includes(value.toLowerCase()))
      )];

      setSuggestions((prev) => ({
        ...prev,
        [name]: filteredSuggestions,
      }));
    } else {
      setSuggestions((prev) => ({
        ...prev,
        [name]: [],
      }));
    }
  };


  const handleBlur = (field) => {
    setTimeout(() => {
      setSuggestions((prev) => ({
        ...prev,
        [field]: [],
      }));
    }, 100); // Delay to allow onClick events to process
  };

  const handleFocus = (field) => {
    if (formData[field]) {
      const filteredSuggestions = [...new Set(
        items
          .map((item) => item[field])
          .filter((val) => val && val.toLowerCase().includes(formData[field].toLowerCase()))
      )];

      setSuggestions((prev) => ({
        ...prev,
        [field]: filteredSuggestions,
      }));
    }
  };


  const handleSuggestionClick = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setNameSuggestions([]); // Clear suggestions after selection
  };

  const handleCloseSuggestions = () => {
    setNameSuggestions([]); // Clear suggestions when clicking outside
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing
      ? `${serverUrl}/api/items/${id}`
      : `${serverUrl}/api/items`;

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
          ? `Item "${formData.name}" updated successfully!`
          : `Item "${formData.name}" created successfully!`
      );
      setTimeout(() => {
        window.history.back();
      }, 500);

      if (!isEditing) {
        setFormData({
          name: '',
          brand: '',
          distributor: '',
          description: '',
          website: '',
          files: [],
          category: '',
          class: 'Low',
          price: 0,
          tags: [],
          modelPath: '',
          has3dmodels: false,
          hasDWGmodels: false,
        });
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      setErrorMessage('Failed to submit form: ' + error.message);
    }
  };

  // Analyze image with Rekognition
  const analyzeImage = async (imageUrl) => {
    if (formData.tags.length > 0) {
      return;
    }

    //Check if imageUrl is a valid image
    const isValidImageUrl = (url) => {
      return /\.(jpg|jpeg|png|gif|bmp)$/i.test(url);
    };

    if (!isValidImageUrl(imageUrl)) {
      setErrorMessage('Invalid image URL.');
      return;
    }


    setFormData((prev) => ({
      ...prev,
      tags: ["Analyzing..."],
    }));
    try {
      const response = await axios.post(`${serverUrl}/api/upload/analyze-image`, {
        imageUrl,
      });

      // Extract top-level names
      const topLevelNames = response.data
        .filter((item) => item.Confidence > 90)
        .map((item) => item.Name);

      // Set the analysis and tags
      setAnalysedImage(true);
      setFormData((prev) => ({
        ...prev,
        tags: topLevelNames,
      }));
    } catch (error) {
      console.error('Failed to analyze image:', error);
      setFormData((prev) => ({
        ...prev,
        tags: [],
      }));
      setErrorMessage('Failed to analyze image.');
    }
  };

  // Delete item
  const handleDelete = async () => {
    try {
      await axios.delete(`${serverUrl}/api/items/${id}`);
      setSuccessMessage('Item deleted successfully!');
      setTimeout(() => {
        //Back
        window.history.back();
      }, 500);
    } catch (error) {
      setErrorMessage('Failed to delete item: ' + error.message);
    }
  };


  return (
    <div className="brand-form">
      <h2>{isEditing ? 'Edit Item' : 'Create New Item'}</h2>
      {loading && <p>Loading item data...</p>}

      {isDeleting && (
        <DeleteBox
          itemName="Item"
          deleteFunction={handleDelete}
          closeFunction={() => setIsDeleting(false)}
        />
      )}

      {!loading && (
        <form onSubmit={handleSubmit}>
          <label>
            Name:
            <input
              ref={formRefs.name}
              type="text"
              name="name"
              autoComplete="off"
              value={formData.name || ''}
              onChange={handleChange}
              onBlur={() => handleBlur('name')}
              onFocus={() => handleFocus('name')}
              required
            />
          </label>
          <SuggestionsBox
            suggestions={suggestions["name"]}
            onSuggestionClick={(value) => {
              setFormData((prev) => ({ ...prev, name: value }));
              setSuggestions((prev) => ({ ...prev, name: [] }));
            }}
            onClose={() => setSuggestions((prev) => ({ ...prev, name: [] }))}
          />

          <label>
            Brand:
            <input
              ref={formRefs.brand}
              type="text"
              name="brand"
              value={formData.brand || ''}
              onChange={handleChange}
              onBlur={() => handleBlur('brand')}
              onFocus={() => handleFocus('brand')}
              autoComplete="off"
              required
            />
          </label>
          <SuggestionsBox
            suggestions={suggestions["brand"]}
            onSuggestionClick={(value) => {
              setFormData((prev) => ({ ...prev, brand: value }));
              setSuggestions((prev) => ({ ...prev, brand: [] }));
            }}
            onClose={() => setSuggestions((prev) => ({ ...prev, brand: [] }))}
          />

          <label>
            Distributor:
            <input
              ref={formRefs.distributor}
              type="text"
              name="distributor"
              value={formData.distributor || ''}
              autoComplete="off"
              onChange={handleChange}
              onBlur={() => handleBlur('distributor')}
              onFocus={() => handleFocus('distributor')}
            />
          </label>
          <SuggestionsBox
            suggestions={suggestions["distributor"]}
            onSuggestionClick={(value) => {
              setFormData((prev) => ({ ...prev, distributor: value }));
              setSuggestions((prev) => ({ ...prev, distributor: [] }));
            }}
            onClose={() => setSuggestions((prev) => ({ ...prev, distributor: [] }))}
          />

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
              type="text"
              name="website"
              value={formData.website || ''}
              onChange={handleChange}
            />
          </label>

          {formData.name.length > 2 ? (
            <label>
              Images:
              <FileUploader
                folderName={formData.name}
                onUploadComplete={(uploadedUrls) => {
                  setFormData((prev) => ({
                    ...prev,
                    files: [...prev.files, ...uploadedUrls],
                  }));
                  analyzeImage(uploadedUrls[0]);
                }}
                onRemove={(deletedUrl) => {
                  setFormData((prev) => ({
                    ...prev,
                    files: prev.files.filter((url) => url !== deletedUrl),
                  }));
                }}
              />
            </label>
          ) : (
            <label>
              Files:
              <p className='error'>Upload files after entering a name</p>
            </label>
          )}

          {formData.files.length > 0 && (
            <div className='uploaded-files'>
              {formData.files.map((file, index) => (
                <div className='uploaded-file' key={index}>
                  {file.match(/\.(jpeg|jpg|gif|png|webp)$/i)
                    ?
                    (<img className='uploaded-img' src={file} alt={showOnlyName(file)} />) :
                    (<img className='uploaded-img' src="https://static.vecteezy.com/system/resources/previews/000/420/464/original/vector-document-in-folder-icon.jpg" alt={showOnlyName(file)} />)
                  }


                  <p>{showOnlyName(file)}</p>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setFormData((prev) => ({
                        ...prev,
                        files: prev.files.filter((_, i) => i !== index),
                      }));
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <label>
            Category:
            <input
              ref={formRefs.category}
              type="text"
              name="category"
              value={formData.category || ''}
              onChange={handleChange}
              onBlur={() => handleBlur('category')}
              onFocus={() => handleFocus('category')}
              autoComplete="off"
              required
            />
          </label>
          <SuggestionsBox
            suggestions={suggestions["category"]}
            onSuggestionClick={(value) => {
              setFormData((prev) => ({ ...prev, category: value }));
              setSuggestions((prev) => ({ ...prev, category: [] }));
            }}
            onClose={() => setSuggestions((prev) => ({ ...prev, category: [] }))}
          />

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
            Price:
            <input
              type="number"
              name="price"
              value={formData.price || 0}
              onChange={handleChange}
            />
          </label>

          <label>
            Model Path:
            <input
              type="text"
              name="modelPath"
              value={formData.modelPath || ''}
              onChange={handleChange}
            />
          </label>

          <div className="checkboxes">
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
              {isEditing ? 'Update Item' : 'Create Item'}
            </button>

            <button type="button" onClick={() => window.history.back()}>
              Back
            </button>

            {isEditing && (
              <button type="button" className="deleteButton" onClick={() => setIsDeleting(true)}>
                Delete Item
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

export default ItemForm;
