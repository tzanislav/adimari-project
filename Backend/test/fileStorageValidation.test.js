'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FileStorageValidationError,
  MAX_S3_MULTIPART_PARTS,
  computeMultipartPartSize,
  createManagedS3Key,
  normalizeContentType,
  normalizeFolderPath,
} = require('../services/fileStorageValidation');

test('preserves real Unicode names while producing a safe managed S3 key', () => {
  const key = createManagedS3Key({
    prefix: 'files/',
    folder: 'Projects/Київ',
    fileName: 'Résumé final.pdf',
  });

  assert.equal(key, 'files/Projects/Київ/Résumé final.pdf');
});

test('rejects path traversal and path separators in file names', () => {
  assert.throws(() => normalizeFolderPath('../private'), FileStorageValidationError);
  assert.throws(
    () => createManagedS3Key({ prefix: 'files/', folder: 'Projects', fileName: '../secret.pdf' }),
    FileStorageValidationError,
  );
});

test('increases multipart part size to remain below the S3 part-count limit', () => {
  const fileSize = 50_000_000_000_000;
  const partSize = computeMultipartPartSize({ fileSize, preferredPartSize: 64 * 1024 * 1024 });

  assert.ok(partSize > 64 * 1024 * 1024);
  assert.ok(Math.ceil(fileSize / partSize) <= MAX_S3_MULTIPART_PARTS);
});

test('allows safe content types and rejects malformed values', () => {
  assert.equal(normalizeContentType('application/pdf'), 'application/pdf');
  assert.throws(() => normalizeContentType('application/pdf\nX-Test: injected'), FileStorageValidationError);
});
