const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    movement: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
});


// Export the model
module.exports = mongoose.model('ActivityLog', activityLogSchema, 'activity_log');