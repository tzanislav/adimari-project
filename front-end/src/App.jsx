import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Brands from './pages/Brands';
import Models3D from './pages/Models3D';
import BrandForm from './pages/BrandForm';
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
      </Routes>
    </div>
  );
}

export default App;
