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
        const loadMembers = async () => {
            if (!user) {
                return;
            }

            try {
                const token = await user.getIdToken();
                const response = await fetch(serverUrl + '/clickup/members', {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                const data = await response.json();
                data.members.sort((a, b) => a.username.localeCompare(b.username));
                setTeamMembers(data);
            } catch (error) {
                console.error('Error fetching members:', error);
            }
        };

        loadMembers();
    }
        , [serverUrl, user]);



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

