'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDownloadDisposition,
  createFileStorageService,
  mapS3Error,
} = require('../services/fileStorageService');

const config = {
  region: 'eu-west-1',
  bucketName: 'adimari-private-files-prod',
  prefix: 'files/',
  uploadPartUrlTtlSeconds: 900,
  downloadUrlTtlSeconds: 300,
};

test('lists S3-backed folders without returning prefix marker objects as files', async () => {
  const service = createFileStorageService({
    config,
    client: {
      send: async () => ({
        Contents: [
          { Key: 'files/Projects/', Size: 0 },
          { Key: 'files/Projects/.keep', Size: 0 },
          { Key: 'files/Projects/proposal.pdf', Size: 123, ETag: 'etag' },
        ],
        CommonPrefixes: [{ Prefix: 'files/Projects/Archive/' }],
      }),
    },
  });

  const result = await service.listFolder({ folder: 'Projects' });
  assert.deepEqual(result.files.map((file) => file.name), ['proposal.pdf']);
  assert.deepEqual(result.folders, [{ name: 'Archive', prefix: 'files/Projects/Archive/' }]);
});

test('uses an S3 no-overwrite precondition when completing a new multipart upload', async () => {
  let capturedCommand;
  const service = createFileStorageService({
    config,
    client: {
      send: async (command) => {
        capturedCommand = command;
        return {};
      },
    },
  });

  await service.completeMultipartUpload({
    key: 'files/Projects/proposal.pdf',
    uploadId: 'upload-id',
    parts: [{ partNumber: 1, eTag: 'etag-1' }],
    preventOverwrite: true,
  });

  assert.equal(capturedCommand.input.IfNoneMatch, '*');
  assert.deepEqual(capturedCommand.input.MultipartUpload.Parts, [{ PartNumber: 1, ETag: 'etag-1' }]);
});

test('generates attachment disposition and maps S3 access failures without exposing raw errors', () => {
  const disposition = buildDownloadDisposition('Résumé.pdf');
  assert.match(disposition, /^attachment;/);
  assert.match(disposition, /filename\*=UTF-8''R%C3%A9sum%C3%A9.pdf/);

  const mapped = mapS3Error({ name: 'AccessDenied', message: 'raw AWS detail' });
  assert.equal(mapped.code, 'FILE_STORAGE_ACCESS_DENIED');
  assert.equal(mapped.message, 'File storage access was denied.');
});
