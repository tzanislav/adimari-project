import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useActiveSelection } from '../context/selectionContext';
import SuggestionsBox from '../components/SuggestionsBox';

function LicenseForm({handleRefresh, id, handleClose}) {
  const isEditing = Boolean(id);

  // From your contexts/hooks
  const { user } = useAuth();
  const { serverUrl } = useActiveSelection(); 

  const [isDeleting, setIsDeleting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // We'll store all licenses to derive suggestions from
  const [allLicenses, setAllLicenses] = useState([]);

  // This object will hold arrays of suggestions by field name
  const [suggestions, setSuggestions] = useState({
    user: [],
    platform: [],
    usedBy: [],
    // Add more if you want suggestions for other fields (e.g. comment)
  });

  // The data for a single license
  const [formData, setFormData] = useState({
    user: '',
    password: '',
    platform: '',
    usedBy: '',
    comment: '',
    price: '',
    imageUrl: '',
    expiresAt: '',
    clearances: [],
    createdBy: '',
  });

  // Refs for each field, if you want them
  const userRef = useRef(null);
  const platformRef = useRef(null);
  const usedByRef = useRef(null);

  // 1) Fetch ALL licenses once, for building suggestions
  useEffect(() => {
    const fetchAllLicenses = async () => {
      try {
        if (!user) return; // or handle unauthorized
        const token = await user.getIdToken();
        const response = await axios.get(`${serverUrl}/api/licenses`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setAllLicenses(response.data);
      } catch (err) {
        console.error('Failed to fetch all licenses:', err);
      }
    };
    fetchAllLicenses();
  }, [user, serverUrl, id]);

  // 2) If editing, fetch the specific license
  useEffect(() => {
    const fetchLicense = async () => {
      if (!isEditing) return;
      if (!user) {
        setErrorMessage('No authenticated user');
        return;
      }
      setLoading(true);
      try {
        const token = await user.getIdToken();
        const response = await axios.get(`${serverUrl}/api/licenses/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        console.log('Fetched license:', id);
        const existingLicense = response.data;

        // format expiresAt for <input type="date" />
        const dateString = existingLicense.expiresAt
          ? existingLicense.expiresAt.split('T')[0]
          : '';

        setFormData({
          ...existingLicense,
          expiresAt: dateString,
          clearances: Array.isArray(existingLicense.clearances)
            ? existingLicense.clearances
            : [],
        });
      } catch (error) {
        console.error('Failed to fetch license:', error);
        setErrorMessage('Failed to fetch license data.');
      } finally {
        setLoading(false);
      }
    };

    fetchLicense();
  }, [id, isEditing, user, serverUrl]);

  // Generic form field change
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    // Trigger suggestions only for certain fields
    if (['user', 'platform', 'usedBy'].includes(name) && value) {
      const filtered = allLicenses
        .map((lic) => lic[name]) // e.g. lic.user
        .filter((val) => typeof val === 'string' && val.toLowerCase().includes(value.toLowerCase()));
      // ensure unique suggestions
      const uniqueFiltered = Array.from(new Set(filtered));
      setSuggestions((prev) => ({ ...prev, [name]: uniqueFiltered }));
    } else {
      // Clear suggestions
      setSuggestions((prev) => ({ ...prev, [name]: [] }));
    }
  };

  // If you want to hide suggestions on blur
  const handleBlur = (field) => {
    setTimeout(() => {
      setSuggestions((prev) => ({ ...prev, [field]: [] }));
    }, 100); // short delay to let onClick from suggestions register
  };

  // If you want to show suggestions on focus
  const handleFocus = (field) => {
    const value = formData[field];
    if (value) {
      const filtered = allLicenses
        .map((lic) => lic[field])
        .filter((val) => val && val.toLowerCase().includes(value.toLowerCase()));
      const uniqueFiltered = Array.from(new Set(filtered));
      setSuggestions((prev) => ({ ...prev, [field]: uniqueFiltered }));
    }
  };

  // Clearances as comma-separated
  const handleClearancesChange = (e) => {
    const arr = e.target.value
      .split(',')
      .map((i) => i.trim())
      .filter((i) => i !== '');
    setFormData((prev) => ({ ...prev, clearances: arr }));
  };

  // Create or update license
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) {
      setErrorMessage('You must be logged in');
      return;
    }
    setLoading(true);

    try {
      const token = await user.getIdToken();
      if (isEditing) {
        await axios.put(`${serverUrl}/api/licenses/${id}`, formData, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSuccessMessage('License updated successfully!');
      } else {
        await axios.post(`${serverUrl}/api/licenses`, formData, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSuccessMessage('License created successfully!');
      }
      handleRefresh(); // Refresh the list of licenses
      handleClose();
    } catch (error) {
      console.error('Error submitting license form:', error);
      setErrorMessage(`Failed to submit form: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Delete license
  const handleDelete = async () => {
    if (!user) {
      setErrorMessage('You must be logged in');
      return;
    }
    try {
      const token = await user.getIdToken();
      await axios.delete(`${serverUrl}/api/licenses/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSuccessMessage('License deleted successfully!');
      handleClose();
      handleRefresh(); // Refresh the list of licenses
    } catch (error) {
      console.error('Failed to delete license:', error);
      setErrorMessage(`Failed to delete license: ${error.message}`);
    }
  };

  if(loading) {
    return null;
  }

  return (
    <div className="brand-form form-container">
      <h2>{isEditing ? 'Edit License' : 'Create License'}</h2>
      {isDeleting && (
        <div>
          <p>Are you sure you want to delete this license?</p>
          <button onClick={handleDelete}>Yes, Delete</button>
          <button onClick={() => setIsDeleting(false)}>Cancel</button>
        </div>
      )}

      {!isDeleting && !loading && (
        <form onSubmit={handleSubmit}>
          {/* PLATFORM field with suggestions */}
          <label>
            Platform*:
            <input
              ref={platformRef}
              type="text"
              name="platform"
              value={formData.platform}
              onChange={handleChange}
              onBlur={() => handleBlur('platform')}
              onFocus={() => handleFocus('platform')}
              autoComplete="off"
            />
          </label>
          <SuggestionsBox
            suggestions={suggestions.platform}
            onSuggestionClick={(value) => {
              setFormData((prev) => ({ ...prev, platform: value }));
              setSuggestions((prev) => ({ ...prev, platform: [] }));
            }}
            onClose={() => setSuggestions((prev) => ({ ...prev, platform: [] }))}
          />
          {/* USER field with suggestions */}
          <label>
            User*:
            <input
              ref={userRef}
              type="text"
              name="user"
              value={formData.user}
              onChange={handleChange}
              onBlur={() => handleBlur('user')}
              onFocus={() => handleFocus('user')}
              autoComplete="off"
              required
            />
          </label>
          <SuggestionsBox
            suggestions={suggestions.user}
            onSuggestionClick={(value) => {
              setFormData((prev) => ({ ...prev, user: value }));
              setSuggestions((prev) => ({ ...prev, user: [] }));
            }}
            onClose={() => setSuggestions((prev) => ({ ...prev, user: [] }))}
          />

          {/* PASSWORD field - no suggestions typically */}
          <label>
            Password*:
            <input
              type="text"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
            />
          </label>


          {/* USED BY field with suggestions */}
          <label>
            Used By:
            <input
              ref={usedByRef}
              type="text"
              name="usedBy"
              value={formData.usedBy}
              onChange={handleChange}
              onBlur={() => handleBlur('usedBy')}
              onFocus={() => handleFocus('usedBy')}
              autoComplete="off"
            />
          </label>
          <SuggestionsBox
            suggestions={suggestions.usedBy}
            onSuggestionClick={(value) => {
              setFormData((prev) => ({ ...prev, usedBy: value }));
              setSuggestions((prev) => ({ ...prev, usedBy: [] }));
            }}
            onClose={() => setSuggestions((prev) => ({ ...prev, usedBy: [] }))}
          />

          <label>
            Comment:
            <textarea
              name="comment"
              value={formData.comment}
              onChange={handleChange}
            />
          </label>

          <label>
            Price:
            <input
              type="number"
              name="price"
              value={formData.price}
              onChange={handleChange}
            />
          </label>


          <label>
            Expires At:
            <input
              type="date"
              name="expiresAt"
              value={formData.expiresAt}
              onChange={handleChange}
            />
          </label>



          <div className='buttons-container' style={{ marginTop: '1rem' }}>
            <button type="submit">
              {isEditing ? 'Update License' : 'Create License'}
            </button>
            <button type="button" onClick={handleClose}>
              Back
            </button>

            {isEditing && (
              <button
                type="button"
                style={{ marginLeft: '1rem', backgroundColor: 'red', color: 'white' }}
                onClick={() => setIsDeleting(true)}
              >
                Delete License
              </button>
            )}
          </div>

          {successMessage && <p style={{ color: 'green' }}>{successMessage}</p>}
          {errorMessage && <p style={{ color: 'red' }}>{errorMessage}</p>}
        </form>
      )}
    </div>
  );
}

export default LicenseForm;
