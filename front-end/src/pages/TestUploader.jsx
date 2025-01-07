import React, { useState } from 'react';
import FileUploader from './FileUploader';

const ExampleForm = () => {
  const [uploadedFiles, setUploadedFiles] = useState([]);

  const handleUploadComplete = (urls) => {
    setUploadedFiles((prev) => [...prev, ...urls]);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log('Submitting form with uploaded files:', uploadedFiles);
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Example Form</h2>

      {/* Pass folder name to FileUploader */}
      <FileUploader folderName="example-folder" onUploadComplete={handleUploadComplete} />

      <button type="submit">Submit Form</button>

      {uploadedFiles.length > 0 && (
        <div>
          <h4>Uploaded Files:</h4>
          <ul>
            {uploadedFiles.map((url, index) => (
              <li key={index}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
};

export default ExampleForm;
