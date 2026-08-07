import { useEffect, useRef, useState } from 'react';
import "../CSS/LicenseEntry.css";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const EXPIRING_SOON_DAYS = 30;

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
    if (!dateValue) {
        return { status: 'none', label: '' };
    }

    const expiryDate = new Date(dateValue);
    if (Number.isNaN(expiryDate.getTime())) {
        return { status: 'none', label: '' };
    }

    const timeUntilExpiry = expiryDate.getTime() - Date.now();
    const daysUntilExpiry = Math.ceil(timeUntilExpiry / DAY_IN_MS);

    if (timeUntilExpiry < 0) {
        const daysExpired = Math.max(1, Math.ceil(Math.abs(timeUntilExpiry) / DAY_IN_MS));
        return {
            status: 'expired',
            label: `${expiryDate.toLocaleDateString()} EXPIRED ${daysExpired} days ago`,
        };
    }

    if (daysUntilExpiry === 0) {
        return { status: 'expiring', label: `${expiryDate.toLocaleDateString()} expires today` };
    }

    return {
        status: timeUntilExpiry < EXPIRING_SOON_DAYS * DAY_IN_MS ? 'expiring' : 'none',
        label: `${expiryDate.toLocaleDateString()} in ${daysUntilExpiry} days`,
    };
};

function LicenseEntry({ entry , handleEdit }) {
    const [copyStatus, setCopyStatus] = useState('');
    const resetCopyStatusTimer = useRef(null);
    const expiry = getExpiryDetails(entry.expiresAt);
    const rowClassName = [
        'license-entry',
        entry.clearances === 'admin' && 'entry-admin',
        expiry.status !== 'none' && `license-entry--${expiry.status}`,
    ].filter(Boolean).join(' ');

    useEffect(() => () => {
        window.clearTimeout(resetCopyStatusTimer.current);
    }, []);

    const copyPassword = async () => {
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

    return (
        <tr className={rowClassName}>
            <td>{entry.user} </td>
            <td className="password">
                <h5>Password:</h5> 
                <button
                    type="button"
                    className="license-entry-action"
                    onClick={copyPassword}
                    aria-label="Copy password to clipboard"
                >
                    {copyStatus || 'Copy'}
                </button>
            </td>
            <td className='license-row-usedBy license-row-nonEssential'>{entry.usedBy}</td>
            <td className='license-row-price license-row-nonEssential'> {entry.price && "EUR"} {entry.price}</td>
            <td className='license-row-comment license-row-nonEssential'>{entry.comment}</td>
            <td className='license-row-expiry license-row-nonEssential'>{expiry.label}</td>
            <td>
                <button
                    type="button"
                    className="license-entry-action"
                    onClick={() => handleEdit(entry)}
                >
                    Edit
                </button>
            </td>
        </tr>

    );
}

export default LicenseEntry;
