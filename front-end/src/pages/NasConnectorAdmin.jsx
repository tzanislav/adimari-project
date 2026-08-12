import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '../utils/authHeaders';
import '../CSS/NasConnectorAdmin.css';

const serverUrl = import.meta.env.VITE_SERVER_URL || '';
const apiBase = `${serverUrl}/api/nas-connectors`;

class NasConnectorApiError extends Error {
  constructor(message, { status, data } = {}) {
    super(message);
    this.name = 'NasConnectorApiError';
    this.status = status;
    this.data = data;
  }
}

const apiRequest = async (path, { method = 'GET', body } = {}) => {
  const response = await fetchWithAuth(`${apiBase}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const responseText = await response.text();
  let data = null;
  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new NasConnectorApiError(data?.error || 'The NAS connector request failed.', {
      status: response.status,
      data,
    });
  }

  return data;
};

const formatDate = (value) => {
  if (!value) return 'Never';

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
};

const describeError = (error) => {
  if (error instanceof NasConnectorApiError && error.status === 404) {
    return 'The NAS connector API is unavailable. Check that it is enabled on the server.';
  }

  return error instanceof Error ? error.message : 'The NAS connector request failed.';
};

function NasConnectorAdmin() {
  const [connectors, setConnectors] = useState([]);
  const [connectorName, setConnectorName] = useState('');
  const [issuedEnrollment, setIssuedEnrollment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creatingEnrollment, setCreatingEnrollment] = useState(false);
  const [creatingReEnrollmentId, setCreatingReEnrollmentId] = useState(null);
  const [revokingId, setRevokingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadConnectors = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) setLoading(true);
    setError('');

    try {
      const data = await apiRequest('');
      setConnectors(Array.isArray(data?.connectors) ? data.connectors : []);
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  const createEnrollment = async (event) => {
    event.preventDefault();
    const name = connectorName.trim();
    if (!name) {
      setError('Enter a name for this connector before creating an enrollment token.');
      return;
    }

    setCreatingEnrollment(true);
    setError('');
    setNotice('');
    setIssuedEnrollment(null);

    try {
      const data = await apiRequest('/enrollment-tokens', {
        method: 'POST',
        body: { name },
      });
      setIssuedEnrollment({
        token: data?.enrollmentToken || '',
        name: data?.enrollment?.name || name,
        expiresAt: data?.enrollment?.expiresAt || null,
        purpose: 'enrollment',
      });
      setConnectorName('');
      setNotice('Enrollment token created. Copy it now; it cannot be shown again.');
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      setCreatingEnrollment(false);
    }
  };

  const copyEnrollmentToken = async () => {
    if (!issuedEnrollment?.token) return;

    try {
      await navigator.clipboard.writeText(issuedEnrollment.token);
      setNotice('Enrollment token copied. It remains visible only until you clear or leave this page.');
    } catch {
      setError('Could not copy the token automatically. Select and copy it manually before leaving this page.');
    }
  };

  const createReEnrollment = async (connector) => {
    const confirmed = window.confirm(
      `Create a re-enrollment token for "${connector.name}"? When the matching installation redeems it, its credential is rotated and it can restore a revoked or offline connector.`,
    );
    if (!confirmed) return;

    setCreatingReEnrollmentId(connector.id);
    setError('');
    setNotice('');
    setIssuedEnrollment(null);

    try {
      const data = await apiRequest(`/${encodeURIComponent(connector.id)}/re-enrollment-tokens`, {
        method: 'POST',
      });
      setIssuedEnrollment({
        token: data?.enrollmentToken || '',
        name: data?.enrollment?.name || connector.name,
        expiresAt: data?.enrollment?.expiresAt || null,
        purpose: 're-enrollment',
      });
      setNotice('Re-enrollment token created. Copy it now; it cannot be shown again.');
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      setCreatingReEnrollmentId(null);
    }
  };

  const revokeConnector = async (connector) => {
    const confirmed = window.confirm(
      `Revoke “${connector.name}”? The connector will immediately lose access and must be enrolled again to reconnect.`,
    );
    if (!confirmed) return;

    setRevokingId(connector.id);
    setError('');
    setNotice('');

    try {
      const data = await apiRequest(`/${encodeURIComponent(connector.id)}/revoke`, {
        method: 'POST',
        body: {},
      });
      const revokedConnector = data?.connector;
      setConnectors((current) => current.map((entry) => (
        entry.id === connector.id ? (revokedConnector || { ...entry, status: 'revoked' }) : entry
      )));
      setNotice(`“${connector.name}” has been revoked.`);
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <main className="nas-connector-admin-page">
      <header className="nas-connector-admin-header">
        <div>
          <p className="nas-connector-admin-eyebrow">Administration</p>
          <h1>NAS Connectors</h1>
          <p>Enroll and monitor Windows connector installations that provide access to NAS-backed files.</p>
        </div>
        <button className="nas-connector-button" type="button" onClick={() => void loadConnectors()} disabled={loading}>
          Refresh
        </button>
      </header>

      <section className="nas-connector-enrollment" aria-labelledby="nas-enrollment-title">
        <div>
          <h2 id="nas-enrollment-title">Create enrollment token</h2>
          <p>Give the token a recognisable connector name, then enter it in the local Connector Control Center. The token can be redeemed once.</p>
        </div>
        <form onSubmit={createEnrollment} className="nas-connector-enrollment-form">
          <label htmlFor="nas-connector-name">
            Connector name
            <input
              id="nas-connector-name"
              value={connectorName}
              onChange={(event) => setConnectorName(event.target.value)}
              maxLength="120"
              placeholder="Office NAS connector"
              autoComplete="off"
              disabled={creatingEnrollment}
            />
          </label>
          <button className="nas-connector-button primary" type="submit" disabled={creatingEnrollment}>
            {creatingEnrollment ? 'Creating…' : 'Create token'}
          </button>
        </form>

        {issuedEnrollment?.token && (
          <section className="nas-connector-token" aria-labelledby="nas-token-title">
            <div>
              <h3 id="nas-token-title">Copy this {issuedEnrollment.purpose === 're-enrollment' ? 're-enrollment ' : ''}token now</h3>
              {issuedEnrollment.purpose === 're-enrollment' ? (
                <p>
                  For <strong>{issuedEnrollment.name}</strong>. When redeemed by the matching installation, it rotates that connector&apos;s credential and can restore it from offline or revoked status. It expires {formatDate(issuedEnrollment.expiresAt)} and cannot be retrieved again after you leave or clear this page.
                </p>
              ) : (
                <p>
                  For <strong>{issuedEnrollment.name}</strong>. It expires {formatDate(issuedEnrollment.expiresAt)} and cannot be retrieved again after you leave or clear this page.
                </p>
              )}
            </div>
            <label>
              One-time enrollment token
              <input value={issuedEnrollment.token} readOnly aria-describedby="nas-token-title" autoComplete="off" />
            </label>
            <div className="nas-connector-token-actions">
              <button className="nas-connector-button primary" type="button" onClick={() => void copyEnrollmentToken()}>Copy token</button>
              <button className="nas-connector-button ghost" type="button" onClick={() => setIssuedEnrollment(null)}>Clear from screen</button>
            </div>
          </section>
        )}
      </section>

      {error && <p className="nas-connector-message error" role="alert">{error}</p>}
      {notice && <p className="nas-connector-message success" role="status">{notice}</p>}

      <section className="nas-connector-list-section" aria-labelledby="nas-connectors-title">
        <div className="nas-connector-list-heading">
          <div>
            <h2 id="nas-connectors-title">Connector installations</h2>
            <p>Revoking a connector disables its roots and invalidates its device credential.</p>
          </div>
          <span>{connectors.length} total</span>
        </div>

        {loading ? (
          <p className="nas-connector-empty">Loading connector installations…</p>
        ) : connectors.length === 0 ? (
          <p className="nas-connector-empty">No connectors have been enrolled yet.</p>
        ) : (
          <div className="nas-connector-table-wrap">
            <table className="nas-connector-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Status</th>
                  <th scope="col">Version</th>
                  <th scope="col">Last seen</th>
                  <th scope="col">Enrolled</th>
                  <th scope="col"><span className="nas-connector-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {connectors.map((connector) => {
                  const isRevoked = connector.status === 'revoked';
                  const isRevoking = revokingId === connector.id;
                  const isCreatingReEnrollment = creatingReEnrollmentId === connector.id;
                  return (
                    <tr key={connector.id}>
                      <td data-label="Name">
                        <strong>{connector.name}</strong>
                        <span className="nas-connector-installation-id">{connector.installationId}</span>
                      </td>
                      <td data-label="Status"><span className={`nas-connector-status ${connector.status || 'unknown'}`}>{connector.status || 'unknown'}</span></td>
                      <td data-label="Version">{connector.agentVersion || '—'}</td>
                      <td data-label="Last seen">{formatDate(connector.lastSeenAt)}</td>
                      <td data-label="Enrolled">{formatDate(connector.createdAt)}</td>
                      <td className="nas-connector-actions" data-label="Actions">
                        <div className="nas-connector-action-buttons">
                          <button className="nas-connector-button compact" type="button" onClick={() => void createReEnrollment(connector)} disabled={isCreatingReEnrollment}>
                            {isCreatingReEnrollment ? 'Creating…' : 'Create re-enrollment token'}
                          </button>
                          {isRevoked ? (
                            <span className="nas-connector-revoked-note">Revoked {formatDate(connector.revokedAt)}</span>
                          ) : (
                            <button className="nas-connector-button danger compact" type="button" onClick={() => void revokeConnector(connector)} disabled={isRevoking}>
                              {isRevoking ? 'Revoking…' : 'Revoke'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default NasConnectorAdmin;
