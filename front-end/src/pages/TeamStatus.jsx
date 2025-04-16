import React, { useState, useEffect } from "react";
import Member from "../components/Team/Member";
import '../CSS/TeamStatus.css';
import { useAuth } from '../context/AuthContext';
import TeamLog from "../components/TeamLog";



function TeamStatus() {

    const [teamMembers, setTeamMembers] = useState([]);
    const serverUrl = import.meta.env.VITE_SERVER_URL;
    const { user, logout, role } = useAuth();
    const [shownLog, setShownLog] = useState(null);

    useEffect(() => {
        fetch(serverUrl + '/clickup/members')
            .then(res => res.json())
            .then(data => {
                data.members.sort((a, b) => a.username.localeCompare(b.username));
                setTeamMembers(data);
            });
    }
        , []);



    const handleShowLog = (member) => {
        setShownLog(member);
    }



    if (!user || (role !== 'admin' && role !== 'moderator')) {
        return <div>Not authorized</div>
    }


    if (teamMembers.length === 0) {
        return <div>Loading...</div>
    }

    return (
        <div>
            <h1>Team Status</h1>
            <div className="team-members">
                {teamMembers.members.map(member => (
                    <Member key={member.id} member={member} handleShowLog={handleShowLog} />
                ))}
            </div>
            {shownLog && <TeamLog member={shownLog} handleClose={() => { setShownLog(null) }} />}
        </div>
    );
}

export default TeamStatus;

