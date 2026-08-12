'use strict';

const mongoose = require('mongoose');

const nasConnectorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  installationId: { type: String, required: true, unique: true, index: true, maxlength: 200 },
  // Links the original one-time enrollment record to this connector so a
  // retried request can safely finish after a crash between creation and its
  // HTTP response. Re-enrollment rotates credentialHash but retains this link.
  enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasEnrollmentToken', default: null, index: true },
  credentialHash: { type: String, required: true, select: false },
  status: { type: String, enum: ['enrolling', 'active', 'offline', 'revoked'], default: 'enrolling', required: true, index: true },
  agentVersion: { type: String, default: null, maxlength: 80 },
  lastSeenAt: { type: Date, default: null, index: true },
  revokedAt: { type: Date, default: null },
  revokedBy: { type: String, default: null },
  lastErrorCode: { type: String, default: null, maxlength: 100 },
  lastErrorMessage: { type: String, default: null, maxlength: 1_000 },
}, { timestamps: true, versionKey: 'version' });

nasConnectorSchema.index({ status: 1, lastSeenAt: 1 });

module.exports = mongoose.models.NasConnector || mongoose.model('NasConnector', nasConnectorSchema, 'nas_connectors');
