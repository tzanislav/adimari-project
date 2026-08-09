import { useState } from 'react';
import { useActiveSelection } from '../context/selectionContext';
import { useAuth } from '../context/AuthContext';
import { Link, NavLink } from 'react-router-dom';
import '../CSS/Navbar.css';

function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { activeSelection, clearActiveSelection } = useActiveSelection();
  const { user, logout, role } = useAuth();

  const toggleMenu = () => setIsMenuOpen((isOpen) => !isOpen);
  const closeMenu = () => setIsMenuOpen(false);
  const navigationItems = [
    { to: '/', label: 'Home' },
    { to: '/projects', label: 'Projects' },
    { to: '/team', label: 'Team' },
    { to: '/licenses', label: 'Licenses' },
  ];

  return (
    <nav className="navbar">
      <div className="navbar-top">
        <div className="navbar-container">
          <Link to="/" className="navbar-logo" onClick={closeMenu}>Adimari Database</Link>
          <button
            className="navbar-toggle"
            onClick={toggleMenu}
            aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={isMenuOpen}
            aria-controls="primary-navigation"
          >
            <span></span><span></span><span></span>
          </button>
          <ul id="primary-navigation" className={`navbar-links ${isMenuOpen ? 'open' : ''}`}>
            {navigationItems.map(({ to, label }) => (
              <li key={to}>
                <NavLink to={to} end={to === '/'} onClick={closeMenu}>
                  {label}
                </NavLink>
              </li>
            ))}
            {user ? (
              <li className="navbar-auth-mobile">
                <Link to="/signup" className="auth-link" onClick={closeMenu}>{user.email}</Link>
                <span className="user-role">{role}</span>
                <button onClick={logout} className="logout-button">Sign out</button>
              </li>
            ) : (
              <li className="navbar-auth-mobile"><Link to="/signup" className="auth-link" onClick={closeMenu}>Sign in</Link></li>
            )}
          </ul>
          <div className="navbar-auth">
            {user ? (
              <>
                <Link to="/signup" className="auth-link">{user.email}</Link>
                <span className="user-role">{role}</span>
                <button onClick={logout} className="logout-button">Sign out</button>
              </>
            ) : (
              <Link to="/signup" className="auth-link">Sign in</Link>
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
