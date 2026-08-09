import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../CSS/Footer.css';

const Footer = () => {
  const { user, logout } = useAuth();
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="footer-container">
        <section className="footer-brand" aria-label="Adimari">
          <Link to="/" className="footer-logo">Adimari</Link>
          <p>A shared workspace for product data, projects, and licenses.</p>
        </section>

        <nav className="footer-nav" aria-label="Footer navigation">
          <div className="footer-nav-group">
            <span className="footer-nav-title">Explore</span>
            <Link to="/">Home</Link>
            <Link to="/projects">Projects</Link>
          </div>
          <div className="footer-nav-group">
            <span className="footer-nav-title">Workspace</span>
            <Link to="/projects">Projects</Link>
            <Link to="/team">Team</Link>
            <Link to="/licenses">Licenses</Link>
          </div>
        </nav>

        <section className="footer-account" aria-label="Account">
          <span className="footer-nav-title">Account</span>
          {user ? (
            <>
              <span className="footer-user-email">{user.email}</span>
              <button type="button" onClick={logout} className="footer-signout">Sign out</button>
            </>
          ) : (
            <>
              <p>Sign in to access your workspace.</p>
              <Link to="/signup" className="footer-signin">Sign in</Link>
            </>
          )}
        </section>
      </div>

      <div className="footer-bottom">
        <div>© {year} Adimari</div>
        <div>Design library &amp; project workspace</div>
      </div>
    </footer>
  );
};

export default Footer;
