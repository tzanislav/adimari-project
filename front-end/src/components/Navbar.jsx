import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import '../CSS/Navbar.css'; // Import CSS

function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-logo">
          Adimari
        </Link>
        <button className="navbar-toggle" onClick={toggleMenu}>
          ☰
        </button>
        <ul className={`navbar-links ${isOpen ? 'active' : ''}`}>
          <li><Link to="/">Home</Link></li>
          <li><Link to="/brands">Brands</Link></li>
          <li><Link to="/models3d">3D Models</Link></li>
        </ul>
      </div>
    </nav>
  );
}

export default Navbar;
