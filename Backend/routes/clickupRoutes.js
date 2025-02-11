const express = require('express');
const fetch = require('node-fetch');
require('dotenv').config();
const router = express.Router();

router.get('/time-entries',  async (req, res) => {
    //get request from clickup
    var data = null;
    try {
        const response = await fetch('https://api.clickup.com/api/v2/team/37458550/time_entries', {
            method: 'GET',
            headers: {
                'Authorization': process.env.CLICKUP_API_KEY
            }
        });
        data = await response.json();
        console.log(data);
    } catch (error) {
        console.error('Error fetching data:', error);
    }
    res.send(data);
});

router.get('/time-entries/:user_id',  async (req, res) => {
    //get request from clickup
    var data = null;
    try {
        const response = await fetch(`https://api.clickup.com/api/v2/team/37458550/time_entries?assignee=${req.params.user_id}`, {
            method: 'GET',
            headers: {
                'Authorization': process.env.CLICKUP_API_KEY
            }
        });
        data = await response.json();

        console.log(data);
    } catch (error) {
        console.error('Error fetching data:', error);
    }
    res.send(data);
});


router.get('/current-task/:user_id',  async (req, res) => {
    //get request from clickup
    var data = null;
    try {
        const response = await fetch(`https://api.clickup.com/api/v2/team/37458550/time_entries/current?assignee=${req.params.user_id}`, {
            method: 'GET',
            headers: {
                'Authorization': process.env.CLICKUP_API_KEY
            }
        });
        data = await response.json();
        console.log(data);
    } catch (error) {
        console.error('Error fetching data:', error);
    }
    res.send(data);
});




router.get('/members', async (req, res) => {
    //get request from clickup
    var data = null;
    try {
        const response = await fetch('https://api.clickup.com/api/v2/space/90152792511/member', {
            method: 'GET',
            headers: {
                'Authorization': process.env.CLICKUP_API_KEY
            }
        });
        data = await response.json();
    } catch (error) {
        console.error('Error fetching data:', error);
    }
    res.send(data);
});


module.exports = router;