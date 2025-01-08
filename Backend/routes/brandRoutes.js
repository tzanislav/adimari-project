const express = require('express');
const Brand = require('../models/brand');
const Model3d = require('../models/model3d');

const router = express.Router();

// Route to add a brand
router.post('/', async (req, res) => {
    try {
        //Check if brand already exists by name
        const existingBrand = await
            Brand.findOne({ name: req
                .body.name });
        if (existingBrand) {
            return res.status(400).send({ message: 'Brand already exists' });
        }

        const newBrand = new Brand(req.body);
        const result = await newBrand.save();
        res.status(201).send({ message: 'Brand added successfully!', brand: result });
    } catch (err) {
        res.status(500).send({ error: 'Failed to add brand', details: err });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const brand = await Brand.findByIdAndUpdate
            (req.params.id, req.body, { new: true });
        if (!brand) {
            res.status(404).send({ message: 'Brand not found' });
        } else {
            res.status(200).send({ message: 'Brand updated successfully!', brand });
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to update brand', details: err });
    }
}
);

// Route to fetch all brands
router.get('/', async (req, res) => {
    try {
        const brands = await Brand.find();
        res.status(200).send(brands);
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch brands', details: err });
    }
});

// Route to fetch a single brand
router.get('/:id', async (req, res) => {
    try {
        const brand = await Brand.findById(req.params.id);
        if (!brand) {
            res.status(404).send({ message: 'Brand not found' });
        } else {
            res.status(200).send(brand);
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch brand', details: err });
    }
});

// Route to delete a brand
router.delete('/:id', async (req, res) => {
    try {
        const brand = await Brand.findByIdAndDelete(req.params.id);
        if (!brand) {
            res.status(404).send({ message: 'Brand not found' });
        } else {
            res.status(200).send({ message: 'Brand deleted successfully!' });
        }
    } catch (err) {
        res.status(500).send({ error: 'Failed to delete brand', details: err });
    }
});

// Fetch all models of a brand
router.get('/:id/models', async (req, res) => {
    try {
        const brand = await Brand.findById(req.params.id);
        if (!brand) {
            return res.status(404).send({ message: 'Brand not found' });
        }
        const models = await Model3d.find({ brand: brand.name });
        res.status(200).send(models);
    } catch (err) {
        res.status(500).send({ error: 'Failed to fetch models', details: err });
    }
});


module.exports = router;