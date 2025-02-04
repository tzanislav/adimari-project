import React, { useState, useEffect } from "react";
import TeamMember from "../components/TeamMember";
import TeamLog from "../components/TeamLog";

function Team() {


    const [team, setTeam] = useState([]);
    const [shownLog, setShownLog] = useState(null);
    const [logData, setLogData] = useState(null);

    useEffect(() => {
        fetch("http://54.76.118.84:5000/team-tasks")
            .then((res) => res.json())
            .then((data) => {
                console.log(data);
                setTeam(data);
            })
            .catch((error) => console.error('Error fetching data:', error));
    }, []);

    const handleShowLog = (member) => {
        setShownLog(member);
    }

    useEffect(() => {
        if (shownLog) {
            fetch(`http://54.76.118.84:5000/logs/${shownLog.username}`)
                .then((res) => res.json())
                .then((data) => {
                    console.log(data);
                    // Sort the data by timestamp
                    data.sort((a, b) => b.timestamp - a.timestamp);
                    setLogData(data);
                })
                .catch((error) => console.error('Error fetching data:', error));
        }
    }, [shownLog]);




    if (!team) {
        return <div>Loading...</div>;
    }



    return (
        <div>
            <h1>Team</h1>
            {team.map((member) => (
                <TeamMember key={member.username} member={member} handleShowLog={handleShowLog} />
            ))}

            {shownLog && <TeamLog memberLog={logData} member={shownLog} handleClose={() => {setShownLog(null)}}/>}

        </div>
    );
}

export default Team;