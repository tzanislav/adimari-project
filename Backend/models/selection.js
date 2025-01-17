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
    items: [
        {
            _id: { type: String, required: true }, // Item ID
            count: { type: Number, default: 1 }, // Count of the item
        },
    ],
    createdAt: {
        type: Date,
        default: Date.now,
    },

});

module.exports = mongoose.model('Selection', selectionSchema);