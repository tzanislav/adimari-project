// authMiddleware.js
const admin = require('../auth/firebase-admin');

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

module.exports = { authenticate, authorizeRole };
