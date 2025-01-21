// authRoutes.js
const express = require('express');
const admin = require('../auth/firebase-admin');
const router = express.Router();

// User signup route
router.post('/signup', async (req, res) => {
    const { email, password } = req.body; // Default role is 'regular'

    const role = 'regular';
    console.log('Sign up email:', email);
    try {
        const user = await admin.auth().createUser({
            email,
            password,
        });

        // Assign custom claims (role)
        await admin.auth().setCustomUserClaims(user.uid, { role });

        res.status(201).send({ uid: user.uid, email: user.email, role });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(400).send({ error: error.message });
    }
});

// User sign-in route
router.post('/signin', async (req, res) => {
    const { email, password } = req.body;
    console.log('Sign in email:', email);
    try {
        // Find user by email
        const userRecord = await admin.auth().getUserByEmail(email);

        // Generate custom token
        const token = await admin.auth().createCustomToken(userRecord.uid);

        // Fetch custom claims (including role)
        const user = await admin.auth().getUser(userRecord.uid);
        const role = user.customClaims?.role || 'regular'; // Default to 'regular' if no role is set

        // Send token and role to the frontend
        res.status(200).send({ token, role });
    } catch (error) {
        console.error('Error signing in user:', error);
        res.status(400).send({ error: error.message });
    }
});




// Middleware to authenticate and attach role
const authenticate = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1]; // Expecting 'Bearer <token>'
    if (!token) {
        return res.status(401).send({ message: 'Unauthorized' });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken; // Attach user info, including role, to the request object
        next();
    } catch (error) {
        console.error('Error verifying token:', error);
        res.status(403).send({ message: 'Invalid or expired token' });
    }
};

// Middleware to check roles
const authorizeRole = (requiredRole) => (req, res, next) => {
    if (req.user.role !== requiredRole) {
        return res.status(403).send({ message: 'Access denied. Insufficient permissions.' });
    }
    next();
};


// Update a user's role
router.post('/update-role', authenticate, authorizeRole('admin'), async (req, res) => {
    const { uid, role } = req.body;
    try {
        await admin.auth().setCustomUserClaims(uid, { role });
        res.send({ message: `Role updated to ${role} for user ${uid}` });
    } catch (error) {
        console.error('Error updating role:', error);
        res.status(400).send({ error: error.message });
    }
});

router.post('/google-signin', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).send({ message: 'Unauthorized' });
    }

    try {
        // Verify the token
        const decodedToken = await admin.auth().verifyIdToken(token);
        const { uid, email } = decodedToken;

        // Check if the user already has custom claims
        const user = await admin.auth().getUser(uid);
        const role = user.customClaims?.role || 'regular';

        // Optionally, set a default role if not already assigned
        if (!user.customClaims?.role) {
            await admin.auth().setCustomUserClaims(uid, { role: 'regular' });
        }

        res.send({ role, token }); // Send role and token back to the client
    } catch (error) {
        console.error('Error handling Google Sign-In:', error);
        res.status(400).send({ error: error.message });
    }
});

router.get('/get-role', authenticate, async (req, res) => {
    const { role = 'regular' } = req.user; // Default to 'regular' if no role is set
    res.send({ role });
});

// Example protected route with role included
router.get('/protected', authenticate, (req, res) => {
    const { role = 'regular' } = req.user; // Default to 'regular' if no role is set
    res.send({ message: 'You have access!', user: req.user, role });
});

// Protected routes with role-based access control
router.get('/admin', authenticate, authorizeRole('admin'), (req, res) => {
    res.send({ message: 'Welcome, Admin!', user: req.user });
});

router.get('/moderator', authenticate, authorizeRole('moderator'), (req, res) => {
    res.send({ message: 'Welcome, Moderator!', user: req.user });
});

router.get('/user', authenticate, (req, res) => {
    res.send({ message: 'Welcome, User!', user: req.user });
});

module.exports = router;
