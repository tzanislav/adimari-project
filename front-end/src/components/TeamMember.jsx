import React, { useState } from "react";

import '../CSS/TeamMember.css';
import { useAuth } from '../context/AuthContext';

function TeamMember({ member, handleShowLog }) {

    const { user, role } = useAuth();


    return (
        <div className="team-member-container">
            <div className={`team-member ${member.taskName === "No Task" ? "no-task" : ""}`}>
                <div className="team-member-pic">
                    {member.profilePicture ? (
                        <img className="profile-picture " src={member.profilePicture} alt="Profile" />
                    ) : (
                        <div className="profile-picture-container">
                            <span className="no-picture" role="img" aria-label="Profile">{member.username[0]}</span>
                        </div>
                    )
                    }
                </div>
                <div className="team-member-prop">
                    <h3>{member.username}</h3>
                </div>
                <div className="team-member-prop">
                    <h5>Task Name</h5>
                    <h3>{member.taskName}</h3>
                </div>
                <div className="team-member-prop">
                    <h5>Time Since Last Change</h5>
                    <h3>{member.timeSinceLastChange}</h3>
                </div>
            </div>
            {role === "admin" || user && (
                <div className="team-member-admin">
                    <button className="btn btn-primary" onClick={() => handleShowLog(member)}>View Log</button>
                </div>

            )}


        </div>
    );
}

export default TeamMember;

