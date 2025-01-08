import React, { useState } from 'react';
import axios from 'axios';
import '../CSS/Uploader.css';

const FileUploader = ({ folderName, onUploadComplete, onRemove }) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);

  const showOnlyName = (url) => {
    const newName = url.split('/').pop();
    const decodedName = decodeURIComponent(newName);
    const finalName = new TextDecoder('utf-8').decode(new Uint8Array(decodedName.split('').map((c) => c.charCodeAt(0))));
    return finalName.length > 20 ? finalName.substring(0, 20) + '....' : finalName;
  };

  const isImage = (url) => url.match(/\.(jpeg|jpg|gif|png|webp)$/) != null;

  const handleFileUpload = async (files) => {
    const maxSize = 4 * 1024 * 1024;
    const oversizedFiles = Array.from(files).filter((file) => file.size > maxSize);

    if (oversizedFiles.length > 0) {
      setError('Some files exceed the 4MB size limit.');
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

      if (onUploadComplete) {
        onUploadComplete(uploadedUrls);
        setUploadedFiles((prev) => [...prev, ...uploadedUrls]);
      }
    } catch (err) {
      console.error('Error uploading files:', err);
      setError('Failed to upload files.');
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e) => {
    const files = e.target.files;
    if (files.length === 0) {
      setError('No files selected.');
      return;
    }
    handleFileUpload(files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length === 0) {
      setError('No files dropped.');
      return;
    }
    handleFileUpload(files);
  };

  const handleRemove = (index) => {
    const fileToRemove = uploadedFiles[index];
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));

    if (onRemove) {
      onRemove(fileToRemove); // Notify parent component about the removal
    }
  };

  return (
    <div
      className={`file-uploader ${isDragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <h3>Upload Files</h3>
      <input
        type="file"
        multiple
        onChange={handleFileChange}
        accept="*/*"
        disabled={uploading}
      />
      <p>Drag and drop files here or click to select</p>

      {uploading && <p>Uploading...</p>}

      {uploadedFiles.length > 0 && (
        <div>
          <h4>Uploaded Files:</h4>
          <ul>
            {uploadedFiles.map((url, index) => (
              <li key={index}>
                {isImage(url) ? (
                  <img src={url} alt={showOnlyName(url)} />
                ) : (
                  <p>
                    {showOnlyName(url)}
                  </p>
                )}
                <button
                  onClick={(e) => {
                    e.preventDefault(); // Prevent form submission
                    handleRemove(index); // Call the handleRemove function
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
};

export default FileUploader;
