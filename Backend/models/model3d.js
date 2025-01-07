const mongoose = require('mongoose');

const Model3dSchema = new mongoose.Schema({
    name: { type: String, required: true }, // Name is required
    description: { type: String, default: null }, // Optional description
    images: { type: [String], default: [] }, // Array of image URLs, default to an empty array
    category: { type: String, required: true }, // Required category
    class: { type: String, required: true }, // Required class
    tags: { type: [String], default: [] }, // Tags as an array of strings, default to an empty array
    brand: { type: String, default: null }, // Optional brand
    price: { type: Number, default: null }, // Optional price
    path: { type: String, default: null }, // Optional file path or similar field
});

module.exports = mongoose.model('Model3d', Model3dSchema, 'models3d'); // 'models3d' is the collection name
