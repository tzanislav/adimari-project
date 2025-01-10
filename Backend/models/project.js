const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, default: null },
    });

module.exports = mongoose.model('Project', projectSchema, 'projects');