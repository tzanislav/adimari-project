import React, { useState, useEffect } from 'react';
import { useActiveSelection } from "../components/selectionContext";

import { Link } from 'react-router-dom';
import '../CSS/Navbar.css'; // Import CSS

function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };
  const { activeSelection } = useActiveSelection();
  const { clearActiveSelection } = useActiveSelection();



  return (
    <nav className="navbar">
      <div className='navbar-top'>
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
            <li><Link to="/projects">Projects</Link></li>
          </ul>
        </div>
      </div>
      <div className='selection-bar' style={{ top: activeSelection ? '0' : '-100px' }}>
        {!activeSelection ? <h3>No active selection</h3> :
          <>
            <h3>{activeSelection[1]}</h3>
            <h2>{activeSelection[0]}</h2>
          </>
        }
        <button onClick={() => clearActiveSelection()} className='active-selection-button'>Clear</button>
      </div>
    </nav>
  );
}

export default Navbar;
