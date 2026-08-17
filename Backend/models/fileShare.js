'use strict';

const mongoose = require('mongoose');

const fileShareSchema = new mongoose.Schema({
  shareType: {
    type: String,
    enum: ['file', 'folder'],
    default: 'file',
    required: true,
    index: true,
  },
  s3Key: {
    type: String,
    required: true,
    index: true,
  },
  originalFileName: { type: String, required: true },
  // Folder shares retain the selected path separately from the S3 prefix so
  // callers never need to derive a user-facing path from a storage key.
  folderPath: { type: String, default: null },
  fileCount: { type: Number, default: null, min: 0 },
  totalBytes: { type: Number, default: null, min: 0 },
  archive: {
    status: {
      type: String,
      enum: ['not_required', 'initializing', 'queued', 'preparing', 'ready', 'failed'],
      default: 'not_required',
      required: true,
      index: true,
    },
    s3Key: { type: String, default: null, select: false },
    fileName: { type: String, default: null },
    size: { type: Number, default: null, min: 0 },
    startedAt: { type: Date, default: null },
    heartbeatAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    errorCode: { type: String, default: null },
    attempts: { type: Number, default: 0, min: 0 },
    processedFiles: { type: Number, default: 0, min: 0 },
    processedBytes: { type: Number, default: 0, min: 0 },
  },
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
fileShareSchema.index({ shareType: 1, s3Key: 1, status: 1, createdAt: -1 });
fileShareSchema.index({ shareType: 1, 'archive.status': 1, 'archive.startedAt': 1 });

module.exports = mongoose.models.FileShare || mongoose.model('FileShare', fileShareSchema, 'file_shares');
