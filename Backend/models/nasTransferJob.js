'use strict';

const mongoose = require('mongoose');

const nasTransferJobSchema = new mongoose.Schema({
  type: { type: String, enum: ['index_root', 'cache_for_download', 'generate_thumbnail', 'write_upload_to_nas'], required: true, index: true },
  status: {
    type: String,
    // `accepted` means the connector durably recorded the assignment. It is
    // intentionally distinct from `in_progress`, which a later NAS executor
    // will set only when it actually begins filesystem work.
    enum: ['staging', 'queued', 'assigned', 'accepted', 'in_progress', 'completed', 'retryable_failure', 'failed', 'cancelled', 'conflict'],
    default: 'queued',
    required: true,
    index: true,
  },
  connectorId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasConnector', required: true, index: true },
  storageRootId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasStorageRoot', required: true, index: true },
  // Opaque connector-local root ID carried in HTTPS-poll assignments. It is never a
  // Windows/UNC path and lets the service reject work for another root before
  // any future executor resolves a local folder.
  connectorRootId: { type: String, default: null, maxlength: 200, index: true },
  fileEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'NasFileEntry', default: null },
  requestedBy: { type: String, default: null, index: true },
  // Only one active index-root job may exist per logical root. A sparse unique
  // key makes repeated admin test requests converge without needing a queue
  // worker or a transaction in this deliberately small first slice.
  // The current delivery-only slice never reaches a terminal executor state,
  // so a sparse unique key makes concurrent admin requests converge on one
  // pending job. A later executor must clear this field atomically when it
  // moves a job to a terminal state, allowing an intentional re-scan.
  idempotencyKey: { type: String, default: undefined, maxlength: 300, unique: true, sparse: true },
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
  deliveryId: { type: String, default: null, maxlength: 36, index: true },
  leaseExpiresAt: { type: Date, default: null, index: true },
  acceptedAt: { type: Date, default: null },
  // A full indexing run owns one opaque scan ID. Connector batch reports and
  // completion must match it so stale/replayed reports cannot mutate a newer
  // run for the same logical root.
  scanId: { type: String, default: null, maxlength: 36, index: true },
  // Captured once a full scan starts. Incremental watcher updates that arrive
  // during the scan have a newer lastIndexedAt and must not be mistaken for
  // entries absent from that scan at completion.
  scanStartedAt: { type: Date, default: null, index: true },
  completedAt: { type: Date, default: null },
  // The retention service derives this from the terminal completion time. A
  // TTL index is the final guard; explicit sweeps make cleanup observable.
  purgeAfter: { type: Date, default: null },
  errorCode: { type: String, default: null, maxlength: 100 },
  errorMessage: { type: String, default: null, maxlength: 1_000 },
}, { timestamps: true, versionKey: 'version' });

nasTransferJobSchema.index({ connectorId: 1, status: 1, createdAt: 1 });
nasTransferJobSchema.index({ storageRootId: 1, status: 1, updatedAt: -1 });
nasTransferJobSchema.index({ connectorId: 1, type: 1, status: 1, leaseExpiresAt: 1 });
nasTransferJobSchema.index({ storageRootId: 1, scanId: 1, status: 1 });
nasTransferJobSchema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.NasTransferJob || mongoose.model('NasTransferJob', nasTransferJobSchema, 'nas_transfer_jobs');
