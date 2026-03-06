// authRoutes.js
const express = require('express');
const admin = require('../auth/firebase-admin');
const router = express.Router();
const { authenticate, authorizeRole } = require('../auth/authMiddleware');

const allowedRoles = new Set(['regular', 'moderator', 'admin']);

const isValidEmail = (email) => typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// User signup route
router.post('/signup', async (req, res) => {
    const { email, password } = req.body; // Default role is 'regular'

    const role = 'regular';
    if (!isValidEmail(email) || typeof password !== 'string' || password.length < 8) {
        return res.status(400).send({ error: 'A valid email and a password with at least 8 characters are required.' });
    }

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
    return res.status(410).send({
        error: 'Custom email sign-in is disabled. Use Firebase client authentication to obtain an ID token.',
    });
});



// Update a user's role
router.post('/update-role', authenticate, authorizeRole('admin'), async (req, res) => {
    const { uid, role } = req.body;

    if (typeof uid !== 'string' || !allowedRoles.has(role)) {
        return res.status(400).send({ error: 'Invalid uid or role.' });
    }

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
