import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Brands from './pages/Brands';
import Models3D from './pages/Models3D';
import BrandForm from './pages/BrandForm';
import Model3DForm from './pages/Model3DForm';
import Navbar from './components/Navbar'; // Optional navigation component
import './App.css';

function App() {
  return (
    <div>
      <Navbar /> {/* Optional: Add navigation bar */}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/brands" element={<Brands />} />
        <Route path="/models" element={<Models3D />} />
        <Route path="/brands/:id" element={<BrandForm />} />
        <Route path="/brands/new" element={<BrandForm />} />
        <Route path="/models/:id" element={<Model3DForm />} />
        <Route path="/models/new" element={<Model3DForm />} />
      </Routes>
    </div>
  );
}

export default App;
