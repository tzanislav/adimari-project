'use strict';

const mongoose = require('mongoose');

// These are administrative exceptions for the NAS catalogue limiter only.
// Store a normalized literal IP address, never a proxy header or hostname.
const nasRateLimitExemptionSchema = new mongoose.Schema({
  ipAddress: { type: String, required: true, unique: true, trim: true, maxlength: 45 },
  createdBy: { type: String, default: null, maxlength: 320 },
}, { timestamps: true, versionKey: 'version' });

module.exports = mongoose.models.NasRateLimitExemption
  || mongoose.model('NasRateLimitExemption', nasRateLimitExemptionSchema, 'nas_rate_limit_exemptions');
