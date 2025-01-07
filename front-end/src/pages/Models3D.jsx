import React from 'react';
import { Link } from 'react-router-dom';

function Models3D() {
  return (
    <div>
      <h1>3D Models Page</h1>
      <p>Check out our collection of 3D mssodels here.</p>
      <Link to="/models/new">Add a new 3D model</Link>
      
    </div>
  );
}

export default Models3D;
