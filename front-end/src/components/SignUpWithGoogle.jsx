// SignUpWithGoogle.js
import React from 'react';
import GoogleButton from 'react-google-button';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import '../CSS/SignUpWithGoogle.css';

const SignUpWithGoogle = () => {
    const handleGoogleSignIn = async () => {
        const auth = getAuth();
        const provider = new GoogleAuthProvider();

        try {
            const result = await signInWithPopup(auth, provider);

            // The signed-in user info
            const user = result.user;
            console.log('User signed in:', user);

            // Optional: Send token to your backend for further processing or storage
            const token = await user.getIdToken();
            console.log('ID Token:', token);
        } catch (error) {
            console.error('Error signing in with Google:', error);
        }
    };

    return (
        <div className='google-sign-in'>
            <h1>Sign In or Sign Up with Google</h1>
            <GoogleButton
                onClick={handleGoogleSignIn}
                label="Sign In with Google"
            />
        </div>
    );
};

export default SignUpWithGoogle;
