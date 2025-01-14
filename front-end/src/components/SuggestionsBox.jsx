import React, { useRef, useEffect } from "react";
import PropTypes from "prop-types";
import "../CSS/SuggestionsBox.css";

const SuggestionsBox = ({ suggestions, onSuggestionClick, onClose }) => {
  const boxRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  if (!suggestions.length) return null;

  return (
    <div className="suggestions-box" ref={boxRef}>
      {suggestions.map((suggestion, index) => (
        <div
          key={index}
          className="suggestion-item"
          onMouseDown={(e) => {
            e.preventDefault(); // Prevent triggering input's `onBlur`
            onSuggestionClick(suggestion);
          }}
        >
          {suggestion}
        </div>
      ))}
    </div>
  );
};

SuggestionsBox.propTypes = {
  suggestions: PropTypes.arrayOf(PropTypes.string).isRequired,
  onSuggestionClick: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default SuggestionsBox;
