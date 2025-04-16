const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ActivityLog = require('../models/activityLog'); // Import the ActivityLog model
const fetch = require('node-fetch');
require('dotenv').config();

var teamMembers = null;


async function getTeamMembers() {
    try {
        const response = await fetch(`https://api.clickup.com/api/v2/team/${process.env.CLICKUP_TEAM_ID}`, {
            method: 'GET',
            headers: {
                'Authorization': process.env.CLICKUP_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data && data.team.members) {
            teamMembers = data.team.members.map(member => ({
                id: member.user.id,
                username: member.user.username,
                email: member.user.email,
                profilePicture: member.user.profilePicture,
                color: member.user.color,
                role: member.user.role
            }));
        } else {
            console.error('No members found in the response:', data);
        }
        console.log('Team members:', teamMembers); // Log the team members
    } catch (error) {
        console.error('Error fetching team members:', error);
    }
}

// Call getTeamMembers when initializing the application
getTeamMembers();




router.get('/time-entries', async (req, res) => {
    res.json(teamMembers);
});


router.get('/time-entries/:id', async (req, res) => {

    const activityLogs = await ActivityLog.find({ userId: req.params.id }).sort({ timestamp: -1 });
    if (!activityLogs) {
        return res.status(404).json({ message: 'No activity logs found for this user.' });
    }
    res.json(activityLogs);

});

router.post('/time-entries', async (req, res) => {
    if(!teamMembers) {
        return res.status(500).json({ message: 'Team members not fetched yet.' });
    }

    const member = teamMembers.find(m => m.id == req.body.userId);
    if(!member) {
        console.log('Member not found:', req.body.userId);
        return res.status(404).json({ message: 'Member not found ' + req.body.userId, });
    }


    const activityLog = new ActivityLog({
        userId: req.body.userId,
        movement: req.body.movement,
        timestamp: new Date(),
    });
    try {
        await activityLog.save();
        res.status(201).json({ message: 'Activity logged successfully!' });
    } catch (error) {
        console.error('Error saving activity log:', error);
        res.status(500).json({ message: 'Failed to log activity', error });
    }
});



module.exports = router;