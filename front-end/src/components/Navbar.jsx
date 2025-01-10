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
            <Link to={`/projects/${activeSelection[3]}`} className='active-selection-button-smaller'>{activeSelection[1]}</Link>
            <Link to={`/selections/${activeSelection[2]}`} className='active-selection-button-bigger'>{activeSelection[0]}</Link>
          </>
        }
        <button onClick={() => clearActiveSelection()} className='active-selection-button'>Clear</button>
      </div>
    </nav>
  );
}

export default Navbar;
