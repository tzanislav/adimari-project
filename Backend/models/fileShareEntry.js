'use strict';

const mongoose = require('mongoose');

// A folder share's immutable file snapshot lives in its own collection.  This
// keeps a very large folder from approaching MongoDB's per-document size limit
// and lets file/folder deletion find the shares affected by a source object.
const fileShareEntrySchema = new mongoose.Schema({
  fileShareId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FileShare',
    required: true,
    index: true,
  },
  s3Key: { type: String, required: true, index: true },
  archivePath: { type: String, required: true },
  size: { type: Number, required: true, min: 0 },
  lastModified: { type: Date, default: null },
  // Every manifest row must carry the ETag captured during the recursive S3
  // listing. The archive reader supplies it as If-Match, so it cannot silently
  // package a replacement object under an existing share link.
  eTag: { type: String, required: true },
}, { timestamps: false, versionKey: false });

fileShareEntrySchema.index({ fileShareId: 1, archivePath: 1 }, { unique: true });
fileShareEntrySchema.index({ s3Key: 1, fileShareId: 1 });

module.exports = mongoose.models.FileShareEntry
  || mongoose.model('FileShareEntry', fileShareEntrySchema, 'file_share_entries');
