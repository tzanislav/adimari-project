'use strict';

const mongoose = require('mongoose');

const fileOperationSchema = new mongoose.Schema({
  type: { type: String, enum: ['upload', 'replace', 'move', 'delete', 'folder_create', 'folder_delete'], required: true, index: true },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'aborted', 'needs_repair'],
    default: 'pending',
    required: true,
    index: true,
  },
  sourceKey: { type: String, default: null },
  destinationKey: { type: String, default: null },
  actorUid: { type: String, required: true, index: true },
  errorCode: { type: String, default: null },
  errorMessage: { type: String, default: null },
  context: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true, versionKey: 'version' });

fileOperationSchema.index({ status: 1, updatedAt: 1 });

module.exports = mongoose.models.FileOperation || mongoose.model('FileOperation', fileOperationSchema, 'file_operations');
