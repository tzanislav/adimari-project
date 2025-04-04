import React, { useRef, useEffect, useState } from "react";
import PropTypes from "prop-types";
import "../CSS/SuggestionsBox.css";

const SuggestionsBox = ({ suggestions, onSuggestionClick, onClose }) => {
  const boxRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);

  // Sort suggestions alphabetically
  const sortedSuggestions = suggestions.sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) {
        setIsFocused(false);
        onClose();
      }
      else {
        setIsFocused(true);
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
      <h3 className="suggestions-box-title">Suggestions:</h3>
      {sortedSuggestions.map((suggestion, index) => (
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
