const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const router = express.Router();

const isValidUserId = (value) => /^\d+$/.test(String(value || ''));
const isValidTimestamp = (value) => {
    const timestamp = Number(value);

    return Number.isFinite(timestamp) && timestamp >= 0;
};
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

const buildTimeEntriesUrl = ({ userId, startDate, endDate }) => {
    const queryParams = new URLSearchParams({
        assignee: String(userId),
    });

    if (startDate !== undefined) {
        queryParams.set('start_date', String(startDate));
    }

    if (endDate !== undefined) {
        queryParams.set('end_date', String(endDate));
    }

    return `https://api.clickup.com/api/v2/team/${process.env.CLICKUP_TEAM_ID}/time_entries?${queryParams.toString()}`;
};

const simplifyTimeEntries = (entries) => entries.map((entry) => ({
    id: entry.id,
    taskName: entry?.task.name || 'Unknown Task',
    taskDate: entry?.start || null,
    folderId: entry?.task_location?.folder_id || null,
    folderName: folderCache[entry?.task_location?.folder_id] || 'No Folder',
    durationMin: Math.round((Number(entry.duration || 0) / 60000) * 100) / 100,
}));

const loadSimplifiedTimeEntries = async ({ userId, startDate, endDate }) => {
    const data = await fetchClickUp(buildTimeEntriesUrl({ userId, startDate, endDate }));
    const entries = Array.isArray(data?.data) ? data.data : [];
    const folderIds = [...new Set(entries.map((entry) => entry?.task_location?.folder_id).filter(Boolean))];

    await Promise.all(folderIds.map((folderId) => getFolderName(folderId)));

    return simplifyTimeEntries(entries);
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
    if (!isValidUserId(req.params.user_id)) {
        return res.status(400).send({ error: 'Invalid user id.' });
    }

    try {
        const simplifiedEntries = await loadSimplifiedTimeEntries({
            userId: req.params.user_id,
        });

        return res.send(simplifiedEntries);
    } catch (error) {
        console.error('Error fetching data:', error);
        return res.status(502).send({ error: 'Failed to fetch ClickUp time entries.' });
    }
});

router.get('/time-entries/range/:user_id', async (req, res) => {
    const { start_date: startDate, end_date: endDate } = req.query;

    if (!isValidUserId(req.params.user_id)) {
        return res.status(400).send({ error: 'Invalid user id.' });
    }

    if (startDate === undefined || endDate === undefined) {
        return res.status(400).send({ error: 'start_date and end_date are required.' });
    }

    if (!isValidTimestamp(startDate) || !isValidTimestamp(endDate)) {
        return res.status(400).send({ error: 'start_date and end_date must be Unix timestamps in milliseconds.' });
    }

    if (Number(startDate) > Number(endDate)) {
        return res.status(400).send({ error: 'start_date must be less than or equal to end_date.' });
    }

    try {
        const simplifiedEntries = await loadSimplifiedTimeEntries({
            userId: req.params.user_id,
            startDate,
            endDate,
        });

        return res.send(simplifiedEntries);
    } catch (error) {
        console.error('Error fetching data:', error);
        return res.status(502).send({ error: 'Failed to fetch ClickUp time entries.' });
    }
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