import React, { useState, useEffect } from "react";
import { Link } from 'react-router-dom';
import Member from "../components/Team/Member";
import '../CSS/TeamStatus.css';
import { useAuth } from '../context/AuthContext';
import TeamLog from "../components/TeamLog";
import { fetchWithAuth } from '../utils/authHeaders';



function TeamStatus() {

    const [teamMembers, setTeamMembers] = useState([]);
    const serverUrl = import.meta.env.VITE_SERVER_URL;
    const { user, role } = useAuth();
    const [shownLog, setShownLog] = useState(null);

    useEffect(() => {
        const loadMembers = async () => {
            if (!user) {
                return;
            }

            try {
                const response = await fetchWithAuth(serverUrl + '/clickup/members');

                if (!response.ok) {
                    throw new Error(`Failed to load members: ${response.status}`);
                }

                const data = await response.json();
                const members = Array.isArray(data.members) ? data.members : [];
                members.sort((a, b) => a.username.localeCompare(b.username));
                setTeamMembers(members);
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
            <div className="team-page-header">
                <h1>Team Status</h1>
                <Link to="/team/summary" className="team-summary-link">Team Summary</Link>
            </div>
            <div className="team-members">
                {teamMembers.map(member => (
                    <Member key={member.id} member={member} handleShowLog={handleShowLog} />
                ))}
            </div>
            {shownLog && <TeamLog member={shownLog} handleClose={() => { setShownLog(null) }} />}
        </div>
    );
}

export default TeamStatus;

