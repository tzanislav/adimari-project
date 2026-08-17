'use strict';

const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');

const {
  buildDownloadDisposition,
  createFileStorageService,
  mapS3Error,
} = require('../services/fileStorageService');
const { FileStorageValidationError } = require('../services/fileStorageValidation');

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

test('allows a File Sync prefix only through the dedicated share operations', async () => {
  const commands = [];
  const service = createFileStorageService({
    config: {
      ...config,
      shareablePrefixes: ['files/', 'files-sync/'],
    },
    client: {
      send: async (command) => {
        commands.push(command);
        return { ContentLength: 456 };
      },
    },
    signUrl: async (_client, command) => {
      commands.push(command);
      return 'https://signed.example/file-sync-download';
    },
  });

  await assert.rejects(
    service.headFile({ key: 'files-sync/nas/photo.jpg' }),
    FileStorageValidationError,
  );
  await assert.rejects(
    service.getDownloadUrl({ key: 'files-sync/nas/photo.jpg', fileName: 'photo.jpg' }),
    FileStorageValidationError,
  );

  const object = await service.headShareableFile({ key: 'files-sync/nas/photo.jpg' });
  const url = await service.getShareableDownloadUrl({
    key: 'files-sync/nas/photo.jpg',
    fileName: 'photo.jpg',
  });

  assert.equal(object.ContentLength, 456);
  assert.equal(url, 'https://signed.example/file-sync-download');
  assert.equal(commands[0].constructor.name, 'HeadObjectCommand');
  assert.equal(commands[0].input.Key, 'files-sync/nas/photo.jpg');
  assert.equal(commands[1].constructor.name, 'GetObjectCommand');
  assert.equal(commands[1].input.Key, 'files-sync/nas/photo.jpg');
});

test('calculates managed usage without counting hidden folder markers as files', async () => {
  const service = createFileStorageService({
    config,
    client: {
      send: async () => ({
        Contents: [
          { Key: 'files/Projects/.keep', Size: 0, LastModified: new Date('2026-01-01') },
          { Key: 'files/Projects/Plans/floor-plan.pdf', Size: 2048, LastModified: new Date('2026-02-01') },
        ],
        IsTruncated: false,
      }),
    },
  });

  const result = await service.getUsageStats();
  assert.deepEqual({ fileCount: result.fileCount, folderCount: result.folderCount, totalBytes: result.totalBytes }, {
    fileCount: 1,
    folderCount: 2,
    totalBytes: 2048,
  });
  assert.equal(result.lastModified.toISOString(), '2026-02-01T00:00:00.000Z');
});

test('recursively deletes a folder in S3 delete batches', async () => {
  const commands = [];
  const service = createFileStorageService({
    config,
    client: {
      send: async (command) => {
        commands.push(command);
        if (command.constructor.name === 'ListObjectsV2Command') {
          return {
            Contents: [{ Key: 'files/Projects/Plans/floor-plan.pdf' }, { Key: 'files/Projects/Plans/.keep' }],
            IsTruncated: false,
          };
        }
        return { Errors: [] };
      },
    },
  });

  const result = await service.deleteFolder({ folder: 'Projects' });
  assert.equal(result.deletedCount, 2);
  assert.equal(commands[1].constructor.name, 'DeleteObjectsCommand');
  assert.deepEqual(commands[1].input.Delete.Objects, [
    { Key: 'files/Projects/Plans/floor-plan.pdf' },
    { Key: 'files/Projects/Plans/.keep' },
  ]);
});

test('creates a bounded recursive folder-share snapshot without folder markers', async () => {
  const commands = [];
  const service = createFileStorageService({
    config,
    client: {
      send: async (command) => {
        commands.push(command);
        return {
          Contents: [
            { Key: 'files/Projects/.keep', Size: 0 },
            { Key: 'files/Projects/floor-plan.pdf', Size: 12, ETag: 'floor-plan' },
            { Key: 'files/Projects/Plans/.keep', Size: 0 },
            { Key: 'files/Projects/Plans/elevation.pdf', Size: 18, ETag: 'elevation' },
          ],
          IsTruncated: false,
        };
      },
    },
  });

  const snapshot = await service.listFolderShareSnapshot({
    folder: 'Projects',
    maxFiles: 10,
    maxBytes: 100,
  });

  assert.equal(commands[0].constructor.name, 'ListObjectsV2Command');
  assert.equal(commands[0].input.Prefix, 'files/Projects/');
  assert.equal(snapshot.prefix, 'files/Projects/');
  assert.equal(snapshot.totalBytes, 30);
  assert.deepEqual(snapshot.files.map(({ key, archivePath, size, eTag }) => ({ key, archivePath, size, eTag })), [
    { key: 'files/Projects/floor-plan.pdf', archivePath: 'floor-plan.pdf', size: 12, eTag: 'floor-plan' },
    { key: 'files/Projects/Plans/elevation.pdf', archivePath: 'Plans/elevation.pdf', size: 18, eTag: 'elevation' },
  ]);
});

test('rejects folder-share snapshots that exceed configured limits', async () => {
  const service = createFileStorageService({
    config,
    client: {
      send: async () => ({
        Contents: [
          { Key: 'files/Projects/one.pdf', Size: 10, ETag: 'one' },
          { Key: 'files/Projects/two.pdf', Size: 10, ETag: 'two' },
        ],
        IsTruncated: false,
      }),
    },
  });

  await assert.rejects(
    service.listFolderShareSnapshot({ folder: 'Projects', maxFiles: 1, maxBytes: 100 }),
    (error) => error.code === 'FOLDER_SHARE_TOO_MANY_FILES' && error.status === 413,
  );
  await assert.rejects(
    service.listFolderShareSnapshot({ folder: 'Projects', maxFiles: 10, maxBytes: 15 }),
    (error) => error.code === 'FOLDER_SHARE_TOO_LARGE' && error.status === 413,
  );
});

test('streams a snapshot object with its ETag as an S3 If-Match precondition', async () => {
  let capturedCommand;
  const service = createFileStorageService({
    config: { ...config, shareablePrefixes: ['files/'] },
    client: {
      send: async (command) => {
        capturedCommand = command;
        return { Body: Readable.from([Buffer.from('snapshot')]) };
      },
    },
  });

  const stream = await service.getShareableFileStream({
    key: 'files/Projects/brief.pdf',
    eTag: '"abc123"',
  });
  const contents = [];
  for await (const chunk of stream) contents.push(chunk);

  assert.equal(capturedCommand.constructor.name, 'GetObjectCommand');
  assert.equal(capturedCommand.input.Key, 'files/Projects/brief.pdf');
  assert.equal(capturedCommand.input.IfMatch, '"abc123"');
  assert.equal(Buffer.concat(contents).toString(), 'snapshot');
});

test('refuses to read a folder-share manifest row without its snapshot ETag', async () => {
  const service = createFileStorageService({
    config: { ...config, shareablePrefixes: ['files/'] },
    client: { send: async () => ({ Body: Readable.from([]) }) },
  });

  await assert.rejects(
    service.getShareableFileStream({ key: 'files/Projects/brief.pdf' }),
    (error) => error.code === 'FOLDER_SHARE_SNAPSHOT_INVALID' && error.status === 500,
  );
});
