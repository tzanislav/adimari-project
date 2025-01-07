import React, { useState } from 'react';
import axios from 'axios';

const FileUploader = ({ folderName, onUploadComplete }) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // Handle file selection and immediate upload
  const handleFileChange = async (e) => {
    const files = e.target.files;

    if (files.length === 0) {
      setError('No files selected.');
      return;
    }

    setUploading(true);
    setError('');

    const formData = new FormData();
    Array.from(files).forEach((file) => {
      formData.append('files', file);
    });

    try {
      const response = await axios.post(
        `http://localhost:5000/upload?folder=${encodeURIComponent(folderName)}`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      const uploadedUrls = response.data.urls;

      // Pass URLs to the parent component
      if (onUploadComplete) {
        onUploadComplete(uploadedUrls);
      }
    } catch (err) {
      console.error('Error uploading files:', err);
      setError('Failed to upload files.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="file-uploader">
      <input
        type="file"
        multiple
        onChange={handleFileChange}
        accept="*/*"
        disabled={uploading}
      />
      {uploading && <p>Uploading...</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
};

export default FileUploader;
