// authRoutes.js
const express = require('express');
const admin = require('../auth/firebase-admin');
const router = express.Router();

// User signup route
router.post('/signup', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await admin.auth().createUser({
            email,
            password,
        });
        res.status(201).send({ uid: user.uid, email: user.email });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(400).send({ error: error.message });
    }
});

// User sign-in route
router.post('/signin', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Find user by email (this assumes you're using Firebase Authentication)
        const userRecord = await admin.auth().getUserByEmail(email);
        const token = await admin.auth().createCustomToken(userRecord.uid);
        res.status(200).send({ token });
    } catch (error) {
        console.error('Error signing in user:', error);
        res.status(400).send({ error: error.message });
    }
});

// Middleware to protect routes
const authenticate = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1]; // Expecting 'Bearer <token>'
    if (!token) {
        return res.status(401).send({ message: 'Unauthorized' });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken; // Attach user info to the request object
        next();
    } catch (error) {
        console.error('Error verifying token:', error);
        res.status(403).send({ message: 'Invalid or expired token' });
    }
};

// Example protected route
router.get('/protected', authenticate, (req, res) => {
    res.send({ message: 'You have access!', user: req.user });
});

module.exports = router;
