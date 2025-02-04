import React, { useState, useEffect } from "react";

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
        return date.toLocaleDateString('en-GB') + ' ' + date.toLocaleTimeString();
    };

    if (!memberLog) {
        return <div>Loading...</div>;
    }

    return (
        <div className="team-log">
            <div className="log-container">
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
                            <div key={log.timestamp} className="log-entry">
                                <p>{log.movement}</p>
                                <p>{formatDate(log.timestamp)}</p>
                                <p>{formattedTime}</p>
                            </div>
                        </div>

                    );
                })}
            </div>
        </div>
    );
}

export default TeamLog;