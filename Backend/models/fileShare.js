'use strict';

const mongoose = require('mongoose');

const fileShareSchema = new mongoose.Schema({
  sourceType: { type: String, enum: ['s3_object', 'nas_file'], default: 's3_object', required: true, index: true },
  s3Key: {
    type: String,
    default: null,
    required() { return this.sourceType === 's3_object' || this.deliveryStatus === 'ready'; },
    index: true,
  },
  nasFileEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasFileEntry', default: null, index: true },
  deliveryStatus: { type: String, enum: ['preparing', 'ready', 'expired', 'failed'], default: 'ready', required: true, index: true },
  cacheExpiresAt: { type: Date, default: null, index: true },
  originalFileName: { type: String, required: true },
  tokenHash: { type: String, required: true, select: false },
  status: { type: String, enum: ['active', 'revoked'], default: 'active', required: true, index: true },
  downloadCount: { type: Number, default: 0, min: 0, required: true },
  lastDownloadedAt: { type: Date, default: null },
  createdBy: { type: String, required: true },
  revokedAt: { type: Date, default: null },
  revokedBy: { type: String, default: null },
}, { timestamps: true, versionKey: 'version' });

fileShareSchema.index({ tokenHash: 1 }, { unique: true });
fileShareSchema.index({ s3Key: 1, status: 1, createdAt: -1 });
fileShareSchema.index({ nasFileEntryId: 1, status: 1, deliveryStatus: 1, createdAt: -1 });

module.exports = mongoose.models.FileShare || mongoose.model('FileShare', fileShareSchema, 'file_shares');
