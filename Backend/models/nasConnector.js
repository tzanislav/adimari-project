'use strict';

const mongoose = require('mongoose');

const nasConnectorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  installationId: { type: String, required: true, unique: true, index: true, maxlength: 200 },
  status: { type: String, enum: ['active', 'offline', 'revoked'], default: 'offline', required: true, index: true },
  agentVersion: { type: String, default: null, maxlength: 80 },
  lastSeenAt: { type: Date, default: null, index: true },
  revokedAt: { type: Date, default: null },
  revokedBy: { type: String, default: null },
  lastErrorCode: { type: String, default: null, maxlength: 100 },
  lastErrorMessage: { type: String, default: null, maxlength: 1_000 },
}, { timestamps: true, versionKey: 'version' });

nasConnectorSchema.index({ status: 1, lastSeenAt: 1 });

module.exports = mongoose.models.NasConnector || mongoose.model('NasConnector', nasConnectorSchema, 'nas_connectors');
