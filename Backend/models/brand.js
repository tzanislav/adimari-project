const mongoose = require('mongoose');

// Define the schema for the 'brands' collection
const brandSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: null },
  website: { type: String, default: null },
  files: { type: [String], default: null }, // Assuming multiple image URLs
  category: { type: String, required: true },
  class: { type: String, required: true },
  distributor: { type: String, default: null },
  location: { type: String, default: null },
  personToContact: { type: String, default: null },
  email: { type: String, default: null },
  phone: { type: String, default: null },
  discount: { type: Number, default: null }, // Assuming discount is a numerical value
  tags : { type: [String], default: null },
  models3D: { type: [String], default: null }, // Renamed to avoid leading underscore
  has3dmodels: { type: Boolean, default: false }, // Added a boolean field
  hasDWGmodels: { type: Boolean, default: false }, // Added a boolean field
});

// Export the model
module.exports = mongoose.model('Brand', brandSchema, 'brands');
