const mongoose = require('mongoose');

// Define the schema for the 'brands' collection
const licenseEntrySchema = new mongoose.Schema({
    user: { type: String, required: true },
    password: { type: String, required: true },
    platform: { type: String, default: true },
    usedBy: { type: String, default: null },
    comment : { type: String, default: null },
    price : { type: Number, default: null },
    imageUrl : { type: String, default: null },
    expiresAt: { type: Date, default: null },
    clearances: { type: [String], default: null },
    createdAt: { type: Date, default: Date.now },
    createdBy: { type: String, default: null },
});

// Export the model
module.exports = mongoose.model('License', licenseEntrySchema, 'licenses');
