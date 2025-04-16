import React from "react";
import MemberLog from "../../components/Team/MemberLog";

function LogTest() {

    return (
        <div>
            <h1>Log Test</h1>
            <MemberLog memberId="55375489" incrementMs={600000} />


        </div>
    );

};

export default LogTest;