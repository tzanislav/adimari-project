/* eslint-disable react/prop-types */
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useActiveSelection } from '../context/selectionContext';
import SuggestionsBox from '../components/SuggestionsBox';

function LicenseForm({ handleRefresh, id, handleClose }) {
  const isEditing = Boolean(id);

  // From your contexts/hooks
  const { user, role } = useAuth();
  const { serverUrl } = useActiveSelection();

  const [isDeleting, setIsDeleting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
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
    clearances: 'moderator',
    createdBy: '',
  });

  // Refs for each field, if you want them
  const userRef = useRef(null);
  const platformRef = useRef(null);
  const usedByRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const timer = window.setTimeout(() => dialogRef.current?.querySelector('button, input')?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      previousFocus?.focus?.();
    };
  }, []);

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape' && !saving) {
      handleClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')];
    if (!controls.length) return;
    if (event.shiftKey && document.activeElement === controls[0]) {
      event.preventDefault();
      controls[controls.length - 1].focus();
    } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
      event.preventDefault();
      controls[0].focus();
    }
  };

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

        const existingLicense = response.data;

        // format expiresAt for <input type="date" />
        const dateString = existingLicense.expiresAt
          ? existingLicense.expiresAt.split('T')[0]
          : '';

        setFormData({
          ...existingLicense,
          expiresAt: dateString,
          clearances: existingLicense.clearances || 'moderator',
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


  // Create or update license
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) {
      setErrorMessage('You must be logged in');
      return;
    }
    setSaving(true);
    setErrorMessage('');

    try {
      const token = await user.getIdToken();
      if (isEditing) {
        await axios.put(`${serverUrl}/api/licenses/${id}`, formData, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        await axios.post(`${serverUrl}/api/licenses`, formData, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      handleRefresh(); // Refresh the list of licenses
      handleClose();
    } catch (error) {
      console.error('Error submitting license form:', error);
      setErrorMessage('Failed to submit license changes.');
    } finally {
      setSaving(false);
    }
  };

  // Delete license
  const handleDelete = async () => {
    if (!user) {
      setErrorMessage('You must be logged in');
      return;
    }
    setSaving(true);
    setErrorMessage('');
    try {
      const token = await user.getIdToken();
      await axios.delete(`${serverUrl}/api/licenses/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      handleClose();
      handleRefresh(); // Refresh the list of licenses
    } catch (error) {
      console.error('Failed to delete license:', error);
      setErrorMessage('Failed to delete license.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      ref={dialogRef}
      className="license-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="license-modal-title"
      onKeyDown={handleDialogKeyDown}
    >
      <div className="license-modal-header">
        <div>
          <h2 id="license-modal-title">{isDeleting ? 'Delete license' : isEditing ? 'Edit license' : 'Add license'}</h2>
          <p>{isDeleting ? 'This entry will be removed permanently.' : 'Account details and access'}</p>
        </div>
        <button type="button" className="license-modal-close" onClick={handleClose} disabled={saving} aria-label="Close dialog">×</button>
      </div>

      {loading ? <p className="license-modal-loading">Loading license…</p> : isDeleting ? (
        <div className="license-delete-confirmation">
          <p>Delete the license for <strong>{formData.user}</strong> on <strong>{formData.platform}</strong>?</p>
          {errorMessage && <p className="license-modal-error" role="alert">{errorMessage}</p>}
          <div className="license-modal-actions">
            <button type="button" className="license-modal-secondary" onClick={() => { setIsDeleting(false); setErrorMessage(''); }} disabled={saving}>Cancel</button>
            <button type="button" className="license-modal-danger-solid" onClick={handleDelete} disabled={saving}>{saving ? 'Deleting…' : 'Delete license'}</button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="license-modal-form">
          <div className="license-modal-grid">
            <div className="license-modal-field">
              <label htmlFor="license-platform">Platform <span>*</span></label>
              <input id="license-platform" ref={platformRef} type="text" name="platform" value={formData.platform} onChange={handleChange} onBlur={() => handleBlur('platform')} onFocus={() => handleFocus('platform')} autoComplete="off" required />
              <SuggestionsBox suggestions={suggestions.platform} onSuggestionClick={(value) => { setFormData((prev) => ({ ...prev, platform: value })); setSuggestions((prev) => ({ ...prev, platform: [] })); }} onClose={() => setSuggestions((prev) => ({ ...prev, platform: [] }))} />
            </div>
            <div className="license-modal-field">
              <label htmlFor="license-user">Username <span>*</span></label>
              <input id="license-user" ref={userRef} type="text" name="user" value={formData.user} onChange={handleChange} onBlur={() => handleBlur('user')} onFocus={() => handleFocus('user')} autoComplete="off" required />
              <SuggestionsBox suggestions={suggestions.user} onSuggestionClick={(value) => { setFormData((prev) => ({ ...prev, user: value })); setSuggestions((prev) => ({ ...prev, user: [] })); }} onClose={() => setSuggestions((prev) => ({ ...prev, user: [] }))} />
            </div>
            <div className="license-modal-field">
              <label htmlFor="license-password">Password <span>*</span></label>
              <div className="license-modal-password">
                <input id="license-password" type={showPassword ? 'text' : 'password'} name="password" value={formData.password} onChange={handleChange} required />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? 'Hide' : 'Show'}</button>
              </div>
            </div>
            <div className="license-modal-field">
              <label htmlFor="license-used-by">Used by</label>
              <input id="license-used-by" ref={usedByRef} type="text" name="usedBy" value={formData.usedBy} onChange={handleChange} onBlur={() => handleBlur('usedBy')} onFocus={() => handleFocus('usedBy')} autoComplete="off" />
              <SuggestionsBox suggestions={suggestions.usedBy} onSuggestionClick={(value) => { setFormData((prev) => ({ ...prev, usedBy: value })); setSuggestions((prev) => ({ ...prev, usedBy: [] })); }} onClose={() => setSuggestions((prev) => ({ ...prev, usedBy: [] }))} />
            </div>
            <div className="license-modal-field">
              <label htmlFor="license-price">Price (EUR)</label>
              <input id="license-price" type="number" name="price" value={formData.price} onChange={handleChange} />
            </div>
            <div className="license-modal-field">
              <label htmlFor="license-expires">Expires at</label>
              <input id="license-expires" type="date" name="expiresAt" value={formData.expiresAt} onChange={handleChange} />
            </div>
            <div className="license-modal-field license-modal-field-wide">
              <label htmlFor="license-comment">Comment</label>
              <textarea id="license-comment" name="comment" rows="3" value={formData.comment} onChange={handleChange} />
            </div>
            {role === 'admin' && (
              <div className="license-modal-field license-modal-field-wide">
                <label htmlFor="license-clearances">Visible to</label>
                <select id="license-clearances" name="clearances" value={formData.clearances || 'moderator'} onChange={handleChange}>
                  <option value="moderator">Moderators and admins</option>
                  <option value="admin">Admins only</option>
                </select>
              </div>
            )}
          </div>
          {errorMessage && <p className="license-modal-error" role="alert">{errorMessage}</p>}
          <div className="license-modal-actions">
            {isEditing && <button type="button" className="license-modal-danger" onClick={() => { setIsDeleting(true); setErrorMessage(''); }} disabled={saving}>Delete</button>}
            <button type="button" className="license-modal-secondary" onClick={handleClose} disabled={saving}>Cancel</button>
            <button type="submit" className="license-modal-primary" disabled={saving}>{saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add license'}</button>
          </div>
        </form>
      )}
    </section>
  );
}

export default LicenseForm;
