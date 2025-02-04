import React, { useState } from "react";
import TeamLog from "./TeamLog";
import '../CSS/TeamMember.css';
import { useAuth } from '../context/AuthContext';

function TeamMember({ member }) {

    const [showLog, setShowLog] = useState(false);
    const { user, role } = useAuth();


    return (
        <div className={`team-member ${member.taskName === "No Task" ? "no-task" : ""}`}>
            {member.profilePicture ? (
                <img className="profile-picture " src={member.profilePicture} alt="Profile" />
            ) : (
                <div className="profile-picture-container">
                    <span className="no-picture" role="img" aria-label="Profile">{member.username[0]}</span>
                </div>
            )
            }
            <div className="team-member-prop">
                <h2>{member.username}</h2>
            </div>
            <div className="team-member-prop">
                <h5>Task Name</h5>
                <h3>{member.taskName}</h3>
            </div>
            <div className="team-member-prop">
                <h5>Time Since Last Change</h5>
                <h3>{member.timeSinceLastChange}</h3>
            </div>
            {role}
            {role === "admin" && user && (
                <>
                    {showLog ? (
                        <>
                            <button onClick={() => setShowLog(!showLog)}>Hide Log</button>
                            <TeamLog member={member} handleClose={() => setShowLog(!showLog)} />
                        </ >
                    ) : (
                        <button onClick={() => setShowLog(true)}>Show Log</button>
                    )}
                </>

            )}


        </div>
    );
}

export default TeamMember;

