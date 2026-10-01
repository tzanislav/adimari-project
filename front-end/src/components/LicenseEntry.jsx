/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from 'react';
import "../CSS/LicenseEntry.css";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const EXPIRING_SOON_DAYS = 30;

function EyeIcon({ visible }) {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {visible && <path d="M3 21 21 3" />}
        </svg>
    );
}

function CopyIcon({ copied }) {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {copied ? <path d="m5 12 5 5L20 7" /> : (
                <>
                    <rect x="8" y="8" width="11" height="11" rx="2" />
                    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                </>
            )}
        </svg>
    );
}

const copyText = async (text) => {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const temporaryInput = document.createElement('textarea');
    temporaryInput.value = text;
    temporaryInput.setAttribute('readonly', '');
    temporaryInput.style.position = 'fixed';
    temporaryInput.style.opacity = '0';
    document.body.appendChild(temporaryInput);
    temporaryInput.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(temporaryInput);

    if (!copied) {
        throw new Error('Clipboard copy failed.');
    }
};

const getExpiryDetails = (dateValue) => {
    if (!dateValue) return { status: 'none', label: '—', detail: '' };

    const expiryDate = new Date(dateValue);
    if (Number.isNaN(expiryDate.getTime())) {
        return { status: 'none', label: '—', detail: '' };
    }

    const timeUntilExpiry = expiryDate.getTime() - Date.now();
    const daysUntilExpiry = Math.ceil(timeUntilExpiry / DAY_IN_MS);
    const label = expiryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    if (timeUntilExpiry < 0) {
        const daysExpired = Math.max(1, Math.ceil(Math.abs(timeUntilExpiry) / DAY_IN_MS));
        return {
            status: 'expired',
            label,
            detail: `Expired ${daysExpired} days ago`,
        };
    }

    if (daysUntilExpiry === 0) {
        return { status: 'expiring', label, detail: 'Expires today' };
    }

    return {
        status: timeUntilExpiry < EXPIRING_SOON_DAYS * DAY_IN_MS ? 'expiring' : 'none',
        label,
        detail: `In ${daysUntilExpiry} days`,
    };
};

function LicenseEntry({ entry , handleEdit }) {
    const [copyStatus, setCopyStatus] = useState('');
    const [passwordVisible, setPasswordVisible] = useState(false);
    const resetCopyStatusTimer = useRef(null);
    const expiry = getExpiryDetails(entry.expiresAt);

    useEffect(() => () => {
        window.clearTimeout(resetCopyStatusTimer.current);
    }, []);

    const copyPassword = async (event) => {
        event.stopPropagation();
        if (!entry.password) {
            return;
        }

        try {
            await copyText(entry.password);
            setCopyStatus('Copied');
        } catch {
            setCopyStatus('Unavailable');
        }

        window.clearTimeout(resetCopyStatusTimer.current);
        resetCopyStatusTimer.current = window.setTimeout(() => setCopyStatus(''), 1500);
    };

    const togglePassword = (event) => {
        event.stopPropagation();
        setPasswordVisible((visible) => !visible);
    };

    return (
        <tr
            className="license-entry-row"
            tabIndex={0}
            aria-label={`Edit ${entry.platform || 'license'} for ${entry.user || 'user'}`}
            onClick={() => handleEdit(entry)}
            onKeyDown={(event) => {
                if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    handleEdit(entry);
                }
            }}
        >
            <td className="license-username" title={entry.user || ''}>
                {entry.user || '—'}
                {entry.clearances === 'admin' && <span className="license-admin-badge">Admin</span>}
            </td>
            <td className="license-password-cell">
                <div className="license-password-content">
                    <span className="license-password-value">{entry.password ? (passwordVisible ? entry.password : '***') : '—'}</span>
                    <button
                        type="button"
                        className="license-password-icon"
                        onClick={togglePassword}
                        disabled={!entry.password}
                        aria-label={`${passwordVisible ? 'Hide' : 'Show'} password for ${entry.user || entry.platform}`}
                        aria-pressed={passwordVisible}
                        title={passwordVisible ? 'Hide password' : 'Show password'}
                    >
                        <EyeIcon visible={passwordVisible} />
                    </button>
                    <button
                        type="button"
                        className="license-password-icon"
                        onClick={copyPassword}
                        disabled={!entry.password}
                        aria-label={`Copy password for ${entry.user || entry.platform} to clipboard`}
                        title={copyStatus || 'Copy password'}
                    >
                        <CopyIcon copied={copyStatus === 'Copied'} />
                    </button>
                    <span className="license-copy-status" role="status">{copyStatus}</span>
                </div>
            </td>
            <td className="license-used-by" title={entry.usedBy || ''}>{entry.usedBy || '—'}</td>
            <td className="license-price">{entry.price !== null && entry.price !== undefined && entry.price !== '' ? `EUR ${entry.price}` : '—'}</td>
            <td className="license-comment" title={entry.comment || ''}>{entry.comment || '—'}</td>
            <td className={`license-expiry${expiry.status !== 'none' ? ` license-expiry--${expiry.status}` : ''}`} title={expiry.detail}>
                {expiry.label}
                {expiry.status !== 'none' && <span className="license-expiry-badge">{expiry.status === 'expired' ? 'Expired' : 'Soon'}</span>}
            </td>
        </tr>

    );
}

export default LicenseEntry;
