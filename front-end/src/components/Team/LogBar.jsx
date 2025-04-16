import React from "react";
import "../../CSS/Other/LogBar.css"; // Import the CSS file for styling

const VerticalBar = ({ fill = 0.5, text = "some text" }) => {
    const percentage = Math.max(0, Math.min(1, fill)) * 100;
    return (
      <div className="bar-container">
        <div className="bar-outer">
          <div
            className="bar-inner"
            style={{ height: `${percentage}%` }}
          />
        </div>
        <span className="bar-text">{text}</span>
      </div>
    );
  };

export default VerticalBar;
