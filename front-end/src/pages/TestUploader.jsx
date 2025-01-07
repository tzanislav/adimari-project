import React, { useState } from 'react';
import FileUploader from '../components/FileUploader';

const ExampleForm = () => {


  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <h2>Example Form</h2>

      {/* Pass folder name to FileUploader */}
      <FileUploader folderName="example-folder" onUploadComplete={() => {}} />
    </form>
  );
};

export default ExampleForm;
