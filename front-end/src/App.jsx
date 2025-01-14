import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Brands from './pages/Brands';
import Models3D from './pages/Models3D';
import BrandForm from './components/BrandForm';
import Model3DForm from './components/Model3DForm';
import ExampleForm from './components/TestUploader';
import ShowModel from './pages/ShowModel'; // Optional component to show a single model
import Projects from './pages/Projects'; // Optional component to show projects
import ProjectForm from './components/ProjectForm';
import ShowProject from './pages/ShowProject'; // Optional component to show a single project
import ShowSelection from './pages/ShowSelection';
import Navbar from './components/Navbar'; // Optional navigation component
import ItemForm from './components/ItemForm'
import Items from './pages/Items';
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
          <Route path="/items/new" element={<ItemForm />} />
          <Route path="/items/edit/:id" element={<ItemForm />} />
          <Route path="/items/:id" element={<ItemForm />} />
          <Route path="/items" element={<Items />} />
          <Route path="/models3d/" element={<Models3D />} />
          <Route path="/models3d/:id" element={<ShowModel />} />
          <Route path="/models3d/edit/:id" element={<Model3DForm />} />
          <Route path="/models3d/new" element={<Model3DForm />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ShowProject />} />
          <Route path="/projects/edit/:id" element={<ProjectForm />} />
          <Route path="/projects/new" element={<ProjectForm />} />
          <Route path="/selections/:id" element={<ShowSelection />} />
          <Route path="/test" element={<ExampleForm />} />
        </Routes>
      </ActiveSelectionProvider>
    </div>
  );
}

export default App;
