// ProtectedRoute.js
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ element }) => {
  const { user, loading, role } = useAuth();
  const location = useLocation();

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

  // Send guests to sign-in and retain the requested location for the sign-in flow.
  if (!user) {
    return <Navigate to="/signup" replace state={{ from: location }} />;
  }

  // Signed-in users still need the required role for protected workspace pages.
  if (roleLevel < 2) {
    return <Navigate to="/" replace />;
  }

  // If authenticated, render the component
  return element;
};

export default ProtectedRoute;
