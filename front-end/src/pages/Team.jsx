import React, { useState, useEffect } from "react";
import TeamMember from "../components/TeamMember";
import TeamLog from "../components/TeamLog";

function Team() {


    const [team, setTeam] = useState([]);
    const [shownLog, setShownLog] = useState(null);
    const [logData, setLogData] = useState(null);
    const [number, setNumber] = useState(0);

    useEffect(() => {
        fetch("http://54.76.118.84:5000/team-tasks")
            .then((res) => res.json())
            .then((data) => {
                setTeam(data);
            })
            .catch((error) => console.error('Error fetching data:', error));
    }, [number]);

    const handleShowLog = (member) => {
        setShownLog(member);
    }

    useEffect(() => {
        if (shownLog) {
            fetch(`http://54.76.118.84:5000/logs/${shownLog.username}`)
                .then((res) => res.json())
                .then((data) => {

                    // Sort the data by timestamp
                    data.sort((a, b) => b.timestamp - a.timestamp);
                    setLogData(data);
                })
                .catch((error) => console.error('Error fetching data:', error));
        }
    }, [shownLog]);

    //Increment the number once a minute
    useEffect(() => {
        const interval = setInterval(() => {
            setNumber(number + 1);
        }, 10000);
        return () => clearInterval(interval);
    }, [number]);


    if (!team) {
        return <div>Loading...</div>;
    }



    return (
        <div className="team-container">
            <h1>Team</h1>
            {team.map((member) => (
                <TeamMember key={member.username} member={member} handleShowLog={handleShowLog} />
            ))}

            {shownLog && <TeamLog memberLog={logData} member={shownLog} handleClose={() => {setShownLog(null)}}/>}

        </div>
    );
}

export default Team;