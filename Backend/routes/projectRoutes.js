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
        console.log("Updating project with selection:", req.body);

        // Fetch the selection (assumes `Selection.add` creates or retrieves the selection)
        const sel = await Selection.findById(req.body.selection);
        if (!sel) {
            return res.status(404).send({ message: 'Selection not found' });
        }

        // Find the project and add the selection to the `selections` array
        const project = await Project.findByIdAndUpdate(
            req.params.id,
            { $addToSet: { selections: sel._id } }, // Add the selection ID, ensuring no duplicates
            { new: true } // Return the updated project
        );

        if (!project) {
            return res.status(404).send({ message: 'Project not found' });
        }

        console.log("Project updated successfully:", project);
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
            console.log("Selections found:", selections);
            res.status(200).send(selections);
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch selections', details: err });
    }
});

module.exports = router;
