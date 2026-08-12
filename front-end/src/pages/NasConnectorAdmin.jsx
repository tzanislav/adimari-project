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

const describeIndexJob = (job) => {
  if (!job) return 'No index scan requested yet.';

  switch (job.status) {
    case 'queued':
      return 'Queued — waiting for the connector control channel.';
    case 'assigned':
      return 'Sent to connector — waiting for it to accept the scan.';
    case 'accepted':
      return 'Accepted by connector — preparing to scan.';
    case 'in_progress':
      return job.progressBytes > 0
        ? `Scanning — ${job.progressBytes.toLocaleString()} entries indexed so far.`
        : 'Scanning — reading the NAS root.';
    case 'completed':
      return `Completed — ${job.progressBytes.toLocaleString()} entries indexed.`;
    case 'failed':
    case 'retryable_failure':
    case 'cancelled':
    case 'conflict':
      return `Scan stopped (${job.status.replace('_', ' ')}).`;
    default:
      return `Scan status: ${job.status || 'unknown'}.`;
  }
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
  const [queueingIndexConnectorId, setQueueingIndexConnectorId] = useState(null);
  const [cancellingIndexConnectorId, setCancellingIndexConnectorId] = useState(null);
  const [testingConnectorId, setTestingConnectorId] = useState(null);
  const [indexJobsByConnector, setIndexJobsByConnector] = useState({});
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

  const loadIndexJobs = useCallback(async (connectorIds) => {
    const results = await Promise.all(connectorIds.map(async (connectorId) => {
      try {
        const data = await apiRequest(`/${encodeURIComponent(connectorId)}/jobs`);
        const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
        return [connectorId, jobs.find((job) => job.type === 'index_root') || null];
      } catch {
        // Connector listing must remain useful if a single job-status request
        // is temporarily unavailable.
        return [connectorId, null];
      }
    }));

    setIndexJobsByConnector(Object.fromEntries(results));
  }, []);

  useEffect(() => {
    const connectorIds = connectors.map((connector) => connector.id).filter(Boolean);
    if (connectorIds.length === 0) {
      setIndexJobsByConnector({});
      return undefined;
    }

    const refresh = () => { void loadIndexJobs(connectorIds); };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [connectors, loadIndexJobs]);

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

  const queueIndexScan = async (connector) => {
    const traceId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setQueueingIndexConnectorId(connector.id);
    setError('');
    setNotice('Queue index scan requested — checking the connector root. Open the browser console for step-by-step diagnostics.');
    console.info('[NAS index]', {
      traceId,
      step: 'web_button_clicked',
      connectorId: connector.id,
      connectorName: connector.name,
    });

    try {
      console.info('[NAS index]', { traceId, step: 'loading_roots' });
      const rootsResponse = await fetchWithAuth(`${apiBase}/${encodeURIComponent(connector.id)}/roots`);
      const rootsData = await rootsResponse.json().catch(() => null);
      console.info('[NAS index]', {
        traceId,
        step: 'roots_response',
        status: rootsResponse.status,
        rootCount: Array.isArray(rootsData?.roots) ? rootsData.roots.length : null,
      });
      if (!rootsResponse.ok) {
        throw new NasConnectorApiError(rootsData?.error || 'Could not load the connector root.', {
          status: rootsResponse.status,
          data: rootsData,
        });
      }

      const roots = Array.isArray(rootsData?.roots) ? rootsData.roots : [];
      if (roots.length !== 1) {
        throw new Error('This connector has no single active root to scan. Refresh the connector setup, then try again.');
      }

      const root = roots[0];
      console.info('[NAS index]', {
        traceId,
        step: 'queue_request_started',
        connectorId: connector.id,
        connectorRootId: root.connectorRootId,
      });
      const queued = await apiRequest(`/${encodeURIComponent(connector.id)}/roots/${encodeURIComponent(root.connectorRootId)}/index-jobs`, {
        method: 'POST',
        body: {},
      });
      console.info('[NAS index]', {
        traceId,
        step: 'queue_response',
        created: queued?.created,
        jobId: queued?.job?.id,
        jobStatus: queued?.job?.status,
        attempts: queued?.job?.attemptCount,
      });
      if (queued?.job) {
        setIndexJobsByConnector((current) => ({ ...current, [connector.id]: queued.job }));
      }
      setNotice(queued?.created
        ? `Index scan queued for “${root.name}”. ${describeIndexJob(queued.job)}`
        : `An index scan for “${root.name}” already exists. ${describeIndexJob(queued.job)}`);
      await loadConnectors({ showLoading: false });
    } catch (requestError) {
      console.error('[NAS index]', {
        traceId,
        step: 'queue_failed',
        message: describeError(requestError),
      });
      setError(describeError(requestError));
    } finally {
      setQueueingIndexConnectorId(null);
    }
  };

  const cancelIndexScan = async (connector) => {
    const job = indexJobsByConnector[connector.id];
    if (!job) return;

    const confirmed = window.confirm(
      'Cancel this queued scan? It has not been accepted by the connector, and you can immediately queue a fresh scan afterwards.',
    );
    if (!confirmed) return;

    setCancellingIndexConnectorId(connector.id);
    setError('');
    setNotice('');
    try {
      const cancelled = await apiRequest(`/${encodeURIComponent(connector.id)}/jobs/${encodeURIComponent(job.id)}/cancel`, {
        method: 'POST',
        body: {},
      });
      if (cancelled?.job) {
        setIndexJobsByConnector((current) => ({ ...current, [connector.id]: cancelled.job }));
      }
      setNotice('The stale queued scan was cancelled. You can now queue a fresh scan.');
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      setCancellingIndexConnectorId(null);
    }
  };

  const sendConnectorTest = async (connector) => {
    setTestingConnectorId(connector.id);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/${encodeURIComponent(connector.id)}/test-message`, {
        method: 'POST',
        body: {},
      });
      setNotice('Test message sent. The Connector Control Center should show its receipt within one second.');
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      setTestingConnectorId(null);
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
                  <th scope="col">Index scan</th>
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
                  const isQueueingIndex = queueingIndexConnectorId === connector.id;
                  const isCancellingIndex = cancellingIndexConnectorId === connector.id;
                  const isTesting = testingConnectorId === connector.id;
                  const canQueueIndex = connector.status === 'active' || connector.status === 'offline';
                  const indexJob = indexJobsByConnector[connector.id];
                  const canCancelIndex = indexJob && ['queued', 'assigned'].includes(indexJob.status);
                  return (
                    <tr key={connector.id}>
                      <td data-label="Name">
                        <strong>{connector.name}</strong>
                        <span className="nas-connector-installation-id">{connector.installationId}</span>
                      </td>
                      <td data-label="Status"><span className={`nas-connector-status ${connector.status || 'unknown'}`}>{connector.status || 'unknown'}</span></td>
                      <td data-label="Index scan">
                        <span className={`nas-connector-index-status ${indexJob?.status || 'none'}`}>{describeIndexJob(indexJob)}</span>
                        {indexJob && <span className="nas-connector-index-updated">Updated {formatDate(indexJob.progressUpdatedAt || indexJob.completedAt || indexJob.updatedAt || indexJob.createdAt)}</span>}
                      </td>
                      <td data-label="Version">{connector.agentVersion || '—'}</td>
                      <td data-label="Last seen">{formatDate(connector.lastSeenAt)}</td>
                      <td data-label="Enrolled">{formatDate(connector.createdAt)}</td>
                      <td className="nas-connector-actions" data-label="Actions">
                        <div className="nas-connector-action-buttons">
                          {connector.status === 'active' && (
                            <button className="nas-connector-button compact" type="button" onClick={() => void sendConnectorTest(connector)} disabled={isTesting}>
                              {isTesting ? 'Sending test…' : 'Send connector test'}
                            </button>
                          )}
                          {canQueueIndex && (
                            <button className="nas-connector-button primary compact" type="button" onClick={() => void queueIndexScan(connector)} disabled={isQueueingIndex}>
                              {isQueueingIndex ? 'Queueing scan…' : 'Queue index scan'}
                            </button>
                          )}
                          {canCancelIndex && (
                            <button className="nas-connector-button danger compact" type="button" onClick={() => void cancelIndexScan(connector)} disabled={isCancellingIndex}>
                              {isCancellingIndex ? 'Cancelling scan…' : 'Cancel queued scan'}
                            </button>
                          )}
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
