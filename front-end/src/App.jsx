import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home'; // Optional component to show a single model
import Projects from './pages/Projects'; // Optional component to show projects
import ProjectForm from './components/ProjectForm';
import ShowProject from './pages/ShowProject'; // Optional component to show a single project
import ShowSelection from './pages/ShowSelection';
import Navbar from './components/Navbar'; // Optional navigation component
import ItemForm from './components/ItemForm'
import Items from './pages/Items';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import { ActiveSelectionProvider } from './context/selectionContext'; 
import SignUp from './pages/SignUp';
import Footer from './components/Footer';
import Team from './pages/Team';
import TeamStatus from './pages/TeamStatus';
import './App.css';

function App() {
  return (
    <div>
      <AuthProvider>
      <ActiveSelectionProvider>
        <Navbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/items" element={<Items />} />
        
          <Route
            path="/items/new"
            element={<ProtectedRoute element={<ItemForm />}/>}
          />
          <Route
            path="/items/edit/:id"
            element={<ProtectedRoute element={<ItemForm />} />}
          />
          <Route
            path="/items/:id"
            element={<ProtectedRoute element={<ItemForm />} />}
          />
          <Route
            path="/projects"
            element={<ProtectedRoute element={<Projects />} />}
          />
          <Route
            path="/projects/:id"
            element={<ProtectedRoute element={<ShowProject />} />}
          />
          <Route
            path="/projects/edit/:id"
            element={<ProtectedRoute element={<ProjectForm />} />}
          />
          <Route
            path="/projects/new"
            element={<ProtectedRoute element={<ProjectForm />} />}
          />
          <Route
            path="/selections/:id"
            element={<ProtectedRoute element={<ShowSelection />} />}
          />
          <Route
            path="/team"
            element={<ProtectedRoute element={<TeamStatus />} />}
          />
        </Routes>
        <Footer />
        </ActiveSelectionProvider>
      </AuthProvider>
    </div>
  );
}

export default App;
