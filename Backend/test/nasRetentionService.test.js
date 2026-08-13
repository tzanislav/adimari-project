'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { NasRetentionService } = require('../services/nasRetentionService');

const date = (value) => new Date(value);

const matches = (record, filter) => Object.entries(filter).every(([key, expected]) => {
  const actual = record[key];
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    if ('$in' in expected && !expected.$in.includes(actual)) return false;
    if ('$lte' in expected && !(actual <= expected.$lte)) return false;
    if ('$ne' in expected && actual === expected.$ne) return false;
    return true;
  }
  return actual === expected;
});

const createModel = (records) => ({
  find(filter) {
    let matching = records.filter((record) => matches(record, filter));
    const query = {
      sort() { return query; },
      limit(count) { matching = matching.slice(0, count); return query; },
      lean: async () => matching.map((record) => ({ ...record })),
    };
    return query;
  },
  async updateOne(filter, update) {
    const record = records.find((candidate) => matches(candidate, filter));
    if (record) Object.assign(record, update.$set || {});
    return { matchedCount: record ? 1 : 0 };
  },
  async deleteMany(filter) {
    const removable = records.filter((record) => matches(record, filter));
    removable.forEach((record) => records.splice(records.indexOf(record), 1));
    return { deletedCount: removable.length };
  },
  async deleteOne(filter) {
    const index = records.findIndex((candidate) => matches(candidate, filter));
    if (index >= 0) records.splice(index, 1);
    return { deletedCount: index >= 0 ? 1 : 0 };
  },
  async findOneAndUpdate(filter, update) {
    const record = records.find((candidate) => matches(candidate, filter));
    if (record) Object.assign(record, update.$set || {});
    return record || null;
  },
});

test('retention schedules TTL expiry and removes only old catalogue-owned thumbnails', async () => {
  const now = date('2026-09-01T12:00:00.000Z');
  const jobs = [
    { _id: 'job-old', status: 'completed', completedAt: date('2026-07-01T12:00:00.000Z'), purgeAfter: null },
    { _id: 'job-current', status: 'in_progress', updatedAt: now, purgeAfter: null },
  ];
  const audits = [
    { _id: 'audit-old', createdAt: date('2025-01-01T12:00:00.000Z'), purgeAfter: null },
    { _id: 'audit-current', createdAt: date('2026-08-31T12:00:00.000Z'), purgeAfter: null },
  ];
  const entries = [
    {
      _id: 'entry-deleted',
      deletedAt: date('2026-07-01T12:00:00.000Z'),
      thumbnailObjectKey: 'nas-thumbnails/entries/deleted.jpg',
      thumbnailStatus: 'stale',
      thumbnailUpdatedAt: date('2026-07-01T12:00:00.000Z'),
    },
    {
      _id: 'entry-stale',
      deletedAt: null,
      thumbnailObjectKey: 'nas-thumbnails/entries/stale.jpg',
      thumbnailStatus: 'stale',
      thumbnailUpdatedAt: date('2026-08-01T12:00:00.000Z'),
    },
    {
      _id: 'entry-current',
      deletedAt: null,
      thumbnailObjectKey: 'nas-thumbnails/entries/current.jpg',
      thumbnailStatus: 'ready',
      thumbnailUpdatedAt: date('2026-01-01T12:00:00.000Z'),
    },
  ];
  const deletedKeys = [];
  const service = new NasRetentionService({
    NasTransferJobModel: createModel(jobs),
    NasAuditEventModel: createModel(audits),
    NasFileEntryModel: createModel(entries),
    thumbnailStorage: { async deleteFile({ key }) { deletedKeys.push(key); } },
    config: {
      terminalJobRetentionDays: 30,
      auditRetentionDays: 365,
      deletedEntryRetentionDays: 30,
      staleThumbnailRetentionDays: 14,
    },
    now: () => now,
    logger: { warn() {} },
  });

  const summary = await service.runOnce();

  assert.deepEqual(summary, {
    jobsPurged: 1,
    auditsPurged: 1,
    deletedEntriesPurged: 1,
    staleThumbnailsPurged: 1,
    cleanupFailures: 0,
  });
  assert.deepEqual(deletedKeys.sort(), [
    'nas-thumbnails/entries/deleted.jpg',
    'nas-thumbnails/entries/stale.jpg',
  ]);
  assert.deepEqual(jobs.map((job) => job._id), ['job-current']);
  assert.deepEqual(audits.map((event) => event._id), ['audit-current']);
  assert.equal(entries.some((entry) => entry._id === 'entry-deleted'), false);
  const stale = entries.find((entry) => entry._id === 'entry-stale');
  assert.equal(stale.thumbnailObjectKey, null);
  assert.equal(stale.thumbnailVersionFingerprint, null);
  assert.equal(entries.find((entry) => entry._id === 'entry-current').thumbnailObjectKey, 'nas-thumbnails/entries/current.jpg');
});

test('retention keeps a catalogue row when its thumbnail deletion fails', async () => {
  const entries = [{
    _id: 'entry-failed-delete',
    deletedAt: date('2026-07-01T12:00:00.000Z'),
    thumbnailObjectKey: 'nas-thumbnails/entries/unavailable.jpg',
    thumbnailStatus: 'stale',
    thumbnailUpdatedAt: date('2026-07-01T12:00:00.000Z'),
  }];
  const warnings = [];
  const service = new NasRetentionService({
    NasTransferJobModel: createModel([]),
    NasAuditEventModel: createModel([]),
    NasFileEntryModel: createModel(entries),
    thumbnailStorage: { async deleteFile() { throw new Error('storage unavailable'); } },
    config: {
      terminalJobRetentionDays: 30,
      auditRetentionDays: 365,
      deletedEntryRetentionDays: 30,
      staleThumbnailRetentionDays: 14,
    },
    now: () => date('2026-09-01T12:00:00.000Z'),
    logger: { warn(message, detail) { warnings.push({ message, detail }); } },
  });

  const summary = await service.runOnce();

  assert.equal(summary.deletedEntriesPurged, 0);
  assert.equal(summary.cleanupFailures, 1);
  assert.equal(entries.length, 1);
  assert.equal(warnings.length, 1);
});
