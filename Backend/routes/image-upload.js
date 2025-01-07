const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const s3 = require('../config/s3'); // S3 configuration file
const Model3D = require('../models/Model3d'); // Model schema for 3D models
const router = express.Router();

const upload = multer(); // Multer middleware for file uploads

// Upload images to S3 and return their URLs
router.post('/upload-images', upload.array('images', 10), async (req, res) => {
    const imageUrls = [];

    try {
        for (const file of req.files) {
            const fileName = `${Date.now()}-${file.originalname}`;
            const params = {
                Bucket: process.env.S3_BUCKET_NAME,
                Key: fileName,
                Body: file.buffer,
                ContentType: file.mimetype,
            };

            const command = new PutObjectCommand(params);
            await s3.send(command);

            const url = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
            imageUrls.push(url);
        }

        res.status(200).json({ imageUrls });
    } catch (error) {
        console.error('Error uploading images:', error);
        res.status(500).json({ error: 'Failed to upload images', details: error.message });
    }
});

// Create a new 3D model
router.post('/', async (req, res) => {
    const { images, ...modelData } = req.body; // Extract images and other data

    try {
        const model = new Model3D({
            ...modelData,
            images: images || [], // Set images if provided
        });
        await model.save();
        res.status(201).send(model);
    } catch (error) {
        console.error('Error creating model:', error);
        res.status(400).json({ error: 'Failed to create model', details: error.message });
    }
});

// Edit an existing 3D model
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { images, ...modelData } = req.body; // Extract images and other data

    try {
        const model = await Model3D.findById(id);
        if (!model) {
            return res.status(404).json({ error: 'Model not found' });
        }

        // Add new images to the existing ones
        if (images && images.length > 0) {
            model.images = [...model.images, ...images];
        }

        // Update other fields
        Object.assign(model, modelData);
        await model.save();

        res.status(200).send(model);
    } catch (error) {
        console.error('Error updating model:', error);
        res.status(400).json({ error: 'Failed to update model', details: error.message });
    }
});

// Delete an image from a 3D model
router.delete('/:id/images', async (req, res) => {
    const { id } = req.params;
    const { url } = req.body;

    try {
        const model = await Model3D.findById(id);
        if (!model) {
            return res.status(404).json({ error: 'Model not found' });
        }

        // Extract the S3 key from the URL
        const key = url.split('.amazonaws.com/')[1];
        const params = {
            Bucket: process.env.S3_BUCKET_NAME,
            Key: key,
        };

        const command = new DeleteObjectCommand(params);
        await s3.send(command);

        // Remove the image URL from the model
        model.images = model.images.filter((imageUrl) => imageUrl !== url);
        await model.save();

        res.status(200).send(model);
    } catch (error) {
        console.error('Error deleting image:', error);
        res.status(400).json({ error: 'Failed to delete image', details: error.message });
    }
});

module.exports = router;
