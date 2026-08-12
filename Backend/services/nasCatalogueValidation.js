'use strict';

const {
  NasConnectorValidationError,
  normalizeRelativePath,
} = require('./nasConnectorValidation');

const MAX_INDEX_BATCH_ENTRIES = 250;
const SCAN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^[A-Za-z0-9._:-]{1,512}$/;

const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const assertExactKeys = (value, keys) => {
  if (!isPlainObject(value)
    || Object.keys(value).length !== keys.size
    || Object.keys(value).some((key) => !keys.has(key))) {
    throw new NasConnectorValidationError('Indexing payload is invalid.');
  }
};

const normalizeScanId = (value) => {
  if (typeof value !== 'string' || !SCAN_ID_PATTERN.test(value)) {
    throw new NasConnectorValidationError('Scan ID is invalid.');
  }
  return value.toLowerCase();
};

const normalizeModifiedAt = (value) => {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new NasConnectorValidationError('Indexed modified time is invalid.');
  }
  return new Date(value);
};

const normalizeIndexEntry = (value) => {
  assertExactKeys(value, new Set([
    'relativePath', 'parentPath', 'name', 'entryType', 'sizeBytes',
    'modifiedAt', 'versionFingerprint', 'contentType', 'previewKind',
  ]));

  const relativePath = normalizeRelativePath(value.relativePath, { allowEmpty: false });
  const segments = relativePath.split('/');
  const expectedParentPath = segments.slice(0, -1).join('/');
  const name = segments.at(-1);
  const parentPath = normalizeRelativePath(value.parentPath, { allowEmpty: true });
  if (parentPath !== expectedParentPath || value.name !== name) {
    throw new NasConnectorValidationError('Indexed path fields are inconsistent.');
  }
  if (!['file', 'folder'].includes(value.entryType)
    || (value.entryType === 'folder' && value.sizeBytes !== null)
    || (value.entryType === 'file' && (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0))
    || typeof value.versionFingerprint !== 'string'
    || !FINGERPRINT_PATTERN.test(value.versionFingerprint)
    || typeof value.contentType !== 'string'
    || value.contentType.length > 255
    || !['none', 'image'].includes(value.previewKind)
    || (value.previewKind === 'image' && value.entryType !== 'file')) {
    throw new NasConnectorValidationError('Indexed entry is invalid.');
  }

  return {
    relativePath,
    parentPath,
    name,
    entryType: value.entryType,
    sizeBytes: value.sizeBytes,
    modifiedAt: normalizeModifiedAt(value.modifiedAt),
    versionFingerprint: value.versionFingerprint,
    contentType: value.contentType,
    previewKind: value.previewKind,
  };
};

const normalizeIndexBatch = (body) => {
  assertExactKeys(body, new Set(['scanId', 'entries']));
  if (!Array.isArray(body.entries) || body.entries.length < 1 || body.entries.length > MAX_INDEX_BATCH_ENTRIES) {
    throw new NasConnectorValidationError('Index batch size is invalid.');
  }
  const entries = body.entries.map(normalizeIndexEntry);
  if (new Set(entries.map((entry) => entry.relativePath)).size !== entries.length) {
    throw new NasConnectorValidationError('Index batch contains duplicate paths.');
  }
  return { scanId: normalizeScanId(body.scanId), entries };
};

const normalizeIndexStart = (body) => {
  assertExactKeys(body, new Set(['scanId']));
  return { scanId: normalizeScanId(body.scanId) };
};

const normalizeIndexCompletion = (body) => {
  assertExactKeys(body, new Set(['scanId', 'entryCount']));
  if (!Number.isSafeInteger(body.entryCount) || body.entryCount < 0 || body.entryCount > 10_000_000) {
    throw new NasConnectorValidationError('Indexed entry count is invalid.');
  }
  return { scanId: normalizeScanId(body.scanId), entryCount: body.entryCount };
};

// Change tracking deliberately reuses the exact metadata contract used by a
// full scan.  The only additional information is whether a known relative
// path was observed or removed.  This keeps the backend unaware of native
// Windows/UNC paths while allowing the connector to send small batches rather
// than rescanning the NAS for every edit.
const normalizeCatalogueChangeBatch = (body) => {
  assertExactKeys(body, new Set(['connectorRootId', 'changes']));
  if (typeof body.connectorRootId !== 'string' || body.connectorRootId.length < 1 || body.connectorRootId.length > 200
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(body.connectorRootId)
    || !Array.isArray(body.changes) || body.changes.length < 1 || body.changes.length > MAX_INDEX_BATCH_ENTRIES) {
    throw new NasConnectorValidationError('Catalogue change batch is invalid.');
  }

  const changes = body.changes.map((change) => {
    if (!isPlainObject(change) || typeof change.operation !== 'string') {
      throw new NasConnectorValidationError('Catalogue change is invalid.');
    }
    if (change.operation === 'upsert') {
      assertExactKeys(change, new Set(['operation', 'entry']));
      return { operation: 'upsert', entry: normalizeIndexEntry(change.entry) };
    }
    if (change.operation === 'delete') {
      assertExactKeys(change, new Set(['operation', 'relativePath', 'recursive']));
      if (typeof change.recursive !== 'boolean') {
        throw new NasConnectorValidationError('Catalogue deletion is invalid.');
      }
      return {
        operation: 'delete',
        relativePath: normalizeRelativePath(change.relativePath, { allowEmpty: false }),
        recursive: change.recursive,
      };
    }
    throw new NasConnectorValidationError('Catalogue change operation is invalid.');
  });

  if (new Set(changes.map((change) => change.operation === 'upsert'
    ? `u:${change.entry.relativePath}`
    : `d:${change.relativePath}`)).size !== changes.length) {
    throw new NasConnectorValidationError('Catalogue change batch contains duplicate changes.');
  }
  return { connectorRootId: body.connectorRootId, changes };
};

module.exports = {
  MAX_INDEX_BATCH_ENTRIES,
  normalizeCatalogueChangeBatch,
  normalizeIndexBatch,
  normalizeIndexCompletion,
  normalizeIndexStart,
  normalizeScanId,
};
