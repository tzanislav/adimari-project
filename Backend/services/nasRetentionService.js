'use strict';

const TERMINAL_JOB_STATUSES = Object.freeze(['completed', 'failed', 'cancelled', 'conflict']);
const STALE_THUMBNAIL_STATUSES = Object.freeze(['stale', 'failed']);

const toDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const subtractDays = (date, days) => new Date(date.getTime() - (days * 24 * 60 * 60 * 1_000));

const addDays = (date, days) => new Date(date.getTime() + (days * 24 * 60 * 60 * 1_000));

const resolveDocuments = async (query, limit) => {
  let current = query;
  if (typeof current?.sort === 'function') current = current.sort({ createdAt: 1 });
  if (typeof current?.limit === 'function') current = current.limit(limit);
  if (typeof current?.lean === 'function') current = current.lean();
  return current;
};

/**
 * Applies bounded NAS retention without relying on an unbounded object-store
 * listing. Object deletion is driven by the catalogue record that owns it.
 */
class NasRetentionService {
  constructor({
    NasTransferJobModel,
    NasAuditEventModel,
    NasFileEntryModel,
    thumbnailStorage,
    config,
    now = () => new Date(),
    logger = console,
    batchLimit = 200,
  } = {}) {
    if (!NasTransferJobModel || !NasAuditEventModel || !NasFileEntryModel || !thumbnailStorage || !config) {
      throw new Error('NAS retention requires models, thumbnail storage, and configuration.');
    }
    this.NasTransferJobModel = NasTransferJobModel;
    this.NasAuditEventModel = NasAuditEventModel;
    this.NasFileEntryModel = NasFileEntryModel;
    this.thumbnailStorage = thumbnailStorage;
    this.config = config;
    this.now = now;
    this.logger = logger;
    this.batchLimit = batchLimit;
  }

  async runOnce() {
    const now = this.now();
    const summary = {
      jobsPurged: 0,
      auditsPurged: 0,
      deletedEntriesPurged: 0,
      staleThumbnailsPurged: 0,
      cleanupFailures: 0,
    };

    await this.scheduleTerminalJobPurge(now);
    await this.scheduleAuditPurge(now);

    const [jobs, audits] = await Promise.all([
      this.NasTransferJobModel.deleteMany({ purgeAfter: { $ne: null, $lte: now } }),
      this.NasAuditEventModel.deleteMany({ purgeAfter: { $ne: null, $lte: now } }),
    ]);
    summary.jobsPurged = jobs?.deletedCount || 0;
    summary.auditsPurged = audits?.deletedCount || 0;

    const deletedEntryResult = await this.purgeDeletedEntries(now);
    summary.deletedEntriesPurged = deletedEntryResult.purged;
    summary.cleanupFailures += deletedEntryResult.failures;

    const staleThumbnailResult = await this.purgeStaleThumbnails(now);
    summary.staleThumbnailsPurged = staleThumbnailResult.purged;
    summary.cleanupFailures += staleThumbnailResult.failures;

    return summary;
  }

  async scheduleTerminalJobPurge(now) {
    const jobs = await resolveDocuments(this.NasTransferJobModel.find({
      status: { $in: TERMINAL_JOB_STATUSES },
      purgeAfter: null,
    }), this.batchLimit);
    await Promise.all(jobs.map(async (job) => {
      const completedAt = toDate(job.completedAt || job.updatedAt || job.createdAt);
      if (!completedAt) return;
      await this.NasTransferJobModel.updateOne(
        { _id: job._id, purgeAfter: null },
        { $set: { purgeAfter: addDays(completedAt, this.config.terminalJobRetentionDays) } },
      );
    }));
  }

  async scheduleAuditPurge(now) {
    const audits = await resolveDocuments(this.NasAuditEventModel.find({ purgeAfter: null }), this.batchLimit);
    await Promise.all(audits.map(async (event) => {
      const createdAt = toDate(event.createdAt);
      if (!createdAt) return;
      await this.NasAuditEventModel.updateOne(
        { _id: event._id, purgeAfter: null },
        { $set: { purgeAfter: addDays(createdAt, this.config.auditRetentionDays) } },
      );
    }));
  }

  async purgeDeletedEntries(now) {
    const entries = await resolveDocuments(this.NasFileEntryModel.find({
      deletedAt: { $ne: null, $lte: subtractDays(now, this.config.deletedEntryRetentionDays) },
    }), this.batchLimit);
    let purged = 0;
    let failures = 0;
    for (const entry of entries) {
      if (!(await this.deleteThumbnail(entry.thumbnailObjectKey, entry._id))) {
        failures += 1;
        continue;
      }
      const result = await this.NasFileEntryModel.deleteOne({ _id: entry._id, deletedAt: entry.deletedAt });
      purged += result?.deletedCount || 0;
    }
    return { purged, failures };
  }

  async purgeStaleThumbnails(now) {
    const entries = await resolveDocuments(this.NasFileEntryModel.find({
      deletedAt: null,
      thumbnailStatus: { $in: STALE_THUMBNAIL_STATUSES },
      thumbnailObjectKey: { $ne: null },
      thumbnailUpdatedAt: { $ne: null, $lte: subtractDays(now, this.config.staleThumbnailRetentionDays) },
    }), this.batchLimit);
    let purged = 0;
    let failures = 0;
    for (const entry of entries) {
      if (!(await this.deleteThumbnail(entry.thumbnailObjectKey, entry._id))) {
        failures += 1;
        continue;
      }
      const result = await this.NasFileEntryModel.findOneAndUpdate(
        {
          _id: entry._id,
          deletedAt: null,
          thumbnailStatus: { $in: STALE_THUMBNAIL_STATUSES },
          thumbnailObjectKey: entry.thumbnailObjectKey,
        },
        {
          $set: {
            thumbnailObjectKey: null,
            thumbnailVersionFingerprint: null,
            thumbnailUpdatedAt: null,
          },
        },
        { new: false },
      );
      if (result) purged += 1;
    }
    return { purged, failures };
  }

  async deleteThumbnail(key, entryId) {
    if (!key) return true;
    try {
      await this.thumbnailStorage.deleteFile({ key });
      return true;
    } catch (error) {
      this.logger.warn?.('[NAS retention] thumbnail_cleanup_failed', {
        entryId: String(entryId),
        reason: error?.code || error?.name || 'unknown',
      });
      return false;
    }
  }
}

module.exports = {
  NasRetentionService,
  STALE_THUMBNAIL_STATUSES,
  TERMINAL_JOB_STATUSES,
};
