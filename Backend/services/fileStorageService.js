'use strict';

const {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const {
  FileStorageValidationError,
  assertManagedS3Key,
  assertS3KeyWithinPrefixes,
  createManagedS3Key,
  normalizeContentType,
  normalizeFileName,
  normalizeFolderPath,
} = require('./fileStorageValidation');

class FileStorageError extends Error {
  constructor({ code, message, status = 502, cause }) {
    super(message, cause ? { cause } : undefined);
    this.name = 'FileStorageError';
    this.code = code;
    this.status = status;
  }
}

const mapS3Error = (error) => {
  if (error instanceof FileStorageError || error instanceof FileStorageValidationError) {
    return error;
  }

  const code = error?.name || error?.Code || error?.code;
  const mapped = {
    NoSuchKey: ['FILE_NOT_FOUND', 'The requested file was not found.', 404],
    NotFound: ['FILE_NOT_FOUND', 'The requested file was not found.', 404],
    NoSuchBucket: ['FILE_STORAGE_UNAVAILABLE', 'The file storage bucket is unavailable.', 503],
    AccessDenied: ['FILE_STORAGE_ACCESS_DENIED', 'File storage access was denied.', 502],
    PreconditionFailed: ['FILE_CONFLICT', 'The file changed before the operation completed.', 409],
    ConditionalRequestConflict: ['FILE_CONFLICT', 'The file changed before the operation completed.', 409],
    EntityTooLarge: ['FILE_TOO_LARGE', 'The file exceeds the configured storage limit.', 413],
    InvalidRequest: ['FILE_STORAGE_INVALID_REQUEST', 'The file storage request is invalid.', 400],
    InvalidArgument: ['FILE_STORAGE_INVALID_REQUEST', 'The file storage request is invalid.', 400],
  }[code] || ['FILE_STORAGE_ERROR', 'The file storage operation failed.', 502];

  return new FileStorageError({
    code: mapped[0],
    message: mapped[1],
    status: mapped[2],
    cause: error,
  });
};

const normalizeUploadId = (value) => {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new FileStorageValidationError('Multipart upload ID is invalid.');
  }

  return value;
};

const normalizePartNumbers = (value) => {
  if (!Array.isArray(value) || !value.length || value.length > 1_000) {
    throw new FileStorageValidationError('Part-number batch must contain between 1 and 1,000 parts.');
  }

  const numbers = value.map((partNumber) => Number(partNumber));
  if (numbers.some((partNumber) => !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000)
    || new Set(numbers).size !== numbers.length) {
    throw new FileStorageValidationError('Part numbers must be unique integers from 1 through 10,000.');
  }

  return numbers;
};

const normalizeCompletedParts = (value) => {
  if (!Array.isArray(value) || !value.length || value.length > 10_000) {
    throw new FileStorageValidationError('Completed multipart-upload parts are invalid.');
  }

  const parts = value.map((part) => ({
    PartNumber: Number(part?.partNumber),
    ETag: typeof part?.eTag === 'string' ? part.eTag : '',
  }));
  if (parts.some((part) => !Number.isInteger(part.PartNumber) || part.PartNumber < 1 || part.PartNumber > 10_000 || !part.ETag)
    || new Set(parts.map((part) => part.PartNumber)).size !== parts.length) {
    throw new FileStorageValidationError('Each completed part must contain a unique part number and ETag.');
  }

  return parts.sort((left, right) => left.PartNumber - right.PartNumber);
};

const encodeCopySource = (bucketName, key) => `/${bucketName}/${encodeURIComponent(key).replace(/%2F/g, '/')}`;

const buildContentDisposition = (fileName, dispositionType = 'attachment') => {
  const normalizedFileName = normalizeFileName(fileName);
  const fallback = normalizedFileName
    .replace(/[\\"]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(normalizedFileName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${dispositionType}; filename="${fallback || 'download'}"; filename*=UTF-8''${encoded}`;
};

const buildDownloadDisposition = (fileName) => buildContentDisposition(fileName, 'attachment');
const SHARE_ARCHIVE_UPLOAD_PART_SIZE_BYTES = 16 * 1024 * 1024;

const createS3Client = (config) => new S3Client({
  region: config.region,
  ...(config.credentials ? { credentials: config.credentials } : {}),
});

const createFileStorageService = ({ config, client = createS3Client(config), signUrl = getSignedUrl } = {}) => {
  if (!config?.bucketName || !config?.prefix) {
    throw new FileStorageValidationError('File storage configuration is required.');
  }

  const managedKey = (key) => assertManagedS3Key(key, config.prefix);
  const shareableKey = (key) => assertS3KeyWithinPrefixes(
    key,
    config.shareablePrefixes || [config.prefix],
  );
  const archiveKey = (key) => assertManagedS3Key(key, config.shareArchivePrefix || 'file-share-archives/');
  const send = async (command, options) => {
    try {
      return await client.send(command, options);
    } catch (error) {
      throw mapS3Error(error);
    }
  };
  const sign = async (command, expiresIn) => {
    try {
      return await signUrl(client, command, { expiresIn });
    } catch (error) {
      throw mapS3Error(error);
    }
  };
  const createDownloadUrl = async ({
    key,
    fileName,
    disposition = 'attachment',
    expiresIn = config.downloadUrlTtlSeconds,
  } = {}, keyValidator = managedKey) => {
    const managedS3Key = keyValidator(key);
    if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > config.downloadUrlTtlSeconds) {
      throw new FileStorageValidationError('Download URL expiry is invalid.');
    }
    if (!['attachment', 'inline'].includes(disposition)) {
      throw new FileStorageValidationError('Download disposition is invalid.');
    }

    return sign(new GetObjectCommand({
      Bucket: config.bucketName,
      Key: managedS3Key,
      ResponseContentDisposition: buildContentDisposition(fileName, disposition),
    }), expiresIn);
  };

  return {
    async listFolder({ folder = '', continuationToken, maxKeys = 100 } = {}) {
      const normalizedFolder = normalizeFolderPath(folder);
      const boundedMaxKeys = Number(maxKeys);
      if (!Number.isInteger(boundedMaxKeys) || boundedMaxKeys < 1 || boundedMaxKeys > 1_000) {
        throw new FileStorageValidationError('List page size must be an integer from 1 through 1,000.');
      }

      const prefix = `${config.prefix}${normalizedFolder ? `${normalizedFolder}/` : ''}`;
      const result = await send(new ListObjectsV2Command({
        Bucket: config.bucketName,
        Prefix: prefix,
        Delimiter: '/',
        MaxKeys: boundedMaxKeys,
        ...(continuationToken ? { ContinuationToken: String(continuationToken) } : {}),
      }));

      return {
        folder: normalizedFolder,
        files: (result.Contents || [])
          .filter((object) => object.Key && object.Key !== prefix && object.Key !== `${prefix}.keep`)
          .map((object) => ({
            key: object.Key,
            name: object.Key.slice(prefix.length),
            size: object.Size,
            eTag: object.ETag,
            lastModified: object.LastModified,
            storageClass: object.StorageClass,
          })),
        folders: (result.CommonPrefixes || []).map(({ Prefix }) => ({
          name: Prefix.slice(prefix.length, -1),
          prefix: Prefix,
        })),
        nextContinuationToken: result.NextContinuationToken || null,
      };
    },

    async listAllFolders() {
      const folders = new Set();
      let continuationToken;

      do {
        const result = await send(new ListObjectsV2Command({
          Bucket: config.bucketName,
          Prefix: config.prefix,
          MaxKeys: 1_000,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }));

        (result.Contents || []).forEach((object) => {
          if (!object.Key || !object.Key.startsWith(config.prefix)) return;
          const parts = object.Key.slice(config.prefix.length).split('/').filter(Boolean);
          for (let index = 1; index < parts.length; index += 1) {
            folders.add(parts.slice(0, index).join('/'));
          }
        });
        continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
      } while (continuationToken);

      return Array.from(folders).sort((left, right) => left.localeCompare(right));
    },

    // Folder shares use a recursively listed, point-in-time manifest.  The
    // caller stores each ETag and the archive worker sends it back as If-Match
    // when reading, so a replacement cannot silently change the shared ZIP.
    async listFolderShareSnapshot({ folder, maxFiles, maxBytes } = {}) {
      const normalizedFolder = normalizeFolderPath(folder);
      if (!normalizedFolder) {
        throw new FileStorageValidationError('A non-root folder path is required for sharing.');
      }
      if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) {
        throw new FileStorageValidationError('Folder-share file limit is invalid.');
      }
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new FileStorageValidationError('Folder-share size limit is invalid.');
      }

      const prefix = `${config.prefix}${normalizedFolder}/`;
      let continuationToken;
      const files = [];
      let totalBytes = 0;

      do {
        const result = await send(new ListObjectsV2Command({
          Bucket: config.bucketName,
          Prefix: prefix,
          MaxKeys: 1_000,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }));

        for (const object of result.Contents || []) {
          if (!object.Key || object.Key === prefix || object.Key === `${prefix}.keep`) continue;
          const key = managedKey(object.Key);
          if (key.endsWith('/.keep')) continue;
          const size = Number(object.Size);
          if (!Number.isSafeInteger(size) || size < 0) {
            throw new FileStorageError({
              code: 'FILE_STORAGE_INVALID_OBJECT',
              message: 'A file in the folder has invalid storage metadata.',
              status: 502,
            });
          }
          if (typeof object.ETag !== 'string' || !object.ETag) {
            throw new FileStorageError({
              code: 'FILE_STORAGE_INVALID_OBJECT',
              message: 'A file in the folder cannot be safely snapshotted.',
              status: 502,
            });
          }

          if (files.length >= maxFiles) {
            throw new FileStorageError({
              code: 'FOLDER_SHARE_TOO_MANY_FILES',
              message: `Folders with more than ${maxFiles.toLocaleString()} files cannot be shared as one archive.`,
              status: 413,
            });
          }
          if (totalBytes > maxBytes - size) {
            throw new FileStorageError({
              code: 'FOLDER_SHARE_TOO_LARGE',
              message: 'This folder exceeds the maximum size for a shared archive.',
              status: 413,
            });
          }

          files.push({
            key,
            archivePath: key.slice(prefix.length),
            size,
            eTag: object.ETag,
            lastModified: object.LastModified || null,
          });
          totalBytes += size;
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
      } while (continuationToken);

      return {
        folder: normalizedFolder,
        prefix,
        files: files.sort((left, right) => left.archivePath.localeCompare(right.archivePath)),
        totalBytes,
      };
    },

    async getUsageStats() {
      const folders = new Set();
      let continuationToken;
      let fileCount = 0;
      let totalBytes = 0;
      let lastModified = null;

      do {
        const result = await send(new ListObjectsV2Command({
          Bucket: config.bucketName,
          Prefix: config.prefix,
          MaxKeys: 1_000,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }));

        (result.Contents || []).forEach((object) => {
          if (!object.Key || !object.Key.startsWith(config.prefix)) return;
          const relativeKey = object.Key.slice(config.prefix.length);
          const parts = relativeKey.split('/').filter(Boolean);
          for (let index = 1; index < parts.length; index += 1) {
            folders.add(parts.slice(0, index).join('/'));
          }
          if (!relativeKey || relativeKey.endsWith('/.keep')) return;
          fileCount += 1;
          totalBytes += Number(object.Size) || 0;
          if (object.LastModified && (!lastModified || object.LastModified > lastModified)) {
            lastModified = object.LastModified;
          }
        });
        continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
      } while (continuationToken);

      return { fileCount, folderCount: folders.size, totalBytes, lastModified };
    },

    async headFile({ key }) {
      const managedS3Key = managedKey(key);
      return send(new HeadObjectCommand({ Bucket: config.bucketName, Key: managedS3Key }));
    },

    // Kept separate from headFile so only the explicitly authorized sharing
    // paths can inspect File Sync's external namespace.
    async headShareableFile({ key }) {
      const managedS3Key = shareableKey(key);
      return send(new HeadObjectCommand({ Bucket: config.bucketName, Key: managedS3Key }));
    },

    async createMultipartUpload({ folder = '', fileName, contentType } = {}) {
      const key = createManagedS3Key({ prefix: config.prefix, folder, fileName });
      const result = await send(new CreateMultipartUploadCommand({
        Bucket: config.bucketName,
        Key: key,
        ContentType: normalizeContentType(contentType),
      }));

      if (!result.UploadId) {
        throw new FileStorageError({
          code: 'FILE_MULTIPART_UPLOAD_UNAVAILABLE',
          message: 'File storage did not return a multipart upload ID.',
          status: 502,
        });
      }

      return { key, uploadId: result.UploadId };
    },

    // Empty files use a regular PutObject request rather than a zero-byte
    // multipart upload. The request body is always empty, so user file bytes
    // never pass through the API server.
    async putEmptyFile({ key, contentType, preventOverwrite = false } = {}) {
      const managedS3Key = managedKey(key);
      const normalizedContentType = normalizeContentType(contentType);
      const result = await send(new PutObjectCommand({
        Bucket: config.bucketName,
        Key: managedS3Key,
        Body: Buffer.alloc(0),
        ContentLength: 0,
        ContentType: normalizedContentType,
        ...(preventOverwrite === true ? { IfNoneMatch: '*' } : {}),
      }));

      return {
        key: managedS3Key,
        ContentLength: 0,
        ETag: result.ETag || null,
        ContentType: normalizedContentType,
        VersionId: result.VersionId || null,
      };
    },

    async createMultipartPartUrls({ key, uploadId, partNumbers, expiresIn = config.uploadPartUrlTtlSeconds } = {}) {
      const managedS3Key = managedKey(key);
      const normalizedUploadId = normalizeUploadId(uploadId);
      const normalizedPartNumbers = normalizePartNumbers(partNumbers);
      if (!Number.isInteger(expiresIn) || expiresIn < 1 || expiresIn > config.uploadPartUrlTtlSeconds) {
        throw new FileStorageValidationError('Upload-part URL expiry is invalid.');
      }

      const urls = await Promise.all(normalizedPartNumbers.map(async (partNumber) => ({
        partNumber,
        url: await sign(new UploadPartCommand({
          Bucket: config.bucketName,
          Key: managedS3Key,
          UploadId: normalizedUploadId,
          PartNumber: partNumber,
        }), expiresIn),
      })));

      return { key: managedS3Key, uploadId: normalizedUploadId, expiresIn, parts: urls };
    },

    async completeMultipartUpload({ key, uploadId, parts, preventOverwrite = false } = {}) {
      const managedS3Key = managedKey(key);
      return send(new CompleteMultipartUploadCommand({
        Bucket: config.bucketName,
        Key: managedS3Key,
        UploadId: normalizeUploadId(uploadId),
        MultipartUpload: { Parts: normalizeCompletedParts(parts) },
        ...(preventOverwrite ? { IfNoneMatch: '*' } : {}),
      }));
    },

    async abortMultipartUpload({ key, uploadId } = {}) {
      const managedS3Key = managedKey(key);
      return send(new AbortMultipartUploadCommand({
        Bucket: config.bucketName,
        Key: managedS3Key,
        UploadId: normalizeUploadId(uploadId),
      }));
    },

    async getDownloadUrl(options = {}) {
      return createDownloadUrl(options);
    },

    // Kept separate from getDownloadUrl for the same reason as headShareableFile.
    async getShareableDownloadUrl(options = {}) {
      return createDownloadUrl(options, shareableKey);
    },

    async getShareableFileStream({ key, eTag, versionId, abortSignal } = {}) {
      const managedS3Key = shareableKey(key);
      if (typeof eTag !== 'string' || !eTag) {
        throw new FileStorageError({
          code: 'FOLDER_SHARE_SNAPSHOT_INVALID',
          message: 'The folder-share snapshot cannot be read safely.',
          status: 500,
        });
      }
      const result = await send(new GetObjectCommand({
        Bucket: config.bucketName,
        Key: managedS3Key,
        IfMatch: eTag,
        ...(versionId ? { VersionId: String(versionId) } : {}),
      }), abortSignal ? { abortSignal } : undefined);
      if (!result.Body || typeof result.Body.pipe !== 'function') {
        throw new FileStorageError({
          code: 'FILE_STORAGE_INVALID_RESPONSE',
          message: 'File storage returned an unreadable file stream.',
          status: 502,
        });
      }
      return result.Body;
    },

    createShareArchiveKey({ shareId, attempt } = {}) {
      const normalizedShareId = String(shareId || '');
      if (!/^[a-f\d]{24}$/i.test(normalizedShareId)) {
        throw new FileStorageValidationError('Folder-share ID is invalid.');
      }
      const normalizedAttempt = Number(attempt);
      if (!Number.isSafeInteger(normalizedAttempt) || normalizedAttempt < 1 || normalizedAttempt > 100_000) {
        throw new FileStorageValidationError('Folder-share archive attempt is invalid.');
      }
      return archiveKey(`${config.shareArchivePrefix || 'file-share-archives/'}${normalizedShareId}-${normalizedAttempt}.zip`);
    },

    async uploadShareArchive({ key, body, onProgress, onUploadCreated } = {}) {
      const managedS3Key = archiveKey(key);
      if (!body || typeof body.pipe !== 'function') {
        throw new FileStorageValidationError('Folder-share archive stream is invalid.');
      }

      try {
        const upload = new Upload({
          client,
          params: {
            Bucket: config.bucketName,
            Key: managedS3Key,
            Body: body,
            ContentType: 'application/zip',
          },
          // Folder archives are intentionally serialized one at a time. A
          // 16 MiB maximum part keeps the worker's upload buffer modest even
          // when normal browser uploads use much larger multipart parts.
          // Do not inherit the browser-upload part size: it may be as low as
          // S3's 5 MiB minimum, which would exceed the 10,000-part limit for
          // an otherwise permitted 100 GiB archive.
          partSize: SHARE_ARCHIVE_UPLOAD_PART_SIZE_BYTES,
          queueSize: 1,
          leavePartsOnError: false,
        });
        if (typeof onProgress === 'function') {
          upload.on('httpUploadProgress', onProgress);
        }
        if (typeof onUploadCreated === 'function') {
          onUploadCreated(upload);
        }
        const result = await upload.done();
        return { key: managedS3Key, eTag: result.ETag || null, versionId: result.VersionId || null };
      } catch (error) {
        throw mapS3Error(error);
      }
    },

    async getShareArchiveDownloadUrl(options = {}) {
      return createDownloadUrl(options, archiveKey);
    },

    async headShareArchive({ key, abortSignal } = {}) {
      const managedS3Key = archiveKey(key);
      return send(
        new HeadObjectCommand({ Bucket: config.bucketName, Key: managedS3Key }),
        abortSignal ? { abortSignal } : undefined,
      );
    },

    async deleteShareArchive({ key, abortSignal } = {}) {
      const managedS3Key = archiveKey(key);
      await send(
        new DeleteObjectCommand({ Bucket: config.bucketName, Key: managedS3Key }),
        abortSignal ? { abortSignal } : undefined,
      );
      return { key: managedS3Key };
    },

    async moveFile({ sourceKey, destinationFolder = '', destinationFileName } = {}) {
      const managedSourceKey = managedKey(sourceKey);
      const destinationKey = createManagedS3Key({
        prefix: config.prefix,
        folder: destinationFolder,
        fileName: destinationFileName,
      });
      if (managedSourceKey === destinationKey) {
        throw new FileStorageValidationError('Source and destination keys must differ.');
      }

      const copyResult = await send(new CopyObjectCommand({
        Bucket: config.bucketName,
        Key: destinationKey,
        CopySource: encodeCopySource(config.bucketName, managedSourceKey),
        MetadataDirective: 'COPY',
      }));
      await send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: managedSourceKey }));

      return { sourceKey: managedSourceKey, destinationKey, copyResult };
    },

    async deleteFile({ key } = {}) {
      const managedS3Key = managedKey(key);
      return send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: managedS3Key }));
    },

    // Reserved for an explicitly enabled development reset. This is not
    // exposed through browser-facing routes and clears only this service's
    // already-isolated managed prefix.
    async deleteAllManagedFiles() {
      const prefix = config.prefix;
      let continuationToken;
      let deletedCount = 0;
      do {
        const result = await send(new ListObjectsV2Command({
          Bucket: config.bucketName,
          Prefix: prefix,
          MaxKeys: 1_000,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }));
        const objects = (result.Contents || []).filter(({ Key }) => Key && Key.startsWith(prefix));
        if (objects.length) {
          const deletion = await send(new DeleteObjectsCommand({
            Bucket: config.bucketName,
            Delete: { Objects: objects.map(({ Key }) => ({ Key })), Quiet: true },
          }));
          if (deletion.Errors?.length) {
            throw new FileStorageError({
              code: 'FILE_PREFIX_DELETE_INCOMPLETE',
              message: 'Some managed objects could not be deleted.',
              status: 502,
            });
          }
          deletedCount += objects.length;
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
      } while (continuationToken);
      return { prefix, deletedCount };
    },

    async deleteFolder({ folder } = {}) {
      const normalizedFolder = normalizeFolderPath(folder);
      if (!normalizedFolder) {
        throw new FileStorageValidationError('The root folder cannot be deleted.');
      }

      const prefix = `${config.prefix}${normalizedFolder}/`;
      let continuationToken;
      let deletedCount = 0;

      do {
        const result = await send(new ListObjectsV2Command({
          Bucket: config.bucketName,
          Prefix: prefix,
          MaxKeys: 1_000,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }));
        const objects = (result.Contents || []).filter(({ Key }) => Key && Key.startsWith(prefix));
        if (objects.length) {
          const deletion = await send(new DeleteObjectsCommand({
            Bucket: config.bucketName,
            Delete: { Objects: objects.map(({ Key }) => ({ Key })), Quiet: true },
          }));
          if (deletion.Errors?.length) {
            throw new FileStorageError({
              code: 'FILE_FOLDER_DELETE_INCOMPLETE',
              message: 'Some objects in the folder could not be deleted.',
              status: 502,
            });
          }
          deletedCount += objects.length;
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : null;
      } while (continuationToken);

      return { folder: normalizedFolder, prefix, deletedCount };
    },

    async createFolderMarker({ folder } = {}) {
      const normalizedFolder = normalizeFolderPath(folder);
      if (!normalizedFolder) {
        throw new FileStorageValidationError('A non-root folder path is required.');
      }

      const key = createManagedS3Key({ prefix: config.prefix, folder: normalizedFolder, fileName: '.keep' });
      await send(new PutObjectCommand({
        Bucket: config.bucketName,
        Key: key,
        ContentLength: 0,
        ContentType: 'application/x-file-server-folder-marker',
      }));
      return { folder: normalizedFolder, key };
    },
  };
};

module.exports = {
  FileStorageError,
  SHARE_ARCHIVE_UPLOAD_PART_SIZE_BYTES,
  buildContentDisposition,
  buildDownloadDisposition,
  createFileStorageService,
  createS3Client,
  mapS3Error,
};
