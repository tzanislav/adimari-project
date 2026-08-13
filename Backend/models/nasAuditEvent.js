'use strict';

const mongoose = require('mongoose');

const nasAuditEventSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['enrollment_token_created', 'connector_enrolled', 'connector_reenrollment_token_created', 'connector_reenrolled', 'connector_connected_with_shared_key', 'connector_enabled', 'connector_revoked', 'connector_test_sent', 'scan_queued', 'scan_requested_locally', 'scan_cancelled', 'scan_started', 'scan_completed', 'scan_failed', 'download_requested', 'cache_completed', 'image_preview_requested', 'thumbnail_requested', 'thumbnail_completed', 'thumbnail_failed', 'upload_started', 'upload_completed', 'upload_failed'],
    required: true,
    index: true,
  },
  result: { type: String, enum: ['success', 'failure'], required: true },
  actorUid: { type: String, default: null, index: true },
  connectorId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasConnector', default: null, index: true },
  storageRootId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasStorageRoot', default: null, index: true },
  fileEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasFileEntry', default: null, index: true },
  transferJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasTransferJob', default: null, index: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

nasAuditEventSchema.index({ createdAt: -1, action: 1 });

module.exports = mongoose.models.NasAuditEvent || mongoose.model('NasAuditEvent', nasAuditEventSchema, 'nas_audit_events');
