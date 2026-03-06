const express = require('express');
const User = require('../models/user'); // Import the User model
const { authenticate, authorizeRole } = require('../auth/authMiddleware');

const router = express.Router();
const requireAdmin = [authenticate, authorizeRole('admin')];

// Route to add a user
router.post('/add', ...requireAdmin, async (req, res) => {
    try {
        const newUser = new User(req.body); // Assumes JSON payload
        const result = await newUser.save();
        res.status(201).send({ message: 'User added successfully!', user: result });
    } catch (err) {
        res.status(500).send({ error: 'Failed to add user', details: err });
    }
});

// Route to fetch all users
router.get('/all', ...requireAdmin, async (req, res) => {
    try {
        const users = await User.find();
        res.status(200).send(users);
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch users', details: err });
    }
});

router.delete('/delete/:id', ...requireAdmin, async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);     
        if (!user) {
            res.status(404).send({ message: 'User not found' });
        } else {
            res.status(200).send({ message: 'User deleted successfully!' });
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to delete user', details: err });
    }
}
);

module.exports = router;
