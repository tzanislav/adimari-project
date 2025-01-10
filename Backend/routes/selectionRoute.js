const express = require('express');
const Selection = require('../models/selection');
const Project = require('../models/project');
const router = express.Router();

// Route to add a selection
router.post('/', async (req, res) => {
    console.log(req.body);
    try {
        try {
            const parentProject = await Project.findById(req.body.project);
            if (!parentProject) {
                return res.status(404).send({ message: 'Parent project not found' });
            }
            req.body.parentProject = parentProject._id;
        } catch (err) {
            return res.status(500).send({ error: 'Failed to validate parent project', details: err });
        }

        const newSelection = new Selection(req.body);
        const result = await newSelection.save();
        console.log("Created:  " + result);
        res.status(201).send({ message: 'Selection added successfully!', selection: result });
    } catch (err) {
        console.log(err);
        res.status(500).send({ error: 'Failed to add selection', details: err });
    }
});

// Route to update a selection
router.put('/:id', async (req, res) => {
    try {
        const selection = await Selection.findByIdAndUpdate
        (req.params.id, req.body, { new: true });
        if (!selection) {
            res.status(404).send({ message: 'Selection not found' });
        } else {
            console.log("Selection updated", selection);
            res.status(200).send({ message: 'Selection updated successfully!', selection });
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to update selection', details: err });
    }
});

// Route to fetch all selections
router.get('/', async (req, res) => {
    try {
        const selections = await Selection.find();
        res.status(200).send(selections);
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch selections', details: err });
    }
});

// Route to fetch a single selection
router.get('/:id', async (req, res) => {
    try {
        const selection = await Selection.findById(req.params.id);
        if (!selection) {
            res.status(404).send({ message: 'Selection not found' });
        } else {
            res.status(200).send(selection);
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch selection', details: err });
    }
});

// Route to delete a selection
router.delete('/:id', async (req, res) => {
    try {
        const selection = await Selection.findByIdAndDelete(req.params.id);
        if (!selection) {
            res.status(404).send({ message: 'Selection not found' });
        } else {
            res.status(200).send({ message: 'Selection deleted successfully!' });
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to delete selection', details: err });
    }
});

module.exports = router;

