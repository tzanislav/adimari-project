import React, { useState, useEffect } from "react";
import TeamMember from "../components/TeamMember";


function Team() {


    const [team, setTeam] = useState([]);

    useEffect(() => {
        fetch("http://54.76.118.84:5000/team-tasks")
            .then((res) => res.json())
            .then((data) => {
                console.log(data);
                setTeam(data);
            })
            .catch((error) => console.error('Error fetching data:', error));
    }, []);


    if (!team) {
        return <div>Loading...</div>;
    }



    return (
        <div>
            <h1>Team</h1>
            {team.map((member) => (
                <TeamMember key={member.username} member={member} />
            ))}

        </div>
    );
}

export default Team;