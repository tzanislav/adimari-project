// ProtectedRoute.js
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ element, ...rest }) => {
  const { user, loading, role } = useAuth();

  var roleLevel = 0;

  switch (role) {
    case 'admin':
        roleLevel = 3;
        break;
    case 'moderator':
        roleLevel = 2;
        break;
    case 'regular':
        roleLevel = 1;
        break;
    default:
        roleLevel = 0;
}

  if (loading) {
    return <div>Loading...</div>; // Show a loading state while checking authentication
  }

  // If the user is not authenticated, redirect to the home or login page
  if (!user || roleLevel < 2) {
    return <Navigate to="/" replace />;
  }

  // If authenticated, render the component
  return element;
};

export default ProtectedRoute;
