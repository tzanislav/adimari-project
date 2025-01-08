const express = require('express');
const Model3d = require('../models/model3d');

const router = express.Router();

// Route to add a model
router.post('/', async (req, res) => {
    try {
        const newModel = new Model3d(req.body);
        const result = await newModel.save();
        res.status(201).send({ message: 'Model added successfully!', model: result });
    } catch (err) {
        res.status(500).send({ error: 'Failed to add model', details: err });
    }
});

// Route to update a model
router.put('/:id', async (req, res) => {
    try {
        const model = await Model3d.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!model) {
            res.status(404).send({ message: 'Model not found' });
        } else {
            res.status(200).send({ message: 'Model updated successfully!', model });
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to update model', details: err });
    }
});

// Route to fetch all models
router.get('/', async (req, res) => {
    try {
        const models = await Model3d.find();
        res.status(200).send(models);
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch models', details: err });
    }
});

// Route to fetch a single model
router.get('/:id', async (req, res) => {
    try {
        const model = await Model3d.findById(req.params.id);
        if (!model) {
            res.status(404).send({ message: 'Model not found' });
        } else {
            res.status(200).send(model);
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch model', details: err });
    }
});

// Route to delete a model
router.delete('/:id', async (req, res) => {
    try {
        const model = await Model3d.findByIdAndDelete(req.params.id);
        if (!model) {
            res.status(404).send({ message: 'Model not found' });
        } else {
            res.status(200).send({ message: 'Model deleted successfully!' });
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to delete model', details: err });
    }
});

module.exports = router;
