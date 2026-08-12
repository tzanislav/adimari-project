// ProtectedRoute.js
/* eslint-disable react/prop-types */
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ element, requiredRole = 'moderator' }) => {
  const { user, loading, role } = useAuth();
  const location = useLocation();

  const roleLevels = {
    regular: 1,
    moderator: 2,
    admin: 3,
  };
  const roleLevel = roleLevels[role] || 0;
  const requiredRoleLevel = roleLevels[requiredRole] || roleLevels.moderator;

  if (loading) {
    return <div>Loading...</div>; // Show a loading state while checking authentication
  }

  // Send guests to sign-in and retain the requested location for the sign-in flow.
  if (!user) {
    return <Navigate to="/signup" replace state={{ from: location }} />;
  }

  // Signed-in users still need the required role for protected workspace pages.
  if (roleLevel < requiredRoleLevel) {
    return <Navigate to="/" replace />;
  }

  // If authenticated, render the component
  return element;
};

export default ProtectedRoute;
