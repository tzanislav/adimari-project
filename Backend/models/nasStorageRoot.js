'use strict';

const mongoose = require('mongoose');

const nasStorageRootSchema = new mongoose.Schema({
  connectorId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasConnector', required: true, index: true },
  connectorRootId: { type: String, required: true, maxlength: 200 },
  displayName: { type: String, required: true, trim: true, maxlength: 120 },
  uploadsEnabled: { type: Boolean, default: false, required: true },
  status: { type: String, enum: ['active', 'offline', 'disabled'], default: 'active', required: true, index: true },
  lastIndexedAt: { type: Date, default: null },
  lastFullScanAt: { type: Date, default: null },
  lastScanError: { type: String, default: null, maxlength: 1_000 },
}, { timestamps: true, versionKey: 'version' });

nasStorageRootSchema.index({ connectorId: 1, connectorRootId: 1 }, { unique: true });
nasStorageRootSchema.index({ status: 1, displayName: 1 });

module.exports = mongoose.models.NasStorageRoot || mongoose.model('NasStorageRoot', nasStorageRootSchema, 'nas_storage_roots');
