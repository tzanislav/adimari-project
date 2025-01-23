import React, { useState } from 'react';
import { useActiveSelection } from '../context/selectionContext';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import '../CSS/Navbar.css';

function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { activeSelection, clearActiveSelection } = useActiveSelection();
  const { user, logout, role } = useAuth();

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  return (
    <nav className="navbar">
      <div className="navbar-top">
        <div className="navbar-container">
          <Link to="/" className="navbar-logo">Adimari</Link>
          <button className="navbar-toggle" onClick={toggleMenu} aria-label="Toggle menu">☰</button>
          <ul  onClick={toggleMenu} className={`navbar-links ${isMenuOpen ? 'open' : ''}` }>
            <li><Link to="/">Home</Link></li>
            <li><Link to="/items">Items</Link></li>
            {user && <li><Link to="/projects">Projects</Link></li>}
            {(user && isMenuOpen) ? (
              <div className="navbar-auth-mobile">
                <Link to="/signup" className="auth-link">{user.email}</Link>
                <span className="user-email auth-link">{role}</span>
                <button onClick={logout} className="logout-button">Sign out</button>
              </div>
            ) : (
              <Link to="/signup" className="auth-link">Sign In</Link>
            )}
          </ul>
          <div className="navbar-auth">
            {user ? (
              <>
                <Link to="/signup" className="auth-link">{user.email}</Link>
                <span className="user-email auth-link">{role}</span>
                <button onClick={logout} className="logout-button">Sign out</button>
              </>
            ) : (
              <Link to="/signup" className="auth-link">Sign In</Link>
            )}
          </div>
        </div>
      </div>
      {activeSelection && (
        <div className="selection-bar">
          <span>Active Selection:</span>
          <Link to={`/selections/${activeSelection._id}`} className="selection-link">{activeSelection.name}</Link>
          <button onClick={clearActiveSelection} className="selection-clear">Clear</button>
        </div>
      )}
    </nav>
  );
}

export default Navbar;
