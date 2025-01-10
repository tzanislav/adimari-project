const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, default: null },
    selections: { type: [String], default: null }, // Assuming multiple URLs
    });

module.exports = mongoose.model('Project', projectSchema, 'projects');