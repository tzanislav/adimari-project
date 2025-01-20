// src/firebase.js
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBhPkoS1OuuC8K-fVzs1l9uavCI9kqY-Xs",
  authDomain: "adimari-project.firebaseapp.com",
  projectId: "adimari-project",
  storageBucket: "adimari-project.firebasestorage.app",
  messagingSenderId: "322621500214",
  appId: "1:322621500214:web:bb433854ea69f0a775e197",
  measurementId: "G-Q6XRPLBJFR",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export Auth instance
export const auth = getAuth(app);
