import logo from '../assets/LogoBlack.png';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../CSS/Home.css';

function Home() {
  const { user } = useAuth();
  const username = user?.displayName || user?.email?.split('@')[0];

  return (
    <main className="home">
      <video
        className="home-background-video"
        autoPlay
        muted
        loop
        playsInline
        aria-hidden="true"
      >
        <source src="/home_Back.mp4" type="video/mp4" />
      </video>
      <div className="home-overlay"></div>
      <section className="home-content">
        <img src={logo} alt="Adimari" className="home-logo" />
        {user && <p className="home-welcome">Welcome<br /><strong>{username}</strong></p>}
        {!user && <Link to="/signup" className="home-signin">Sign in</Link>}
      </section>
    </main>
  );
}

export default Home;
