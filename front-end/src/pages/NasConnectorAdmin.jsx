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

const ACTIVE_JOB_STATUSES = new Set(['queued', 'assigned', 'accepted', 'in_progress']);

const describeThumbnailJob = (job) => {
  switch (job.status) {
    case 'queued':
      return 'Queued — waiting for the connector.';
    case 'assigned':
      return 'Sent to connector — awaiting receipt.';
    case 'accepted':
      return 'Accepted by connector — waiting to start.';
    case 'in_progress':
      return job.progressStage === 'uploading_thumbnail'
        ? 'Uploading generated thumbnail.'
        : 'Generating thumbnail.';
    default:
      return `Thumbnail status: ${job.status || 'unknown'}.`;
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
  const [loading, setLoading] = useState(true);
  const [queueingIndexConnectorId, setQueueingIndexConnectorId] = useState(null);
  const [cancellingJobId, setCancellingJobId] = useState(null);
  const [testingConnectorId, setTestingConnectorId] = useState(null);
  const [jobsByConnector, setJobsByConnector] = useState({});
  const [recoveryJobs, setRecoveryJobs] = useState([]);
  const [recoveryLoading, setRecoveryLoading] = useState(true);
  const [recoveryError, setRecoveryError] = useState('');
  const [rateLimitExemptions, setRateLimitExemptions] = useState([]);
  const [rateLimitExemptionsLoading, setRateLimitExemptionsLoading] = useState(true);
  const [exemptIpAddress, setExemptIpAddress] = useState('');
  const [savingExemptIp, setSavingExemptIp] = useState(false);
  const [deletingExemptIpId, setDeletingExemptIpId] = useState(null);
  const [stoppingRecoveryJobId, setStoppingRecoveryJobId] = useState(null);
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

  const loadRecoveryJobs = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) setRecoveryLoading(true);
    setRecoveryError('');

    try {
      const data = await apiRequest('/recovery/jobs');
      setRecoveryJobs(Array.isArray(data?.jobs) ? data.jobs : []);
    } catch (requestError) {
      setRecoveryError(describeError(requestError));
    } finally {
      if (showLoading) setRecoveryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecoveryJobs();
  }, [loadRecoveryJobs]);

  const loadRateLimitExemptions = useCallback(async () => {
    setRateLimitExemptionsLoading(true);
    try {
      const data = await apiRequest('/rate-limit-exemptions');
      setRateLimitExemptions(Array.isArray(data?.exemptions) ? data.exemptions : []);
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      setRateLimitExemptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRateLimitExemptions();
  }, [loadRateLimitExemptions]);

  const addRateLimitExemption = async (event) => {
    event.preventDefault();
    const ipAddress = exemptIpAddress.trim();
    if (!ipAddress) return;
    setSavingExemptIp(true);
    setError('');
    setNotice('');
    try {
      await apiRequest('/rate-limit-exemptions', { method: 'POST', body: { ipAddress } });
      setExemptIpAddress('');
      setNotice(`${ipAddress} is now exempt from the NAS catalogue rate limit.`);
      await loadRateLimitExemptions();
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      setSavingExemptIp(false);
    }
  };

  const removeRateLimitExemption = async (exemption) => {
    setDeletingExemptIpId(exemption.id);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/rate-limit-exemptions/${encodeURIComponent(exemption.id)}`, { method: 'DELETE' });
      setNotice(`${exemption.ipAddress} is subject to the NAS catalogue rate limit again.`);
      await loadRateLimitExemptions();
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      setDeletingExemptIpId(null);
    }
  };

  const loadConnectorJobs = useCallback(async (connectorIds) => {
    const results = await Promise.all(connectorIds.map(async (connectorId) => {
      try {
        const data = await apiRequest(`/${encodeURIComponent(connectorId)}/jobs`);
        const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
        return [connectorId, jobs];
      } catch {
        // Connector listing must remain useful if a single job-status request
        // is temporarily unavailable.
        return [connectorId, []];
      }
    }));

    setJobsByConnector(Object.fromEntries(results));
  }, []);

  useEffect(() => {
    const connectorIds = connectors.map((connector) => connector.id).filter(Boolean);
    if (connectorIds.length === 0) {
      setJobsByConnector({});
      return undefined;
    }

    const refresh = () => { void loadConnectorJobs(connectorIds); };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [connectors, loadConnectorJobs]);

  const revokeConnector = async (connector) => {
    const confirmed = window.confirm(
      `Disable “${connector.name}”? The connector will immediately lose access.`,
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
      setNotice(`“${connector.name}” has been disabled.`);
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      setRevokingId(null);
    }
  };

  const enableConnector = async (connector) => {
    setRevokingId(connector.id);
    setError('');
    setNotice('');

    try {
      const data = await apiRequest(`/${encodeURIComponent(connector.id)}/enable`, {
        method: 'POST',
        body: {},
      });
      const enabledConnector = data?.connector;
      setConnectors((current) => current.map((entry) => (
        entry.id === connector.id ? (enabledConnector || { ...entry, status: 'offline' }) : entry
      )));
      setNotice(`${connector.name} is enabled. It will return to active after the next connector heartbeat.`);
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
        setJobsByConnector((current) => ({
          ...current,
          [connector.id]: [queued.job, ...(current[connector.id] || []).filter((job) => job.id !== queued.job.id)],
        }));
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

  const cancelJob = async (connector, job) => {
    if (!job?.id) return;

    const noun = job.type === 'generate_thumbnail' ? 'thumbnail job' : 'index scan';
    const confirmed = window.confirm(
      `Cancel this ${noun}? The connector will stop it at its next safe checkpoint.`,
    );
    if (!confirmed) return;

    setCancellingJobId(job.id);
    setError('');
    setNotice('');
    try {
      const cancelled = await apiRequest(`/${encodeURIComponent(connector.id)}/jobs/${encodeURIComponent(job.id)}/cancel`, {
        method: 'POST',
        body: {},
      });
      if (cancelled?.job) {
        setJobsByConnector((current) => ({
          ...current,
          [connector.id]: (current[connector.id] || []).map((entry) => (
            entry.id === cancelled.job.id ? cancelled.job : entry
          )),
        }));
      }
      setNotice(`The ${noun} was cancelled.`);
    } catch (requestError) {
      setError(describeError(requestError));
    } finally {
      setCancellingJobId(null);
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

  const stopRecoveryJob = async (job) => {
    if (!job?.id || !job?.connectorId) return;

    const confirmed = window.confirm(
      `Stop this stale ${job.type || 'connector'} job? This records it as failed and does not replay NAS work. You can request a new operation after reviewing the failure.`,
    );
    if (!confirmed) return;

    setStoppingRecoveryJobId(job.id);
    setError('');
    setNotice('');
    setRecoveryError('');
    try {
      await apiRequest(`/${encodeURIComponent(job.connectorId)}/jobs/${encodeURIComponent(job.id)}/recovery/stop`, {
        method: 'POST',
        body: {},
      });
      setRecoveryJobs((current) => current.filter((entry) => entry.id !== job.id));
      setNotice(`Stopped the stale ${job.type || 'connector'} job. It was not replayed.`);
      await loadConnectors({ showLoading: false });
    } catch (requestError) {
      setRecoveryError(describeError(requestError));
    } finally {
      setStoppingRecoveryJobId(null);
    }
  };

  return (
    <main className="nas-connector-admin-page">
      <header className="nas-connector-admin-header">
        <div>
          <p className="nas-connector-admin-eyebrow">Administration</p>
          <h1>NAS Connectors</h1>
          <p>Monitor Windows connector installations that provide access to NAS-backed files.</p>
        </div>
        <button className="nas-connector-button" type="button" onClick={() => { void loadConnectors(); void loadRecoveryJobs(); void loadRateLimitExemptions(); }} disabled={loading || recoveryLoading || rateLimitExemptionsLoading}>
          Refresh
        </button>
      </header>

      <section className="nas-connector-enrollment" aria-labelledby="nas-enrollment-title">
        <div>
          <h2 id="nas-enrollment-title">Connect a Windows connector</h2>
          <p>Set <code>NAS_CONNECTOR_SHARED_SECRET</code> on the server, then enter the same key in the local Connector Control Center. The connector creates or reconnects its own record automatically.</p>
        </div>
      </section>

      {error && <p className="nas-connector-message error" role="alert">{error}</p>}
      {notice && <p className="nas-connector-message success" role="status">{notice}</p>}

      <section className="nas-connector-list-section" aria-labelledby="nas-rate-limit-title">
        <div className="nas-connector-list-heading">
          <div>
            <h2 id="nas-rate-limit-title">NAS catalogue rate-limit exemptions</h2>
            <p>Exempt an exact client IP from the NAS catalogue request limit. This does not affect other API limits.</p>
          </div>
        </div>
        <form className="nas-connector-enrollment-form" onSubmit={(event) => void addRateLimitExemption(event)}>
          <label>
            IPv4 or IPv6 address
            <input value={exemptIpAddress} onChange={(event) => setExemptIpAddress(event.target.value)} placeholder="203.0.113.42" inputMode="text" />
          </label>
          <button className="nas-connector-button primary" type="submit" disabled={savingExemptIp || !exemptIpAddress.trim()}>
            {savingExemptIp ? 'Adding...' : 'Add exemption'}
          </button>
        </form>
        {rateLimitExemptionsLoading ? (
          <p className="nas-connector-empty">Loading exemptions...</p>
        ) : rateLimitExemptions.length === 0 ? (
          <p className="nas-connector-empty">No IP addresses are exempt.</p>
        ) : (
          <div className="nas-connector-rate-limit-list">
            {rateLimitExemptions.map((exemption) => (
              <div className="nas-connector-rate-limit-item" key={exemption.id}>
                <code>{exemption.ipAddress}</code>
                <button className="nas-connector-button danger compact" type="button" onClick={() => void removeRateLimitExemption(exemption)} disabled={deletingExemptIpId === exemption.id}>
                  {deletingExemptIpId === exemption.id ? 'Removing...' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="nas-connector-list-section nas-connector-recovery" aria-labelledby="nas-recovery-title">
        <div className="nas-connector-list-heading">
          <div>
            <h2 id="nas-recovery-title">Stale jobs</h2>
            <p>Only active jobs with no backend progress for the configured recovery interval appear here. Stopping one marks it failed; it never retries NAS work automatically.</p>
          </div>
          <button className="nas-connector-button compact" type="button" onClick={() => void loadRecoveryJobs()} disabled={recoveryLoading}>
            {recoveryLoading ? 'Checking...' : 'Check stale jobs'}
          </button>
        </div>

        {recoveryError && <p className="nas-connector-message error" role="alert">{recoveryError}</p>}
        {recoveryLoading ? (
          <p className="nas-connector-empty">Checking active jobs...</p>
        ) : recoveryJobs.length === 0 ? (
          <p className="nas-connector-empty">No stale active jobs were found.</p>
        ) : (
          <div className="nas-connector-table-wrap">
            <table className="nas-connector-table nas-connector-recovery-table">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">State</th>
                  <th scope="col">Last backend progress</th>
                  <th scope="col"><span className="nas-connector-visually-hidden">Recovery action</span></th>
                </tr>
              </thead>
              <tbody>
                {recoveryJobs.map((job) => {
                  const connector = connectors.find((entry) => entry.id === job.connectorId);
                  const isStopping = stoppingRecoveryJobId === job.id;
                  return (
                    <tr key={job.id}>
                      <td data-label="Job">
                        <strong>{(job.type || 'connector job').replaceAll('_', ' ')}</strong>
                        <span className="nas-connector-installation-id">{connector?.name || job.connectorId}</span>
                      </td>
                      <td data-label="State"><span className={`nas-connector-index-status ${job.status || 'unknown'}`}>{job.status || 'unknown'}</span></td>
                      <td data-label="Last backend progress">{formatDate(job.progressUpdatedAt || job.updatedAt || job.assignedAt || job.createdAt)}</td>
                      <td className="nas-connector-actions" data-label="Recovery action">
                        <button className="nas-connector-button danger compact" type="button" onClick={() => void stopRecoveryJob(job)} disabled={isStopping}>
                          {isStopping ? 'Stopping...' : 'Stop stale job'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="nas-connector-list-section" aria-labelledby="nas-connectors-title">
        <div className="nas-connector-list-heading">
          <div>
            <h2 id="nas-connectors-title">Connector installations</h2>
            <p>Each connector uses the shared server key and its locally generated installation ID.</p>
          </div>
          <span>{connectors.length} total</span>
        </div>

        {loading ? (
          <p className="nas-connector-empty">Loading connector installations…</p>
        ) : connectors.length === 0 ? (
          <p className="nas-connector-empty">No connectors have connected yet.</p>
        ) : (
          <div className="nas-connector-table-wrap">
            <table className="nas-connector-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Status</th>
                  <th scope="col">Index scan</th>
                  <th scope="col">Active thumbnail jobs</th>
                  <th scope="col">Version</th>
                  <th scope="col">Last seen</th>
                  <th scope="col">Connected</th>
                  <th scope="col"><span className="nas-connector-visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {connectors.map((connector) => {
                  const isRevoked = connector.status === 'revoked';
                  const isRevoking = revokingId === connector.id;
                  const isQueueingIndex = queueingIndexConnectorId === connector.id;
                  const isTesting = testingConnectorId === connector.id;
                  const canQueueIndex = connector.status === 'active' || connector.status === 'offline';
                  const connectorJobs = jobsByConnector[connector.id] || [];
                  const indexJob = connectorJobs.find((job) => job.type === 'index_root') || null;
                  const thumbnailJobs = connectorJobs.filter((job) => (
                    job.type === 'generate_thumbnail' && ACTIVE_JOB_STATUSES.has(job.status)
                  ));
                  const canCancelIndex = indexJob && ['queued', 'assigned', 'accepted', 'in_progress'].includes(indexJob.status);
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
                      <td data-label="Active thumbnail jobs">
                        {thumbnailJobs.length === 0 ? (
                          <span className="nas-connector-index-status none">None active.</span>
                        ) : (
                          <div className="nas-connector-thumbnail-jobs">
                            {thumbnailJobs.map((job) => (
                              <div className="nas-connector-thumbnail-job" key={job.id}>
                                <span className={`nas-connector-index-status ${job.status}`}>{describeThumbnailJob(job)}</span>
                                <span className="nas-connector-index-updated">
                                  Job {job.id.slice(-6)} · attempt {job.attemptCount || 0} · updated {formatDate(job.progressUpdatedAt || job.updatedAt || job.acceptedAt || job.createdAt)}
                                </span>
                                <button className="nas-connector-button danger compact" type="button" onClick={() => void cancelJob(connector, job)} disabled={cancellingJobId === job.id}>
                                  {cancellingJobId === job.id ? 'Cancelling…' : 'Cancel thumbnail'}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td data-label="Version">{connector.agentVersion || '—'}</td>
                      <td data-label="Last seen">{formatDate(connector.lastSeenAt)}</td>
                      <td data-label="Connected">{formatDate(connector.createdAt)}</td>
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
                            <button className="nas-connector-button danger compact" type="button" onClick={() => void cancelJob(connector, indexJob)} disabled={cancellingJobId === indexJob.id}>
                              {cancellingJobId === indexJob.id ? 'Cancelling scan…' : 'Cancel index scan'}
                            </button>
                          )}
                          {isRevoked ? (
                            <>
                              <span className="nas-connector-revoked-note">Disabled {formatDate(connector.revokedAt)}</span>
                              <button className="nas-connector-button compact" type="button" onClick={() => void enableConnector(connector)} disabled={isRevoking}>
                                {isRevoking ? 'Enablingâ€¦' : 'Enable'}
                              </button>
                            </>
                          ) : (
                            <button className="nas-connector-button danger compact" type="button" onClick={() => void revokeConnector(connector)} disabled={isRevoking}>
                              {isRevoking ? 'Disabling…' : 'Disable'}
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
