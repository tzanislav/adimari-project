import React, { useState, useEffect } from "react";
import MemberLog from "./Team/MemberLog";
import "../CSS/Team-Log.css";

function TeamLog({member, handleClose }) {
    if (!member) {
        return <div>Loading...</div>;
    }

    return (
        <div className="member-log-wrapper" onClick={(e) => {
            e.stopPropagation();
            
        }}>
            <button className="close-button" onClick={handleClose}>Close</button>
            <p>Log for {member.username}</p>
            <MemberLog memberId={member.id} incrementMs={600000} />
        </div>

    );
}

export default TeamLog;