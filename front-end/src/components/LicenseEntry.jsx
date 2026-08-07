import "../CSS/LicenseEntry.css";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const EXPIRING_SOON_DAYS = 30;

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
    const expiry = getExpiryDetails(entry.expiresAt);
    const rowClassName = [
        'license-entry',
        entry.clearances === 'admin' && 'entry-admin',
        expiry.status !== 'none' && `license-entry--${expiry.status}`,
    ].filter(Boolean).join(' ');


    return (
        <tr className={rowClassName}>
            <td>{entry.user} </td>
            <td className = "password"> <h5>Password:</h5> {entry.password}</td>
            <td>{entry.usedBy}</td>
            <td> {entry.price && "EUR"} {entry.price}</td>
            <td>{entry.comment}</td>
            <td>{expiry.label}</td>
            <td><div className="btn-simple"  onClick={ () => { handleEdit(entry)}}>Edit</div></td>
        </tr>

    );
}

export default LicenseEntry;
