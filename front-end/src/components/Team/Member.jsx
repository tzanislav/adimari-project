import React, { useEffect, useState } from "react";

function Member({ member, handleShowLog }) {

    const [showDetails, setShowDetails] = useState(false);
    const [currentTask, setCurrentTask] = useState(null);
    const [timeEntries, setTimeEntries] = useState(null);
    const serverUrl = import.meta.env.VITE_SERVER_URL;

    useEffect(() => {
        try {
            fetch(serverUrl + `/clickup/current-task/${member.id}`)
                .then(res => res.json())
                .then(data => {
                    setCurrentTask(data);
                });
        } catch (error) {
            console.error('Error fetching data:', error);
        }
    }, [member.id]);

    useEffect(() => {
        try {
            fetch(serverUrl + `/clickup/time-entries/${member.id}`)
                .then(res => res.json())
                .then(data => {
                    const sortedData = data.data.sort((a, b) => b.start - a.start);
                    setTimeEntries(data.data);
                    console.log(data.data);
                });
        } catch (error) {
            console.error('Error fetching data:', error);
        }
    }, [member.id]);


    if (!currentTask || !timeEntries) {
        return <div>Loading...</div>
    }

    //Convert UTC time to local time
    function convertTimestampToLocal(timestamp, showHourOnly = false) {
        const date = new Date(Number(timestamp)); // Convert milliseconds to Date object

        if (showHourOnly) {
            return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        }

        return date.toLocaleString(); // Format in local time zone
    }

    const formatDuration = (ms) => {
        var output = '';
        const seconds = Math.floor(ms / 1000);
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (days > 0)
            output += `${days}d `;
        if (hours > 0)
            output += `${hours}h `;
        if (minutes > 0)
            output += `${minutes}m `;

        if (ms < 60000) {
            output = '<1 m';
        }
        return output;
    };

    const getDuration = (start, end) => {
        const duration = end - start;
        return formatDuration(duration);
    }


    return (
        <div className="member">
            <div className={`member-info ${currentTask.data ? '' : 'no-task'}`} onClick={() => setShowDetails(!showDetails)}>
                <div className="member-pic">
                    {member.profilePicture ? <img src={member.profilePicture} alt={member.username} /> : <img src="https://cdn.iconscout.com/icon/free/png-256/avatar-380-456332.png" alt={member.username} />}

                    <h3>{member.username}</h3>
                </div>
                <div className="task">
                    <div className="task-icon">
                        <h5>Current Task:</h5>
                        {currentTask.data ?
                            <div className="current-task-icon" style={{ backgroundColor: currentTask.data.task.color }}>
                                <a href={currentTask.data.task_url} target="_blank" rel="noopener noreferrer"> <h3>{currentTask.data.task.name}</h3></a>
                                <p>{convertTimestampToLocal(currentTask.data.at)}</p>
                                <p>{getDuration(currentTask.data.start, Date.now())}</p>
                            </div>
                            :
                            'No Task'}
                    </div>
                </div>
                <button className="log-btn" onClick={(e) => {e.stopPropagation(); handleShowLog(member);}}>View Log</button>
            </div>
            {showDetails && (
                <div className="member-log">
                    
                        {showDetails && (
                            <div className="member-details">
                                <h4>Task Entries</h4>
                                <div className="time-entries">
                                    {timeEntries.map((entry, index) => {
                                        const currentDate = new Date(Number(entry.start)).toLocaleDateString();
                                        const prevDate =
                                            index > 0 ? new Date(Number(timeEntries[index - 1].start)).toLocaleDateString() : null;
                                        const today = new Date().toLocaleDateString();
                                        const nextStart = index > 0 ? Number(timeEntries[index - 1].start) : null;

                                        return (
                                            <React.Fragment key={entry.id}>
                                                {index === 0 || currentDate !== prevDate ? (
                                                    <div className="date-separator">
                                                        <hr />
                                                        <h3>{currentDate}</h3>
                                                    </div>
                                                ) : null}

                                                {currentDate == today && index === 0 ? (
                                                    <div className="date-separator">
                                                        <h3>Today</h3>
                                                    </div>
                                                ) : null}

                                                {index > 0 && (nextStart - entry.end) > 900000 && currentDate == prevDate ? (
                                                    <div className="gap entry">
                                                        <h3>No Task</h3>
                                                        <div className="entry-details">
                                                            <div className="entry-time">
                                                                <p>from</p>
                                                                <h3>{convertTimestampToLocal(entry.end, true)}</h3>
                                                                <p>to</p>
                                                                <h3>{convertTimestampToLocal(nextStart, true)}</h3>
                                                                <p>Duration:</p>
                                                                <h3>{formatDuration(nextStart - entry.end)}</h3>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : null}


                                                <div className="entry">
                                                    <a href={entry.task_url} target="_blank" rel="noopener noreferrer"><p>{entry.task.name}</p></a>
                                                    <div className={`entry-details  ${(entry.end - entry.start) % 10000 === 0 ? 'manual' : 'automatic'}`}>
                                                        <div className="entry-time">
                                                            <p>from</p>
                                                            <h3>{convertTimestampToLocal(entry.start, true)}</h3>
                                                            <p>to</p>
                                                            <h3>{convertTimestampToLocal(entry.end, true)}</h3>
                                                        </div>
                                                        <div className="entry-time">
                                                            <p>Duration:</p>
                                                            <h3>{getDuration(entry.start, entry.end)}</h3>
                                                        </div>
                                                    </div>
                                                </div>
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    

                </div>
            )}




        </div>
    );
}

export default Member;
