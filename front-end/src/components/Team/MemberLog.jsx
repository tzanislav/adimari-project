import React, { useState, useEffect } from "react";
import VerticalBar from "./LogBar";
import '../../CSS/Other/MemberLog.css'; // Import the CSS file for styling

function MemberLog({ memberId, incrementMs = 3600000 }) {
    const [logData, setLogData] = useState([]);
    const [loading, setLoading] = useState(true);


    useEffect(() => {
        // Simulate fetching data from an API or database
        const fetchData = async () => {
            try {
                // Simulate a network request with a timeout
                const response = await fetch(`http://54.76.118.84:5001/api/activity/time-entries/${memberId}`);
                const data = await response.json();
                console.log("Fetched log data:", data); // Debugging line to check the fetched data
                setLogData(data);
            } catch (error) {
                console.error("Error fetching log data:", error);
            } 
            finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [memberId]);

    const { bars, maxTotal } = generateBars(logData);
    function generateBars(logData) {
        const now = Date.now();
        const entries = [...logData].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const bars = [];

        let maxTotal = 0;
        let pointer = now;

        var totalFrames = 2500;

        while (totalFrames > 0) {
            totalFrames--;
            const frameEnd = pointer;
            const frameStart = pointer - incrementMs;

            const inFrame = entries.filter(e => {
                const time = new Date(e.timestamp).getTime();
                return time >= frameStart && time < frameEnd;
            });

            const totalMovement = inFrame.reduce((sum, e) => sum + (e.movement || 0), 0);
            if (totalMovement > maxTotal) maxTotal = totalMovement;

            bars.push({ frameStart, total: totalMovement });

            // Remove processed
            entries.splice(0, inFrame.length);
            pointer -= incrementMs;
        }
        
        return { bars, maxTotal };
    }

    if (loading) {
        return <div>Loading...</div>;
    }



    let groupedBars = [];
    let currentDay = null;
    let dayGroup = [];

    bars.forEach((bar, index) => {
        const dateStr = new Date(bar.frameStart).toLocaleDateString();
        if (dateStr !== currentDay) {
            if (dayGroup.length > 0) groupedBars.push({ date: currentDay, bars: dayGroup });
            currentDay = dateStr;
            dayGroup = [];
        }
        dayGroup.push({ ...bar, index });
    });
    if (dayGroup.length > 0) groupedBars.push({ date: currentDay, bars: dayGroup });

    return (
        <div className="member-log-wrapper-2">
            {groupedBars.map((group, i) => (
                <div key={i} className="day-group">
                    <div className="log-date-label">{group.date}</div>
                    <div className="member-log-container">
                        {group.bars.map((bar, idx) => {
                            const time = new Date(bar.frameStart);
                            const hour = time.getHours();
                            const timeStr = time.toLocaleTimeString([], { hour: '2-digit' });

                            const prevBar = group.bars[idx - 1];
                            const prevHour = prevBar ? new Date(prevBar.frameStart).getHours() : null;
                            const showHour = hour !== prevHour;

                            return (
                                <React.Fragment key={bar.index}>
                                    <VerticalBar fill={bar.total / maxTotal} text={showHour ? timeStr : ""} details = {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );

}

export default MemberLog;

