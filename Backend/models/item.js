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
  priceMethod: { type: String, default: null }, // Assuming a string value
  tags : { type: [String], default: null },
  modelPath: { type: String, default: null }, // Assuming a single 3D mode
  has3dmodels: { type: Boolean, default: false }, // Added a boolean field
  hasDWGmodels: { type: Boolean, default: false }, // Added a boolean field
  createdAt : { type: Date, default: Date.now },
  createdBy: { type: String, default: null },
});

// Export the model
module.exports = mongoose.model('Item', brandSchema, 'items');
