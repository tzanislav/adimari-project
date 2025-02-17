import React, { useState } from "react";
import "../CSS/LicenseEntry.css";

function LicenseEntry({ entry , handleEdit }) {

    const formatDate = (date) => {
        if (!date) return '';
      
        const dateObj = new Date(date);
        const timeLeft = Date.now() - dateObj.getTime();
        const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
      
        if (timeLeft < 0) {
          // Date is in the future
          return `${dateObj.toLocaleDateString()} in ${-days} days`;
        } else {
          // Date is in the past
          return `${dateObj.toLocaleDateString()} EXPIRED ${days} days ago`;
        }
      };
      
    const isExpired = (dateStr) => {
        if (!dateStr) return false;
        const expiryDate = new Date(dateStr);
        return expiryDate.getTime() < Date.now();
      };


    return (
        <tr className={entry.expiresAt && isExpired(entry.expiresAt) ? 'expired' : ''}>
            <td>{entry.user}</td>
            <td className = "password"> <h5>Password:</h5> {entry.password}</td>
            <td>{entry.usedBy}</td>
            <td> {entry.price && "EUR"} {entry.price}</td>
            <td>{entry.comment}</td>
            <td> {formatDate(entry.expiresAt)}</td>
            <td><div className="btn-simple"  onClick={ () => { handleEdit(entry)}}>Edit</div></td>
        </tr>

    );
}

export default LicenseEntry;
