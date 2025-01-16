import React, { createContext, useContext, useState, useEffect } from "react";

// Create Context
const ActiveSelectionContext = createContext();

// Provide Context to the App
export const ActiveSelectionProvider = ({ children }) => {
  const [activeSelection, setActiveSelection] = useState(null);

  // Load server URL from environment variables
  const serverUrl = import.meta.env.VITE_SERVER_URL;

  // Load initial value from cookies
  useEffect(() => {
    const savedSelection = document.cookie
      .split("; ")
      .find((row) => row.startsWith("activeSelection="))
      ?.split("=")[1];

    if (savedSelection) {
      try {
        setActiveSelection(JSON.parse(decodeURIComponent(savedSelection)));
      } catch (error) {
        console.error("Failed to parse activeSelection from cookie:", error);
      }
    }
  }, []);

  // Save to cookies on change
  useEffect(() => {
    if (activeSelection) {
      document.cookie = `activeSelection=${encodeURIComponent(
        JSON.stringify(activeSelection)
      )}; path=/; max-age=31536000`;
    } else {
      document.cookie = "activeSelection=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    }
  }, [activeSelection]);

  // Clear function
  const clearActiveSelection = () => {
    setActiveSelection(null);
    document.cookie = "activeSelection=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  };

  return (
    <ActiveSelectionContext.Provider
      value={{ activeSelection, setActiveSelection, clearActiveSelection, serverUrl }}
    >
      {children}
    </ActiveSelectionContext.Provider>
  );
};

// Hook to use the context
export const useActiveSelection = () => useContext(ActiveSelectionContext);
