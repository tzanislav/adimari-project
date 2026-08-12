'use strict';

const mongoose = require('mongoose');

const nasTransferJobSchema = new mongoose.Schema({
  type: { type: String, enum: ['index_root', 'cache_for_download', 'generate_thumbnail', 'write_upload_to_nas'], required: true, index: true },
  status: {
    type: String,
    enum: ['queued', 'assigned', 'in_progress', 'completed', 'retryable_failure', 'failed', 'cancelled', 'conflict'],
    default: 'queued',
    required: true,
    index: true,
  },
  connectorId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasConnector', required: true, index: true },
  storageRootId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasStorageRoot', required: true, index: true },
  fileEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasFileEntry', default: null },
  requestedBy: { type: String, default: null, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  attemptCount: { type: Number, default: 0, min: 0, required: true },
  progressStage: {
    type: String,
    enum: ['reading_nas', 'uploading_cache', 'generating_thumbnail', 'uploading_thumbnail', 'downloading_staging', 'writing_nas', 'verifying'],
    default: null,
  },
  progressBytes: { type: Number, default: 0, min: 0, required: true },
  progressTotalBytes: { type: Number, default: null, min: 0 },
  progressUpdatedAt: { type: Date, default: null },
  assignedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  errorCode: { type: String, default: null, maxlength: 100 },
  errorMessage: { type: String, default: null, maxlength: 1_000 },
}, { timestamps: true, versionKey: 'version' });

nasTransferJobSchema.index({ connectorId: 1, status: 1, createdAt: 1 });
nasTransferJobSchema.index({ storageRootId: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.models.NasTransferJob || mongoose.model('NasTransferJob', nasTransferJobSchema, 'nas_transfer_jobs');
