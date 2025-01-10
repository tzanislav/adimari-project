const mongoose = require('mongoose');

const selectionSchema = new mongoose.Schema({

    name: {
        type: String,
        required: true,
    },
    description: {
        type: String,
    },
    parentProject: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true,
    },
    models3d: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Model3d',
    }],

});

module.exports = mongoose.model('Selection', selectionSchema);