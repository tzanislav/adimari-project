const express = require('express');
const Project = require('../models/project');
const Selection = require('../models/selection');
const router = express.Router();

// Route to add a project
router.post('/', async (req, res) => {
    try {
        const newProject = new Project(req.body);
        const result = await newProject.save();
        res.status(201).send({ message: 'Project added successfully!', project: result });
    } catch (err) {
        res.status(500).send({ error: 'Failed to add project', details: err });
    }
});

// Route to update a project
router.put('/:id', async (req, res) => {
    try {
        // Build the update object dynamically from the request body
        const updateFields = {};

        // Add other fields to the update object dynamically
        Object.keys(req.body).forEach((key) => {
            if (key !== 'selections') {
                updateFields[key] = req.body[key];
            }
        });

        // Find the project and apply updates
        const project = await Project.findByIdAndUpdate(
            req.params.id,
            updateFields,
            { new: true } // Return the updated project
        );

        if (!project) {
            return res.status(404).send({ message: 'Project not found' });
        }
        res.status(200).send({ message: 'Project updated successfully!', project });
    } catch (err) {
        console.error("Error updating project:", err);
        res.status(500).send({ error: 'Failed to update project', details: err });
    }
});


// Route to fetch all projects
router.get('/', async (req, res) => {
    try {
        const projects = await Project.find();
        res.status(200).send(projects);
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch projects', details: err });
    }
});

// Route to fetch a single project
router.get('/:id', async (req, res) => {
    try {
        const project = await Project.findById(req.params.id);
        if (!project) {
            res.status(404).send({ message: 'Project not found' });
        } else {
            res.status(200).send(project);
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch project', details: err });
    }
});

// Route to delete a project
router.delete('/:id', async (req, res) => {
    try {
        const project = await Project.findByIdAndDelete(req.params.id);
        if (!project) {
            res.status(404).send({ message: 'Project not found' });
        } else {
            const selections = await Selection.find({ parentProject: req.params.id });
            if (selections.length > 0) {
                await Selection.deleteMany({ parentProject: req.params.id });
            }
            res.status(200).send({ message: 'Project deleted successfully!', project });
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to delete project', details: err });
    }
});


router.get ('/:id/selections', async (req, res) => {
    try {
        const project = await Project.findById(req.params.id);
        if (!project) {
            res.status(404).send({ message: 'Project not found' });
        } else {
            const selections = await Selection.find({ parentProject: req.params.id });
            res.status(200).send(selections);
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch selections', details: err });
    }
});

module.exports = router;
