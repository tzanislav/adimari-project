const mongoose = require('mongoose');

// Define the schema for the 'brands' collection
const brandSchema = new mongoose.Schema({
  name: { type: String, required: true },
  brand: { type: String, required: true },
  distributor: { type: String, default: null },
  description: { type: String, default: null },
  website: { type: String, default: null },
  files: { type: [String], default: null }, // Assuming multiple image URLs
  category: { type: String, required: true },
  class: { type: String, required: true },
  price: { type: Number, default: null }, // Assuming discount is a numerical value
  tags : { type: [String], default: null },
  has3dmodels: { type: Boolean, default: false }, // Added a boolean field
  hasDWGmodels: { type: Boolean, default: false }, // Added a boolean field
  createdAt : { type: Date, default: Date.now }
});

// Export the model
module.exports = mongoose.model('Item', brandSchema, 'items');
