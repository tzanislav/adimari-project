import React, { useState, useEffect } from 'react';
import { useActiveSelection } from "../components/selectionContext";

import { Link } from 'react-router-dom';
import '../CSS/Navbar.css'; // Import CSS

function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };
  const { activeSelection , clearActiveSelection } = useActiveSelection();




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
            <li><Link to="/items">Items</Link></li>
            <li><Link to="/projects">Projects</Link></li>
          </ul>
        </div>
      </div>
      <div className='selection-bar' style={{ top: activeSelection ? '0px' : '-200px' }}>
        {!activeSelection ? <h3>No active selection</h3> :
          <>
            <button onClick={() => clearActiveSelection()} className='active-selection-button'>Clear</button>
            
            <Link to={`/selections/${activeSelection._id}`} className='active-selection-button-bigger'>{activeSelection.name}</Link>
          </>
        }
      </div>
    </nav>
  );
}

export default Navbar;
