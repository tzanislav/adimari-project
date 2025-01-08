import React from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/LogoBlack.png';
import '../CSS/Home.css';

function Home() {
  return (
    <div className="home">
      <img src={logo} alt="Adimari Logo" />
      <h1>Welcome to the Adimari Database!</h1>
    </div>
  );
}

export default Home;
