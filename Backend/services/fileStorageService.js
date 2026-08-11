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
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const {
  FileStorageValidationError,
  assertManagedS3Key,
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

const createS3Client = (config) => new S3Client({
  region: config.region,
  ...(config.credentials ? { credentials: config.credentials } : {}),
});

const createFileStorageService = ({ config, client = createS3Client(config), signUrl = getSignedUrl } = {}) => {
  if (!config?.bucketName || !config?.prefix) {
    throw new FileStorageValidationError('File storage configuration is required.');
  }

  const managedKey = (key) => assertManagedS3Key(key, config.prefix);
  const send = async (command) => {
    try {
      return await client.send(command);
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

    async getDownloadUrl({ key, fileName, disposition = 'attachment', expiresIn = config.downloadUrlTtlSeconds } = {}) {
      const managedS3Key = managedKey(key);
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
  buildContentDisposition,
  buildDownloadDisposition,
  createFileStorageService,
  createS3Client,
  mapS3Error,
};
