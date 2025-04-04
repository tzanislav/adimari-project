import React, { useState, useEffect } from "react";
import "../CSS/Team-Log.css";

function TeamLog({ memberLog, member, handleClose }) {

    const formatDuration = (ms) => {
        const totalSeconds = Math.floor(ms / 1000);
        const days = Math.floor(totalSeconds / (3600 * 24));
        const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);

        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0 || days > 0) parts.push(`${hours}h`);
        parts.push(`${minutes}m`);

        return parts.join(' ');
    };

    const formatDate = (timestamp) => {
        const date = new Date(timestamp);
        const options = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
        return date.toLocaleDateString('en-GB') + ' ' + date.toLocaleTimeString('en-GB', options);
    };

    if (!memberLog) {
        return <div>Loading...</div>;
    }

    return (
        <div className="team-log"  onClick = {(e) => {
            e.stopPropagation();
            handleClose()}}>
            <div className="log-container"onClick = {(e) => {e.stopPropagation();}}>
                <div className="log-header">
                    <h1>{member.username}</h1>
                </div>
                <button onClick={handleClose}>Close</button>
                {memberLog.map((log, index) => {
                    let timeSinceLast = null;
                    if (index < memberLog.length - 1) {
                        timeSinceLast = log.timestamp - memberLog[index + 1].timestamp;
                    }
                    if (index === 0) {
                        timeSinceLast = Date.now() - log.timestamp;
                    }
                    const formattedTime = timeSinceLast !== null
                        ? formatDuration(timeSinceLast)
                        : '--';

                    return (
                        <div className="log-entries">
                            <div key={log.timestamp + index} className="log-entry">
                                <p className="log-movement log-prop">{log.movement}</p>
                                <p className="log-prop">{formatDate(log.timestamp).split(' ')[0]}</p>
                                <p className="log-prop">{formatDate(log.timestamp).split(' ')[1]}</p>
                                <h3 className="log-prop">{formattedTime}</h3>
                            </div>
                        </div>

                    );
                })}
            </div>
        </div>
    );
}

export default TeamLog;