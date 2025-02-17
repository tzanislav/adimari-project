const express = require('express');
const router = express.Router();
const LicenseEntry = require('../models/LicenseEntry');


router.get ('/', async (req, res) => {
    try {
        const licenses = await LicenseEntry.find();
        res.status(200).send(licenses);
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch licenses', details: err });
    }
});

router.post('/', async (req, res) => {
    try {
        const newLicense = new LicenseEntry(req.body);
        const result = await newLicense.save();
        console.log(result);
        res.status(201).send({ message: 'License added successfully!', license: result });
    } catch (err) {
        res.status(500).send({ error: 'Failed to add license', details: err });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const license = await LicenseEntry.findById(req.params.id);
        if (!license) {
            res.status(404).send({ message: 'License not found' });
        } else {
            res.status(200).send(license);
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch license', details: err });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const license = await LicenseEntry.findByIdAndUpdate
        (req.params.id, req.body, { new: true });
        if (!license) {
            res.status(404).send({ message: 'License not found' });
        } else {
            res.status(200).send({ message: 'License updated successfully!', license });
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to update license', details: err });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const license = await LicenseEntry.findByIdAndDelete(req.params.id);
        if (!license) {
            res.status(404).send({ message: 'License not found' });
        } else {
            res.status(200).send({ message: 'License deleted successfully!', license });
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to delete license', details: err });
    }
});




module.exports = router;
