import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import LicenseForm from '../components/LicenseEntryForm';
import LicenseEntry from '../components/LicenseEntry';
import '../CSS/LicenseEntry.css';

function Licenses() {
  const { user, role } = useAuth();
  const [licenses, setLicenses] = useState(null);
  const [search, setSearch] = useState('');
  const [currentLicense, setCurrentLicense] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user || (role !== 'admin' && role !== 'moderator')) return;

    const fetchData = async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch(`${import.meta.env.VITE_SERVER_URL || ''}/api/licenses`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Failed to load licenses.');
        const data = await response.json();
        data.sort((a, b) => (a.platform || '').localeCompare(b.platform || ''));
        setLicenses(data);
        setError('');
      } catch (fetchError) {
        console.error('Error fetching licenses:', fetchError);
        setError('Licenses could not be loaded. Please try again.');
      }
    };

    void fetchData();
  }, [refreshKey, role, user]);

  if (!user || (role !== 'admin' && role !== 'moderator')) {
    window.location.href = '/signup';
    return null;
  }

  const query = search.trim().toLowerCase();
  const filteredLicenses = (licenses || []).filter((license) =>
    [license.platform, license.user, license.usedBy, license.comment]
      .some((value) => String(value || '').toLowerCase().includes(query))
  );
  const platformGroups = filteredLicenses.reduce((groups, license) => {
    const platform = license.platform || 'Other';
    const previous = groups[groups.length - 1];
    if (previous?.platform === platform) previous.entries.push(license);
    else groups.push({ platform, entries: [license] });
    return groups;
  }, []);
  const openEdit = (entry) => { setCurrentLicense(entry); setShowEdit(true); };

  return (
    <main className="licenses">
      <header className="license-header">
        <div>
          <h1>Licenses</h1>
          <p>Usernames and passwords</p>
        </div>
        <button type="button" className="license-add-button" onClick={() => { setCurrentLicense(null); setShowEdit(true); }}>
          Add new entry
        </button>
      </header>

      <section className="license-container" aria-label="License entries">
        <div className="license-toolbar">
          <label className="license-search">
            <span className="visually-hidden">Search licenses</span>
            <input
              type="search"
              value={search}
              placeholder="Search platform, username, used by or comment"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {licenses && <span className="license-count">{filteredLicenses.length} {filteredLicenses.length === 1 ? 'entry' : 'entries'}</span>}
        </div>

        {error && <p className="license-message" role="alert">{error}</p>}
        {!licenses && !error && <p className="license-message">Loading licenses…</p>}
        {licenses && filteredLicenses.length === 0 && (
          <p className="license-message">{search ? 'No licenses match your search.' : 'No licenses yet.'}</p>
        )}
        {licenses && filteredLicenses.length > 0 && (
          <div className="license-table-scroll">
            <table className="license-table">
              <thead>
                <tr>
                  <th scope="col">Username</th>
                  <th scope="col" className="license-password-heading">Password</th>
                  <th scope="col">Used by</th>
                  <th scope="col">Price</th>
                  <th scope="col">Comment</th>
                  <th scope="col">Expires</th>
                </tr>
              </thead>
              {platformGroups.map((group) => (
                <tbody key={group.platform}>
                  <tr className="license-platform-row">
                    <th scope="rowgroup" colSpan="2">{group.platform}<span>{group.entries.length}</span></th>
                    <th colSpan="4" aria-hidden="true" />
                  </tr>
                  {group.entries.map((license) => (
                    <LicenseEntry key={license._id} entry={license} handleEdit={openEdit} />
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </section>

      {showEdit && (
        <div className="license-modal-backdrop">
          <LicenseForm
            id={currentLicense?._id}
            handleClose={() => setShowEdit(false)}
            handleRefresh={() => setRefreshKey((key) => key + 1)}
          />
        </div>
      )}
    </main>
  );
}

export default Licenses;
