'use strict';

const mongoose = require('mongoose');

const nasFileEntrySchema = new mongoose.Schema({
  storageRootId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasStorageRoot', required: true, index: true },
  relativePath: { type: String, required: true, maxlength: 4_096 },
  parentPath: { type: String, required: true, default: '', maxlength: 4_096, index: true },
  name: { type: String, required: true, maxlength: 255 },
  entryType: { type: String, enum: ['file', 'folder'], required: true, index: true },
  sizeBytes: { type: Number, default: null, min: 0 },
  modifiedAt: { type: Date, default: null },
  versionFingerprint: { type: String, default: null, maxlength: 512 },
  contentType: { type: String, default: null, maxlength: 255 },
  previewKind: { type: String, enum: ['none', 'image'], default: 'none', required: true, index: true },
  imageWidth: { type: Number, default: null, min: 1 },
  imageHeight: { type: Number, default: null, min: 1 },
  availabilityStatus: { type: String, enum: ['online', 'stale', 'offline', 'unavailable'], default: 'offline', required: true, index: true },
  cacheObjectKey: { type: String, default: null, maxlength: 1_024 },
  cacheVersionFingerprint: { type: String, default: null, maxlength: 512 },
  // A cache object is deliberately temporary.  Retaining its expiry alongside
  // the version lets a later Open/Download/Share reuse it without asking the
  // connector to upload the same unchanged file again.
  cacheExpiresAt: { type: Date, default: null, index: true },
  thumbnailStatus: { type: String, enum: ['not_requested', 'preparing', 'ready', 'stale', 'failed'], default: 'not_requested', required: true, index: true },
  thumbnailObjectKey: { type: String, default: null, maxlength: 1_024 },
  thumbnailVersionFingerprint: { type: String, default: null, maxlength: 512 },
  thumbnailUpdatedAt: { type: Date, default: null, index: true },
  lastIndexedAt: { type: Date, required: true, index: true },
  // Only connector-authenticated indexing writes this marker. At successful
  // completion, records not seen by the matching full scan become deleted.
  lastSeenScanId: { type: String, default: null, maxlength: 36, index: true },
  deletedAt: { type: Date, default: null, index: true },
}, { timestamps: true, versionKey: 'version' });

nasFileEntrySchema.index({ storageRootId: 1, relativePath: 1 }, { unique: true });
nasFileEntrySchema.index({ storageRootId: 1, parentPath: 1, deletedAt: 1, name: 1 });
nasFileEntrySchema.index({ storageRootId: 1, availabilityStatus: 1, modifiedAt: -1 });
nasFileEntrySchema.index({ storageRootId: 1, parentPath: 1, previewKind: 1, deletedAt: 1, name: 1 });
nasFileEntrySchema.index({ storageRootId: 1, lastSeenScanId: 1, deletedAt: 1 });

module.exports = mongoose.models.NasFileEntry || mongoose.model('NasFileEntry', nasFileEntrySchema, 'nas_file_entries');
