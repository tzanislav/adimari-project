'use strict';

const mongoose = require('mongoose');

const fileShareSchema = new mongoose.Schema({
  s3Key: {
    type: String,
    required: true,
    index: true,
  },
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

module.exports = mongoose.models.FileShare || mongoose.model('FileShare', fileShareSchema, 'file_shares');
