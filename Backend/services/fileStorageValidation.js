'use strict';

const MAX_S3_KEY_BYTES = 1024;
const MAX_S3_MULTIPART_OBJECT_BYTES = 50_000_000_000_000;
const MIN_S3_MULTIPART_PART_BYTES = 5 * 1024 * 1024;
const MAX_S3_MULTIPART_PART_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_S3_MULTIPART_PARTS = 10_000;

class FileStorageValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FileStorageValidationError';
    this.code = 'FILE_STORAGE_VALIDATION_ERROR';
  }
}

const hasControlCharacters = (value) => /[\u0000-\u001F\u007F]/.test(value);

const requireString = (value, label) => {
  if (typeof value !== 'string') {
    throw new FileStorageValidationError(`${label} must be a string.`);
  }

  return value.normalize('NFC');
};

const normalizeManagedPrefix = (value) => {
  const prefix = requireString(value, 'S3 prefix');
  if (!prefix || prefix.startsWith('/') || prefix.includes('\\') || hasControlCharacters(prefix)) {
    throw new FileStorageValidationError('S3 prefix is invalid.');
  }

  const segments = prefix.replace(/\/$/, '').split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new FileStorageValidationError('S3 prefix must contain safe path segments.');
  }

  return `${segments.join('/')}/`;
};

const normalizeFolderPath = (value = '') => {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  const folder = requireString(value, 'Folder path');
  if (folder.startsWith('/') || folder.endsWith('/') || folder.includes('\\') || hasControlCharacters(folder)) {
    throw new FileStorageValidationError('Folder path is invalid.');
  }

  const segments = folder.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || !segment.trim())) {
    throw new FileStorageValidationError('Folder path must contain safe, non-empty segments.');
  }

  return segments.join('/');
};

const normalizeFileName = (value) => {
  const fileName = requireString(value, 'File name');
  if (!fileName || !fileName.trim() || fileName === '.' || fileName === '..'
    || fileName.includes('/') || fileName.includes('\\') || hasControlCharacters(fileName)) {
    throw new FileStorageValidationError('File name is invalid.');
  }

  if (Buffer.byteLength(fileName, 'utf8') > 255) {
    throw new FileStorageValidationError('File name must not exceed 255 UTF-8 bytes.');
  }

  return fileName;
};

const assertManagedS3Key = (value, prefix) => {
  const normalizedPrefix = normalizeManagedPrefix(prefix);
  const key = requireString(value, 'S3 key');
  if (!key.startsWith(normalizedPrefix)) {
    throw new FileStorageValidationError('S3 key is outside the managed file-server prefix.');
  }

  const suffix = key.slice(normalizedPrefix.length);
  if (!suffix || suffix.includes('\\') || hasControlCharacters(suffix)) {
    throw new FileStorageValidationError('S3 key is invalid.');
  }

  const segments = suffix.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new FileStorageValidationError('S3 key must contain safe path segments.');
  }

  if (Buffer.byteLength(key, 'utf8') > MAX_S3_KEY_BYTES) {
    throw new FileStorageValidationError(`S3 key must not exceed ${MAX_S3_KEY_BYTES} UTF-8 bytes.`);
  }

  return key;
};

// A deliberately narrow allow-list variant for workflows which need to
// reference a second, explicitly configured S3 namespace.  Callers must opt
// in to this helper; the normal file-manager operations continue to use
// assertManagedS3Key with the primary prefix only.
const assertS3KeyWithinPrefixes = (value, prefixes) => {
  if (!Array.isArray(prefixes) || prefixes.length === 0) {
    throw new FileStorageValidationError('At least one managed S3 prefix is required.');
  }

  const key = requireString(value, 'S3 key');
  const normalizedPrefixes = prefixes.map((prefix) => normalizeManagedPrefix(prefix));
  const matchingPrefix = normalizedPrefixes.find((prefix) => key.startsWith(prefix));

  if (!matchingPrefix) {
    throw new FileStorageValidationError('S3 key is outside the allowed share prefixes.');
  }

  return assertManagedS3Key(key, matchingPrefix);
};

const createManagedS3Key = ({ prefix, folder = '', fileName }) => {
  const normalizedPrefix = normalizeManagedPrefix(prefix);
  const normalizedFolder = normalizeFolderPath(folder);
  const normalizedFileName = normalizeFileName(fileName);
  const key = `${normalizedPrefix}${normalizedFolder ? `${normalizedFolder}/` : ''}${normalizedFileName}`;
  return assertManagedS3Key(key, normalizedPrefix);
};

const computeMultipartPartSize = ({ fileSize, preferredPartSize }) => {
  if (!Number.isSafeInteger(fileSize) || fileSize < 1 || fileSize > MAX_S3_MULTIPART_OBJECT_BYTES) {
    throw new FileStorageValidationError('File size is outside the S3 multipart-upload range.');
  }

  if (!Number.isSafeInteger(preferredPartSize)
    || preferredPartSize < MIN_S3_MULTIPART_PART_BYTES
    || preferredPartSize > MAX_S3_MULTIPART_PART_BYTES) {
    throw new FileStorageValidationError('Preferred multipart part size is outside the S3 range.');
  }

  const requiredSize = Math.ceil(fileSize / MAX_S3_MULTIPART_PARTS);
  const partSize = Math.max(preferredPartSize, requiredSize, MIN_S3_MULTIPART_PART_BYTES);
  if (partSize > MAX_S3_MULTIPART_PART_BYTES) {
    throw new FileStorageValidationError('File cannot be uploaded within S3 multipart-upload limits.');
  }

  return partSize;
};

const normalizeContentType = (value) => {
  if (value === undefined || value === null || value === '') {
    return 'application/octet-stream';
  }

  const contentType = requireString(value, 'Content type');
  if (contentType.length > 255 || hasControlCharacters(contentType)
    || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:;\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=[!#$%&'*+.^_`|~0-9A-Za-z-]+)*$/.test(contentType)) {
    throw new FileStorageValidationError('Content type is invalid.');
  }

  return contentType;
};

module.exports = {
  FileStorageValidationError,
  MAX_S3_KEY_BYTES,
  MAX_S3_MULTIPART_OBJECT_BYTES,
  MAX_S3_MULTIPART_PART_BYTES,
  MAX_S3_MULTIPART_PARTS,
  MIN_S3_MULTIPART_PART_BYTES,
  assertManagedS3Key,
  assertS3KeyWithinPrefixes,
  computeMultipartPartSize,
  createManagedS3Key,
  normalizeContentType,
  normalizeFileName,
  normalizeFolderPath,
  normalizeManagedPrefix,
};
