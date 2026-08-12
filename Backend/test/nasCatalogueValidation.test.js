'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_INDEX_BATCH_ENTRIES,
  normalizeCatalogueChangeBatch,
  normalizeIndexBatch,
  normalizeIndexCompletion,
  normalizeIndexStart,
} = require('../services/nasCatalogueValidation');

const SCAN_ID = 'a9d24d65-1a96-4f65-aa06-40c74c5934ac';

const entry = (overrides = {}) => ({
  relativePath: '2026/preview.jpg',
  parentPath: '2026',
  name: 'preview.jpg',
  entryType: 'file',
  sizeBytes: 1024,
  modifiedAt: '2026-08-12T12:00:00.000Z',
  versionFingerprint: '8de0f1:400',
  contentType: 'image/jpeg',
  previewKind: 'image',
  ...overrides,
});

test('accepts one bounded, path-consistent connector index batch', () => {
  const batch = normalizeIndexBatch({ scanId: SCAN_ID.toUpperCase(), entries: [entry()] });
  assert.equal(batch.scanId, SCAN_ID);
  assert.equal(batch.entries[0].relativePath, '2026/preview.jpg');
  assert.equal(batch.entries[0].modifiedAt.toISOString(), '2026-08-12T12:00:00.000Z');
});

test('rejects native paths, inconsistent entry components, and unbounded batches', () => {
  assert.throws(() => normalizeIndexBatch({ scanId: SCAN_ID, entries: [entry({ relativePath: 'C:\\secret.txt' })] }));
  assert.throws(() => normalizeIndexBatch({ scanId: SCAN_ID, entries: [entry({ name: 'other.jpg' })] }));
  assert.throws(() => normalizeIndexBatch({
    scanId: SCAN_ID,
    entries: Array.from({ length: MAX_INDEX_BATCH_ENTRIES + 1 }, (_, index) => entry({
      relativePath: `folder/${index}.txt`, parentPath: 'folder', name: `${index}.txt`,
    })),
  }));
});

test('uses exact scan start and completion envelopes', () => {
  assert.deepEqual(normalizeIndexStart({ scanId: SCAN_ID }), { scanId: SCAN_ID });
  assert.deepEqual(normalizeIndexCompletion({ scanId: SCAN_ID, entryCount: 2 }), {
    scanId: SCAN_ID,
    entryCount: 2,
  });
  assert.throws(() => normalizeIndexCompletion({ scanId: SCAN_ID, entryCount: -1 }));
});

test('accepts safe relative watcher changes and rejects native or loose payloads', () => {
  const batch = normalizeCatalogueChangeBatch({
    connectorRootId: 'office-projects',
    changes: [
      { operation: 'upsert', entry: entry() },
      { operation: 'delete', relativePath: 'old-folder', recursive: true },
    ],
  });
  assert.equal(batch.connectorRootId, 'office-projects');
  assert.equal(batch.changes[0].entry.relativePath, '2026/preview.jpg');
  assert.deepEqual(batch.changes[1], { operation: 'delete', relativePath: 'old-folder', recursive: true });
  assert.throws(() => normalizeCatalogueChangeBatch({
    connectorRootId: 'office-projects',
    changes: [{ operation: 'delete', relativePath: 'C:\\secret.txt', recursive: false }],
  }));
  assert.throws(() => normalizeCatalogueChangeBatch({
    connectorRootId: 'office-projects',
    changes: [{ operation: 'delete', relativePath: 'old', recursive: false, nativePath: 'C:\\old' }],
  }));
});
