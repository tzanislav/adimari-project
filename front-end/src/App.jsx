import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Brands from './pages/Brands';
import Models3D from './pages/Models3D';
import BrandForm from './pages/BrandForm';
import Model3DForm from './pages/Model3DForm';
import ExampleForm from './pages/TestUploader';
import ShowModel from './pages/ShowModel'; // Optional component to show a single model
import Projects from './pages/Projects'; // Optional component to show projects
import ProjectForm from './pages/ProjectForm';
import ShowProject from './pages/ShowProject'; // Optional component to show a single project
import Navbar from './components/Navbar'; // Optional navigation component
import { ActiveSelectionProvider } from "./components/selectionContext";
import './App.css';

function App() {
  return (
    <div>
      <ActiveSelectionProvider>
        <Navbar /> {/* Optional: Add navigation bar */}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/brands" element={<Brands />} />
          <Route path="/brands/:id" element={<BrandForm />} />
          <Route path="/brands/new" element={<BrandForm />} />
          <Route path="/models3d/" element={<Models3D />} />
          <Route path="/models3d/:id" element={<ShowModel />} />
          <Route path="/models3d/edit/:id" element={<Model3DForm />} />
          <Route path="/models3d/new" element={<Model3DForm />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ShowProject />} />
          <Route path="/projects/edit/:id" element={<ProjectForm />} />
          <Route path="/projects/new" element={<ProjectForm />} />
          <Route path="/test" element={<ExampleForm />} />
        </Routes>
      </ActiveSelectionProvider>
    </div>
  );
}

export default App;
