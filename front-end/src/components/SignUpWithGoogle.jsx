// SignUpWithGoogle.js
import React, { useState } from 'react';
import GoogleButton from 'react-google-button';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { useAuth } from '../context/AuthContext';
import '../CSS/SignUpWithGoogle.css';

const SignUpWithGoogle = () => {
    const { role, user } = useAuth();
    const [userId, setUserId] = useState('');
    const [_role, setRole] = useState('regular'); // Default to 'regular'
    const [message, setMessage] = useState('');
    const host =  import.meta.env.VITE_SERVER_URL|| '';


    const handleGoogleSignIn = async () => {
        const auth = getAuth();
        const provider = new GoogleAuthProvider();

        try {
            const result = await signInWithPopup(auth, provider);

            // The signed-in user info
            const user = result.user;
            console.log('User signed in:', user.email);

            // Get the ID token
            const token = await user.getIdToken();
            
            // Send the token to the backend for processing and role assignment
            const response = await fetch(host + '/auth/google-signin', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
            });

            const data = await response.json();

        } catch (error) {
            console.error('Error signing in with Google:', error);
        }
    };

    const handleUpdateRole = async (event) => {
        event.preventDefault();

        try {
            const token = localStorage.getItem('token'); // Use token for authentication

            const response = await fetch(host + '/auth/update-role', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ uid: userId, _role }),
            });

            const data = await response.json();

            if (response.ok) {
                setMessage(`Role updated successfully: ${data.message}`);
            } else {
                setMessage(`Error: ${data.error}`);
            }
        } catch (error) {
            console.error('Error updating role:', error);
            setMessage('An error occurred while updating the role.');
        }
    };

    // Refresh the token
    const auth = getAuth();
    auth.currentUser?.getIdToken(true).then((token) => {
        console.log('Token refreshed:');
    });





    return (
        <div className='google-sign-in'>
            {user ? 
            (
                <>
            <h1>Welcome, {user.email}</h1>
            <p>{role}</p> 

                </>
            )
            : (
                <>
                    <h1>Sign In or Sign Up with Google</h1>
                    <GoogleButton
                        onClick={handleGoogleSignIn}
                        label="Sign In with Google"
                    />
                </>
            )}


            {role === 'admin' && (
                <div className='admin-panel'>
                    <h2>Admin Panel</h2>
                    <form onSubmit={handleUpdateRole}>
                        <label>
                            User ID:
                            <input
                                type="text"
                                value={userId}
                                onChange={(e) => setUserId(e.target.value)}
                                required
                            />
                        </label>
                        <label>
                            Update Role:
                            <select value={_role} onChange={(e) => setRole(e.target.value)}>
                                <option value="regular">Regular</option>
                                <option value="moderator">Moderator</option>
                                <option value="admin">Admin</option>
                            </select>
                        </label>
                        <button type="submit">Update Role</button>
                    </form>
                    {message && <p>{message}</p>}

                </div>
            )}
        </div>


    );
};

export default SignUpWithGoogle;
