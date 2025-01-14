const express = require('express');
const Item = require('../models/item');

const router = express.Router();

// Route to add an item
router.post('/', async (req, res) => {
    try {
        // Check if item already exists by name
        const existingItem = await Item.findOne({ name: req.body.name });
        if (existingItem) {
            return res.status(400).send({ message: 'Item already exists' });
        }

        const newItem = new Item(req.body);
        const result = await newItem.save();
        res.status(201).send({ message: 'Item added successfully!', item: result });
    } catch (err) {
        res.status(500).send({ error: 'Failed to add item', details: err });
    }
});

// Route to update an item
router.put('/:id', async (req, res) => {
    try {
        const item = await Item.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!item) {
            res.status(404).send({ message: 'Item not found' });
        } else {
            res.status(200).send({ message: 'Item updated successfully!', item });
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to update item', details: err });
    }
});

// Route to fetch all items
router.get('/', async (req, res) => {
    try {
        const items = await Item.find();
        res.status(200).send(items);
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch items', details: err });
    }
});

// Route to fetch a single item
router.get('/:id', async (req, res) => {
    try {
        const item = await Item.findById(req.params.id);
        if (!item) {
            res.status(404).send({ message: 'Item not found' });
        } else {
            res.status(200).send(item);
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch item', details: err });
    }
});

// Route to delete an item
router.delete('/:id', async (req, res) => {
    try {
        const item = await Item.findByIdAndDelete(req.params.id);
        if (!item) {
            res.status(404).send({ message: 'Item not found' });
        } else {
            res.status(200).send({ message: 'Item deleted successfully!' });
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to delete item', details: err });
    }
});

// Fetch all models of a brand
router.get('/:id/models', async (req, res) => {
    try {
        const item = await Item.findById(req.params.id);
        if (!item) {
            return res.status(404).send({ message: 'Brand not found' });
        }
        const models = await Model3d.find({ brand: brand.name });
        res.status(200).send(models);
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch models', details: err });
    }
});

module.exports = router;
