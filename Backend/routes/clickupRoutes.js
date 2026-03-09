const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const router = express.Router();

const isValidUserId = (value) => /^\d+$/.test(String(value || ''));
const folderCachePath = path.join(__dirname, '../cache/clickup-folder-cache.json');

const loadFolderCache = () => {
    try {
        if (!fs.existsSync(folderCachePath)) {
            return {};
        }

        return JSON.parse(fs.readFileSync(folderCachePath, 'utf8'));
    } catch (error) {
        console.error('Error loading folder cache:', error);
        return {};
    }
};

const persistFolderCache = (folderCache) => {
    try {
        fs.mkdirSync(path.dirname(folderCachePath), { recursive: true });
        fs.writeFileSync(folderCachePath, JSON.stringify(folderCache, null, 2));
    } catch (error) {
        console.error('Error saving folder cache:', error);
    }
};

const folderCache = loadFolderCache();

const fetchClickUp = async (url) => {
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': process.env.CLICKUP_API_KEY
        }
    });

    return response.json();
};

const getFolderName = async (folderId) => {
    if (!folderId) {
        return 'No Folder';
    }

    if (folderCache[folderId]) {
        return folderCache[folderId];
    }

    const folderData = await fetchClickUp(`https://api.clickup.com/api/v2/folder/${encodeURIComponent(folderId)}`);
    const folderName = folderData?.name || `Folder ${folderId}`;

    folderCache[folderId] = folderName;
    persistFolderCache(folderCache);

    return folderName;
};

router.get('/time-entries/all/:user_id', async (req, res) => {
    let data = null;

    if (!isValidUserId(req.params.user_id)) {
        return res.status(400).send({ error: 'Invalid user id.' });
    }

    try {
        data = await fetchClickUp(`https://api.clickup.com/api/v2/team/${process.env.CLICKUP_TEAM_ID}/time_entries?assignee=${encodeURIComponent(req.params.user_id)}`);
    } catch (error) {
        console.error('Error fetching data:', error);
        return res.status(502).send({ error: 'Failed to fetch ClickUp time entries.' });
    }

    const entries = Array.isArray(data?.data) ? data.data : [];

    const folderIds = [...new Set(entries.map((entry) => entry?.task_location?.folder_id).filter(Boolean))];

    try {
        await Promise.all(folderIds.map((folderId) => getFolderName(folderId)));
    } catch (error) {
        console.error('Error fetching folder data:', error);
        return res.status(502).send({ error: 'Failed to fetch ClickUp folder data.' });
    }

    const simplifiedEntries = entries.map((entry) => ({
        id: entry.id,
        taskName: entry?.task.name || 'Unknown Task',
        taskDate: entry?.start || null,
        folderId: entry?.task_location?.folder_id || null,
        folderName: folderCache[entry?.task_location?.folder_id] || 'No Folder',
        durationMin: Math.round((Number(entry.duration || 0) / 60000) * 100) / 100,
    }));

    return res.send(simplifiedEntries);
});

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

    } catch (error) {
        console.error('Error fetching data:', error);
        return res.status(502).send({ error: 'Failed to fetch ClickUp time entries.' });
    }
    res.send(data);
});

router.get('/time-entries/:user_id',  async (req, res) => {
    //get request from clickup
    var data = null;
    if (!isValidUserId(req.params.user_id)) {
        return res.status(400).send({ error: 'Invalid user id.' });
    }

    try {
        const response = await fetch(`https://api.clickup.com/api/v2/team/37458550/time_entries?assignee=${encodeURIComponent(req.params.user_id)}`, {
            method: 'GET',
            headers: {
                'Authorization': process.env.CLICKUP_API_KEY
            }
        });
        data = await response.json();


    } catch (error) {
        console.error('Error fetching data:', error);
        return res.status(502).send({ error: 'Failed to fetch ClickUp time entries.' });
    }
    res.send(data);
});


router.get('/current-task/:user_id',  async (req, res) => {
    //get request from clickup
    var data = null;
    if (!isValidUserId(req.params.user_id)) {
        return res.status(400).send({ error: 'Invalid user id.' });
    }

    try {
        const response = await fetch(`https://api.clickup.com/api/v2/team/37458550/time_entries/current?assignee=${encodeURIComponent(req.params.user_id)}`, {
            method: 'GET',
            headers: {
                'Authorization': process.env.CLICKUP_API_KEY
            }
        });
        data = await response.json();
    } catch (error) {
        console.error('Error fetching data:', error);
        return res.status(502).send({ error: 'Failed to fetch ClickUp current task.' });
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
        return res.status(502).send({ error: 'Failed to fetch ClickUp members.' });
    }
    res.send(data);
});


module.exports = router;