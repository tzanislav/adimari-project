// ProtectedRoute.js
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ element, ...rest }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>; // Show a loading state while checking authentication
  }

  // If the user is not authenticated, redirect to the home or login page
  if (!user) {
    return <Navigate to="/" replace />;
  }

  // If authenticated, render the component
  return element;
};

export default ProtectedRoute;
