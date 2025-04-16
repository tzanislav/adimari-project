import React, { useState } from "react";
import "../../CSS/Other/LogBar.css"; // Import the CSS file for styling

const VerticalBar = ({ fill = 0.5, text = "some text", details = "" }) => {
  const percentage = Math.max(0, Math.min(1, fill)) * 100;
  const [pointed, setPointed] = useState(false); // use state instead of a variable

  return (
    <div
      className="bar-container"
      onMouseEnter={() => setPointed(true)}
      onMouseLeave={() => setPointed(false)}
    >
      <div className="bar-outer">
        <div className="bar-inner" style={{ height: `${percentage}%` }} />
      </div>
      <span className="bar-text">{text}</span>
      {pointed && <span className="bar-details">{details}</span>}
    </div>
  );
};

export default VerticalBar;
