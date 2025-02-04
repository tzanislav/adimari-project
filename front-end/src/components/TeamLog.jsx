import React, { useState, useEffect } from "react";

function TeamLog({ member, handleClose }) {
    const [memberLog, setMemberLog] = useState([]);

    useEffect(() => {
        fetch("http://54.76.118.84:5000/logs/" + member.username)
            .then((res) => res.json())
            .then((data) => {
                const sortedData = data.sort((a, b) => b.timestamp - a.timestamp);
                setMemberLog(sortedData);
            })
            .catch((error) => console.error('Error fetching data:', error));
    }, [member.username]);

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

    return (
        <div className="team-log">
            <div className="log-header">
                <h1>{member.username}</h1>
            </div>
            <button onClick={handleClose}>Close</button>
            {memberLog.map((log, index) => {
                let timeSinceLast = null;
                if (index < memberLog.length - 1) {
                    timeSinceLast = log.timestamp - memberLog[index + 1].timestamp;
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
    );
}

export default TeamLog;