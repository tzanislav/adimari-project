'use strict';

const mongoose = require('mongoose');

const fileAuditEventSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: [
      'upload_started',
      'upload_completed',
      'upload_aborted',
      'folder_created',
      'folder_deleted',
      'file_moved',
      'file_deleted',
      'share_created',
      'folder_share_created',
      'share_revoked',
      'share_download_started',
      'share_archive_queued',
      'share_archive_started',
      'share_archive_completed',
      'share_archive_failed',
    ],
    required: true,
    index: true,
  },
  result: { type: String, enum: ['success', 'failure'], required: true },
  actorUid: { type: String, default: null, index: true },
  s3Key: { type: String, default: null, index: true },
  fileShareId: { type: mongoose.Schema.Types.ObjectId, ref: 'FileShare', default: null },
  operationId: { type: mongoose.Schema.Types.ObjectId, ref: 'FileOperation', default: null },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

fileAuditEventSchema.index({ createdAt: -1, action: 1 });

module.exports = mongoose.models.FileAuditEvent || mongoose.model('FileAuditEvent', fileAuditEventSchema, 'file_audit_events');
