import React, { createContext, useContext, useState, useEffect } from "react";
import axios from "axios";
import { useAuth } from '../context/AuthContext';

// Create Context
const ActiveSelectionContext = createContext();


// Provide Context to the App
export const ActiveSelectionProvider = ({ children }) => {
  const { user } = useAuth();
  const [activeSelection, setActiveSelection] = useState(null);

  // Load server URL from environment variables
  const serverUrl = import.meta.env.VITE_SERVER_URL;

  // Clear active selection when user logs out
  useEffect(() => {
    if (!user) {
      clearActiveSelection();
    }
  }, [user]); // Runs whenever `user` changes

  // Load initial selection from the backend using the ID stored in the cookie
  useEffect(() => {
    const savedSelectionId = document.cookie
      .split("; ")
      .find((row) => row.startsWith("activeSelectionId="))
      ?.split("=")[1];

    if (savedSelectionId) {
      axios.get(`${serverUrl}/api/selections/${savedSelectionId}`)
        .then((response) => {
          setActiveSelection(response.data);
        })
        .catch((error) => {
          console.error("Error fetching active selection:", error);
        });
    }
  }, [serverUrl]);

  // Save only the ID to cookies on change
  useEffect(() => {
    if (activeSelection && activeSelection._id) {
      document.cookie = `activeSelectionId=${encodeURIComponent(
        activeSelection._id
      )}; path=/; max-age=31536000`;
    } else {
      document.cookie = "activeSelectionId=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    }
  }, [activeSelection]);

  // Set active selection by ID and fetch data from the backend
  const setActiveSelectionById = (id) => {
    if (!id) {
      clearActiveSelection();
      return;
    }
    console.log("Setting active selection by ID:", id, " from ", `${serverUrl}/api/selections/${id}`);
    axios.get(`${serverUrl}/api/selections/${id}`)
      .then((response) => {
        setActiveSelection(response.data);
        console.log("Active selection set:", response.data);
      })
      .catch((error) => {
        console.error("Error fetching active selection:", error);
      });
  };

  // Clear function
  const clearActiveSelection = () => {
    setActiveSelection(null);
    document.cookie = "activeSelectionId=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  };

  return (
    <ActiveSelectionContext.Provider
      value={{ activeSelection, setActiveSelection: setActiveSelectionById, clearActiveSelection, serverUrl }}
    >
      {children}
    </ActiveSelectionContext.Provider>
  );
};

// Hook to use the context
export const useActiveSelection = () => useContext(ActiveSelectionContext);
