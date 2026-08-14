'use strict';

const express = require('express');
const { authenticate, authorizeRole } = require('../auth/authMiddleware');
const FileShare = require('../models/fileShare');
const NasFileEntry = require('../models/nasFileEntry');
const NasStorageRoot = require('../models/nasStorageRoot');
const NasTransferJob = require('../models/nasTransferJob');
const { createShareToken } = require('../services/fileShareToken');
const { FileStorageError } = require('../services/fileStorageService');
const { createNasStorageService } = require('../services/nasStorageService');
const {
  FileStorageValidationError,
  computeMultipartPartSize,
  normalizeContentType,
  normalizeFileName,
} = require('../services/fileStorageValidation');
const {
  CACHE_FOR_DOWNLOAD_JOB_TYPE,
  WRITE_UPLOAD_TO_NAS_JOB_TYPE,
  serializeTransferJob,
} = require('../services/nasConnectorJobQueue');
const {
  NasConnectorValidationError,
  assertObjectId,
  normalizeRelativePath,
  normalizeWindowsDestinationFileName,
} = require('../services/nasConnectorValidation');

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const MAX_PAGE_OFFSET = 10_000;

class NasCatalogueApiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'NasCatalogueApiError';
    this.code = code;
    this.status = status;
  }
}

const toPlainObject = (value) => (
  typeof value?.toObject === 'function' ? value.toObject() : { ...value }
);

const objectIdOf = (value) => String(value?._id || value?.id || value || '');

const currentActorUid = (user) => user?.uid || user?.user_id || user?.email || null;

const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const parsePageSize = (value) => {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (typeof value !== 'string' || !/^\d{1,3}$/.test(value)) {
    throw new NasCatalogueApiError('NAS_CATALOGUE_REQUEST_INVALID', 'Page size is invalid.');
  }
  const size = Number(value);
  if (size < 1 || size > MAX_PAGE_SIZE) {
    throw new NasCatalogueApiError('NAS_CATALOGUE_REQUEST_INVALID', 'Page size is invalid.');
  }
  return size;
};

// A page-offset cursor is intentionally simple for this small internal
// catalogue. It contains no path or storage data and is bounded so a caller
// cannot cause an unbounded database skip.
const parseCursor = (value) => {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value !== 'string' || !/^\d{1,5}$/.test(value)) {
    throw new NasCatalogueApiError('NAS_CATALOGUE_REQUEST_INVALID', 'Page cursor is invalid.');
  }
  const offset = Number(value);
  if (offset > MAX_PAGE_OFFSET) {
    throw new NasCatalogueApiError('NAS_CATALOGUE_REQUEST_INVALID', 'Page cursor is invalid.');
  }
  return offset;
};

const parseSearchQuery = (value) => {
  if (typeof value !== 'string') {
    throw new NasCatalogueApiError('NAS_CATALOGUE_REQUEST_INVALID', 'Search query is required.');
  }
  const query = value.normalize('NFC').trim();
  if (query.length < 2 || query.length > 120 || /[\u0000-\u001F\u007F]/.test(query)) {
    throw new NasCatalogueApiError('NAS_CATALOGUE_REQUEST_INVALID', 'Search query must be 2 to 120 characters.');
  }
  return query;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const serializeRoot = (root) => {
  const value = toPlainObject(root);
  const connector = value.connectorId && typeof value.connectorId === 'object'
    ? toPlainObject(value.connectorId)
    : null;
  return {
    id: objectIdOf(value),
    name: value.displayName,
    // Storage roots retain only administrative status. Availability is
    // derived from the connector's heartbeat-owned observation.
    status: value.status === 'disabled' ? 'disabled' : 'active',
    availability: connector?.status === 'active'
      ? 'online'
      : connector?.status === 'revoked' || value.status === 'disabled'
        ? 'disabled'
        : 'offline',
    uploadsEnabled: Boolean(value.uploadsEnabled),
    lastIndexedAt: value.lastIndexedAt || null,
    lastFullScanAt: value.lastFullScanAt || null,
  };
};

const serializeEntry = (entry) => {
  const value = toPlainObject(entry);
  return {
    id: objectIdOf(value),
    rootId: String(value.storageRootId),
    relativePath: value.relativePath,
    parentPath: value.parentPath,
    name: value.name,
    entryType: value.entryType,
    sizeBytes: value.sizeBytes ?? null,
    modifiedAt: value.modifiedAt || null,
    contentType: value.contentType || null,
    previewKind: value.previewKind,
    availabilityStatus: value.availabilityStatus,
    thumbnailStatus: value.thumbnailStatus,
    lastIndexedAt: value.lastIndexedAt || null,
  };
};

const serializeShare = (share) => {
  const value = toPlainObject(share);
  delete value.tokenHash;
  return {
    id: objectIdOf(value),
    originalFileName: value.originalFileName,
    deliveryStatus: value.deliveryStatus,
    cacheExpiresAt: value.cacheExpiresAt || null,
    createdAt: value.createdAt || null,
  };
};

const parseDeliveryDisposition = (value) => {
  if (value === 'inline' || value === 'attachment') return value;
  throw new NasCatalogueApiError('NAS_DELIVERY_REQUEST_INVALID', 'Delivery disposition must be inline or attachment.');
};

const resolveArrayQuery = async (query, { sort, skip, limit } = {}) => {
  let current = query;
  if (sort && typeof current?.sort === 'function') current = current.sort(sort);
  if (Number.isInteger(skip) && skip > 0 && typeof current?.skip === 'function') current = current.skip(skip);
  if (Number.isInteger(limit) && typeof current?.limit === 'function') current = current.limit(limit);
  if (typeof current?.lean === 'function') current = current.lean();
  return current;
};

const resolveOneQuery = async (query) => {
  let current = query;
  if (typeof current?.lean === 'function') current = current.lean();
  return current;
};

const sendError = (res, error) => {
  if (error instanceof NasCatalogueApiError || error instanceof NasConnectorValidationError) {
    return res.status(error.status || 400).json({ code: error.code, error: error.message });
  }
  if (error instanceof FileStorageError) {
    return res.status(error.status || 503).json({
      code: 'NAS_DELIVERY_STORAGE_UNAVAILABLE',
      error: 'Temporary file storage is unavailable.',
    });
  }
  if (error instanceof FileStorageValidationError) {
    return res.status(400).json({ code: 'NAS_UPLOAD_REQUEST_INVALID', error: 'The upload request is invalid.' });
  }
  if (error?.code === 11000) {
    return res.status(409).json({
      code: 'NAS_UPLOAD_DESTINATION_RESERVED',
      error: 'Another upload is already in progress for that destination.',
    });
  }
  if (error?.name === 'CastError') {
    return res.status(400).json({ code: 'NAS_CATALOGUE_REQUEST_INVALID', error: 'The catalogue request is invalid.' });
  }
  console.error('NAS catalogue route failed:', error?.code || error?.name || 'unknown');
  return res.status(500).json({ code: 'NAS_CATALOGUE_OPERATION_FAILED', error: 'The catalogue request failed.' });
};

const createNasCatalogueRoutes = (dependencies = {}) => {
  const NasStorageRootModel = dependencies.NasStorageRootModel || NasStorageRoot;
  const NasFileEntryModel = dependencies.NasFileEntryModel || NasFileEntry;
  const FileShareModel = dependencies.FileShareModel || FileShare;
  const NasTransferJobModel = dependencies.NasTransferJobModel || NasTransferJob;
  const jobQueue = dependencies.jobQueue || null;
  const nasConfig = dependencies.nasConfig || null;
  const fileServerConfig = dependencies.fileServerConfig || null;
  const storageSet = dependencies.storageSet || null;
  let cacheStorage = dependencies.cacheStorage || storageSet?.cache || null;
  let thumbnailStorage = dependencies.thumbnailStorage || storageSet?.thumbnails || null;
  let stagingStorage = dependencies.stagingStorage || storageSet?.staging || null;
  const authenticateMiddleware = dependencies.authenticateMiddleware || authenticate;
  const authorizeMiddleware = dependencies.authorizeMiddleware || authorizeRole(['admin', 'moderator']);
  const router = express.Router();

  const findBrowsableRoot = async (rootId) => {
    const root = await resolveOneQuery(NasStorageRootModel.findOne({
      _id: rootId,
      status: { $in: ['active', 'offline'] },
    }));
    if (!root) {
      throw new NasCatalogueApiError('NAS_CATALOGUE_ROOT_NOT_FOUND', 'The requested NAS root is unavailable.', 404);
    }
    return root;
  };

  const getCacheStorage = () => {
    if (cacheStorage) return cacheStorage;
    if (!nasConfig || !fileServerConfig) {
      throw new NasCatalogueApiError('NAS_DELIVERY_UNAVAILABLE', 'NAS file delivery is not configured.', 503);
    }
    cacheStorage = createNasStorageService({
      nasConfig,
      fileServerConfig,
      prefix: nasConfig.cachePrefix,
    });
    return cacheStorage;
  };

  const getThumbnailStorage = () => {
    if (thumbnailStorage) return thumbnailStorage;
    if (!nasConfig || !fileServerConfig) {
      throw new NasCatalogueApiError('NAS_DELIVERY_UNAVAILABLE', 'NAS image delivery is not configured.', 503);
    }
    thumbnailStorage = createNasStorageService({
      nasConfig,
      fileServerConfig,
      prefix: nasConfig.thumbnailPrefix,
    });
    return thumbnailStorage;
  };

  const getStagingStorage = () => {
    if (stagingStorage) return stagingStorage;
    if (!nasConfig || !fileServerConfig) {
      throw new NasCatalogueApiError('NAS_UPLOAD_UNAVAILABLE', 'NAS uploads are not configured.', 503);
    }
    stagingStorage = createNasStorageService({
      nasConfig,
      fileServerConfig,
      prefix: nasConfig.uploadStagingPrefix,
      overrides: {
        uploadPartUrlTtlSeconds: nasConfig.browserUploadUrlTtlSeconds,
      },
    });
    return stagingStorage;
  };

  const cacheIsCurrent = (entry, checkedAt = new Date()) => (
    Boolean(entry.cacheObjectKey)
    && Boolean(entry.cacheExpiresAt)
    && new Date(entry.cacheExpiresAt) > checkedAt
    && Boolean(entry.versionFingerprint)
    && entry.cacheVersionFingerprint === entry.versionFingerprint
  );

  const thumbnailIsCurrent = (entry) => (
    entry.thumbnailStatus === 'ready'
    && Boolean(entry.thumbnailObjectKey)
    && Boolean(entry.versionFingerprint)
    && entry.thumbnailVersionFingerprint === entry.versionFingerprint
  );

  const createShareRecord = async ({ entry, actorUid, expiresAt, cacheKey = null }) => {
    let createdShare;
    let rawToken;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { token, tokenHash } = createShareToken();
      try {
        createdShare = await FileShareModel.create({
          sourceType: 'nas_file',
          nasFileEntryId: objectIdOf(entry),
          deliveryStatus: cacheKey ? 'ready' : 'preparing',
          ...(cacheKey ? { s3Key: cacheKey } : {}),
          cacheExpiresAt: expiresAt,
          originalFileName: entry.name,
          tokenHash,
          createdBy: actorUid,
        });
        rawToken = token;
        break;
      } catch (error) {
        if (error?.code !== 11000 || attempt === 2) throw error;
      }
    }
    return { share: createdShare, rawToken };
  };

  // Both public Share links and authenticated Open/Download actions create a
  // lightweight delivery record.  It either points at a still-current cache
  // object or queues exactly one connector cache job for a new temporary one.
  const createNasDelivery = async ({ entry, root, actorUid }) => {
    if (!jobQueue || !nasConfig) {
      throw new NasCatalogueApiError('NAS_DELIVERY_UNAVAILABLE', 'NAS file delivery is not configured.', 503);
    }
    if (!root.connectorId || !root.connectorRootId) {
      throw new NasCatalogueApiError('NAS_DELIVERY_UNAVAILABLE', 'The NAS file cannot be delivered.', 409);
    }

    const checkedAt = new Date();
    const reusable = cacheIsCurrent(entry, checkedAt);
    const expiresAt = reusable
      ? new Date(entry.cacheExpiresAt)
      : new Date(checkedAt.getTime() + (nasConfig.cacheRetentionDays * 24 * 60 * 60 * 1000));
    const created = await createShareRecord({
      entry,
      actorUid,
      expiresAt,
      cacheKey: reusable ? entry.cacheObjectKey : null,
    });
    if (reusable) {
      console.info('[NAS cache] delivery_reused', {
        entryId: objectIdOf(entry),
        shareId: objectIdOf(created.share),
      });
      return created;
    }

    try {
      const queued = await jobQueue.enqueueCacheForDownload({
        connectorId: root.connectorId,
        storageRootId: root._id || root.id,
        connectorRootId: root.connectorRootId,
        fileEntryId: objectIdOf(entry),
        fileShareId: created.share._id || created.share.id,
        requestedBy: actorUid,
      });
      console.info('[NAS cache] share_queued', {
        entryId: objectIdOf(entry),
        shareId: objectIdOf(created.share),
        jobId: String(queued.job?._id || queued.job?.id || ''),
        created: queued.created,
      });
      return created;
    } catch (error) {
      await FileShareModel.findOneAndUpdate(
        { _id: created.share._id || created.share.id, status: 'active' },
        { $set: { deliveryStatus: 'failed' } },
        { new: false },
      );
      throw error;
    }
  };

  const findOwnedDelivery = async ({ shareId, actorUid }) => resolveOneQuery(FileShareModel.findOne({
    _id: shareId,
    sourceType: 'nas_file',
    status: 'active',
    createdBy: actorUid,
  }));

  const normalizeDeliveryState = async (share) => {
    if (!share || !share.cacheExpiresAt || new Date(share.cacheExpiresAt) > new Date() || share.deliveryStatus === 'expired') {
      return share;
    }
    const expired = await resolveOneQuery(FileShareModel.findOneAndUpdate(
      { _id: share._id || share.id, sourceType: 'nas_file', status: 'active' },
      { $set: { deliveryStatus: 'expired' } },
      { new: true },
    ));
    return expired || share;
  };

  const normalizeBrowserUploadRequest = (body) => {
    if (!isPlainObject(body)
      || Object.keys(body).length !== 4
      || !Object.prototype.hasOwnProperty.call(body, 'parentPath')
      || !Object.prototype.hasOwnProperty.call(body, 'fileName')
      || !Object.prototype.hasOwnProperty.call(body, 'sizeBytes')
      || !Object.prototype.hasOwnProperty.call(body, 'contentType')
      || !Number.isSafeInteger(body.sizeBytes)
      || body.sizeBytes < 1
      || body.sizeBytes > nasConfig.maxUploadBytes) {
      throw new NasCatalogueApiError('NAS_UPLOAD_REQUEST_INVALID', 'Choose a valid file within the configured upload limit.');
    }
    const fileName = normalizeFileName(body.fileName);
    try {
      return {
        parentPath: normalizeRelativePath(body.parentPath, { allowEmpty: true }),
        fileName: normalizeWindowsDestinationFileName(fileName),
        sizeBytes: body.sizeBytes,
        contentType: normalizeContentType(body.contentType),
      };
    } catch (error) {
      if (error instanceof NasConnectorValidationError) {
        throw new NasCatalogueApiError('NAS_UPLOAD_FILE_NAME_INVALID', error.message);
      }
      throw error;
    }
  };

  const findOwnedUploadJob = async ({ jobId, actorUid, statuses }) => resolveOneQuery(
    NasTransferJobModel.findOne({
      _id: jobId,
      type: WRITE_UPLOAD_TO_NAS_JOB_TYPE,
      requestedBy: actorUid,
      status: { $in: statuses },
    }),
  );

  router.use(authenticateMiddleware, authorizeMiddleware);

  router.get('/roots', async (req, res) => {
    try {
      let rootQuery = NasStorageRootModel.find({ status: { $in: ['active', 'offline'] } });
      if (typeof rootQuery?.populate === 'function') rootQuery = rootQuery.populate('connectorId', 'status');
      const roots = await resolveArrayQuery(rootQuery, { sort: { displayName: 1, _id: 1 } });
      return res.json({ roots: roots.map(serializeRoot) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // Browser uploads never receive a NAS path or an S3 key. The browser stages
  // its file under an opaque transfer-job ID, then the connector is assigned
  // that ID and performs the final local write.
  router.post('/roots/:rootId/uploads', async (req, res) => {
    let stagedJob = null;
    try {
      const actorUid = currentActorUid(req.user);
      if (!actorUid) {
        throw new NasCatalogueApiError('NAS_CATALOGUE_ACTOR_REQUIRED', 'Authenticated user identity is required.', 401);
      }
      if (!jobQueue || !nasConfig || !fileServerConfig) {
        throw new NasCatalogueApiError('NAS_UPLOAD_UNAVAILABLE', 'NAS uploads are not configured.', 503);
      }
      const rootId = assertObjectId(req.params.rootId, 'NAS root ID');
      const root = await findBrowsableRoot(rootId);
      if (!root.uploadsEnabled || !root.connectorId || !root.connectorRootId) {
        throw new NasCatalogueApiError('NAS_UPLOAD_DISABLED', 'Uploads are not enabled for this NAS root.', 409);
      }
      const request = normalizeBrowserUploadRequest(req.body);
      if (request.parentPath) {
        const parent = await resolveOneQuery(NasFileEntryModel.findOne({
          storageRootId: rootId,
          relativePath: request.parentPath,
          entryType: 'folder',
          deletedAt: null,
        }));
        if (!parent) {
          throw new NasCatalogueApiError('NAS_UPLOAD_FOLDER_NOT_FOUND', 'The selected NAS folder is no longer available.', 409);
        }
      }
      const relativeDestinationPath = request.parentPath
        ? request.parentPath + '/' + request.fileName
        : request.fileName;
      const existing = await resolveOneQuery(NasFileEntryModel.findOne({
        storageRootId: rootId,
        relativePath: relativeDestinationPath,
        deletedAt: null,
      }));
      if (existing) {
        throw new NasCatalogueApiError('NAS_UPLOAD_NAME_CONFLICT', 'A file or folder with this name already exists.', 409);
      }
      const partSize = computeMultipartPartSize({
        fileSize: request.sizeBytes,
        preferredPartSize: fileServerConfig.multipartPartSizeBytes,
      });
      stagedJob = await NasTransferJobModel.create({
        type: WRITE_UPLOAD_TO_NAS_JOB_TYPE,
        status: 'staging',
        connectorId: root.connectorId,
        storageRootId: rootId,
        connectorRootId: root.connectorRootId,
        requestedBy: actorUid,
        // The catalogue is eventually consistent with the NAS.  Reserve the
        // logical destination durably, rather than relying on a preceding
        // catalogue lookup to prevent two browser uploads from racing.
        idempotencyKey: `write:${rootId}:${relativeDestinationPath}`,
        payload: {
          relativeDestinationPath,
          expectedSize: request.sizeBytes,
          contentType: request.contentType,
        },
        progressStage: 'downloading_staging',
        progressBytes: 0,
        progressTotalBytes: request.sizeBytes,
      });
      const jobId = objectIdOf(stagedJob);
      const multipart = await getStagingStorage().createMultipartUpload({
        folder: 'jobs/' + jobId,
        fileName: 'content',
        contentType: request.contentType,
      });
      const updated = await NasTransferJobModel.findOneAndUpdate(
        { _id: jobId, status: 'staging', requestedBy: actorUid },
        { $set: { 'payload.stagingKey': multipart.key, 'payload.multipartUploadId': multipart.uploadId } },
        { new: true },
      );
      if (!updated) throw new NasCatalogueApiError('NAS_UPLOAD_UNAVAILABLE', 'The NAS upload could not be started.', 409);
      console.info('[NAS upload] staging_started', { jobId, rootId, actorUid });
      return res.status(201).json({ uploadId: jobId, partSize, maxParts: 10000 });
    } catch (error) {
      if (stagedJob) {
        await NasTransferJobModel.findOneAndUpdate(
          { _id: objectIdOf(stagedJob), status: 'staging' },
          {
            $set: { status: 'failed', completedAt: new Date(), errorCode: 'staging_start_failed' },
            $unset: { idempotencyKey: 1 },
          },
          { new: false },
        ).catch(() => {});
      }
      return sendError(res, error);
    }
  });

  router.post('/uploads/:uploadId/parts', async (req, res) => {
    try {
      const actorUid = currentActorUid(req.user);
      if (!actorUid) {
        throw new NasCatalogueApiError('NAS_CATALOGUE_ACTOR_REQUIRED', 'Authenticated user identity is required.', 401);
      }
      const uploadId = assertObjectId(req.params.uploadId, 'Upload ID');
      const job = await findOwnedUploadJob({ jobId: uploadId, actorUid, statuses: ['staging'] });
      if (!job?.payload?.stagingKey || !job?.payload?.multipartUploadId) {
        throw new NasCatalogueApiError('NAS_UPLOAD_NOT_FOUND', 'The active upload was not found.', 404);
      }
      const result = await getStagingStorage().createMultipartPartUrls({
        key: job.payload.stagingKey,
        uploadId: job.payload.multipartUploadId,
        partNumbers: req.body?.partNumbers,
        expiresIn: nasConfig.browserUploadUrlTtlSeconds,
      });
      return res.json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/uploads/:uploadId/complete', async (req, res) => {
    try {
      const actorUid = currentActorUid(req.user);
      if (!actorUid) {
        throw new NasCatalogueApiError('NAS_CATALOGUE_ACTOR_REQUIRED', 'Authenticated user identity is required.', 401);
      }
      const uploadId = assertObjectId(req.params.uploadId, 'Upload ID');
      const job = await findOwnedUploadJob({ jobId: uploadId, actorUid, statuses: ['staging', 'queued'] });
      if (!job) throw new NasCatalogueApiError('NAS_UPLOAD_NOT_FOUND', 'The active upload was not found.', 404);
      if (job.status === 'queued') return res.json({ job: serializeTransferJob(job) });
      if (!job.payload?.stagingKey || !job.payload?.multipartUploadId) {
        throw new NasCatalogueApiError('NAS_UPLOAD_NOT_FOUND', 'The active upload was not found.', 404);
      }
      await getStagingStorage().completeMultipartUpload({
        key: job.payload.stagingKey,
        uploadId: job.payload.multipartUploadId,
        parts: req.body?.parts,
        preventOverwrite: true,
      });
      const object = await getStagingStorage().headFile({ key: job.payload.stagingKey });
      if (Number(object.ContentLength) !== Number(job.payload.expectedSize)) {
        throw new NasCatalogueApiError('NAS_UPLOAD_OBJECT_INVALID', 'The staged upload does not match the chosen file.', 409);
      }
      const queuedAt = new Date();
      const queued = await NasTransferJobModel.findOneAndUpdate(
        { _id: uploadId, requestedBy: actorUid, type: WRITE_UPLOAD_TO_NAS_JOB_TYPE, status: 'staging' },
        {
          $set: {
            status: 'queued',
            progressStage: 'downloading_staging',
            progressBytes: 0,
            progressUpdatedAt: queuedAt,
          },
          $unset: { 'payload.multipartUploadId': 1 },
        },
        { new: true },
      );
      if (!queued) throw new NasCatalogueApiError('NAS_UPLOAD_NOT_FOUND', 'The active upload was not found.', 404);
      console.info('[NAS upload] staging_completed', { jobId: uploadId, connectorId: objectIdOf(queued.connectorId) });
      return res.json({ job: serializeTransferJob(queued) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post('/uploads/:uploadId/abort', async (req, res) => {
    try {
      const actorUid = currentActorUid(req.user);
      if (!actorUid) {
        throw new NasCatalogueApiError('NAS_CATALOGUE_ACTOR_REQUIRED', 'Authenticated user identity is required.', 401);
      }
      const uploadId = assertObjectId(req.params.uploadId, 'Upload ID');
      const job = await findOwnedUploadJob({ jobId: uploadId, actorUid, statuses: ['staging'] });
      if (!job) throw new NasCatalogueApiError('NAS_UPLOAD_NOT_FOUND', 'The active upload was not found.', 404);
      if (job.payload?.stagingKey && job.payload?.multipartUploadId) {
        await getStagingStorage().abortMultipartUpload({
          key: job.payload.stagingKey,
          uploadId: job.payload.multipartUploadId,
        });
      }
      await NasTransferJobModel.findOneAndUpdate(
        { _id: uploadId, requestedBy: actorUid, status: 'staging' },
        {
          $set: { status: 'cancelled', completedAt: new Date(), errorCode: 'browser_aborted' },
          $unset: { idempotencyKey: 1 },
        },
        { new: false },
      );
      console.info('[NAS upload] staging_aborted', { jobId: uploadId });
      return res.status(204).end();
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/uploads/:uploadId', async (req, res) => {
    try {
      const actorUid = currentActorUid(req.user);
      if (!actorUid) {
        throw new NasCatalogueApiError('NAS_CATALOGUE_ACTOR_REQUIRED', 'Authenticated user identity is required.', 401);
      }
      const uploadId = assertObjectId(req.params.uploadId, 'Upload ID');
      const job = await findOwnedUploadJob({
        jobId: uploadId,
        actorUid,
        statuses: ['staging', 'queued', 'assigned', 'accepted', 'in_progress', 'completed', 'failed'],
      });
      if (!job) throw new NasCatalogueApiError('NAS_UPLOAD_NOT_FOUND', 'The upload was not found.', 404);
      return res.json({ job: serializeTransferJob(job) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/roots/:rootId/entries', async (req, res) => {
    try {
      const rootId = assertObjectId(req.params.rootId, 'NAS root ID');
      const parentPath = normalizeRelativePath(req.query.parent || '', { allowEmpty: true });
      const limit = parsePageSize(req.query.limit);
      const offset = parseCursor(req.query.cursor);
      const root = await findBrowsableRoot(rootId);
      const entries = await resolveArrayQuery(NasFileEntryModel.find({
        storageRootId: rootId,
        parentPath,
        deletedAt: null,
      }), {
        // Folder sorts after file lexically, so descending puts folders first.
        sort: { entryType: -1, name: 1, _id: 1 },
        skip: offset,
        limit: limit + 1,
      });
      const hasMore = entries.length > limit;
      const page = entries.slice(0, limit).map(serializeEntry);
      return res.json({
        root: serializeRoot(root),
        parentPath,
        entries: page,
        nextCursor: hasMore ? String(offset + limit) : null,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/entries/:entryId', async (req, res) => {
    try {
      const entryId = assertObjectId(req.params.entryId, 'File entry ID');
      const entry = await resolveOneQuery(NasFileEntryModel.findOne({ _id: entryId, deletedAt: null }));
      if (!entry) {
        throw new NasCatalogueApiError('NAS_CATALOGUE_ENTRY_NOT_FOUND', 'The requested entry is unavailable.', 404);
      }
      await findBrowsableRoot(String(entry.storageRootId));
      return res.json({ entry: serializeEntry(entry) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // Image navigation is resolved by the catalogue, never by a browser path.
  // It stays inside the current authorized folder and returns only the closest
  // previous/next image names the user can already browse.
  router.get('/entries/:entryId/image-neighbors', async (req, res) => {
    try {
      const entryId = assertObjectId(req.params.entryId, 'File entry ID');
      const entry = await resolveOneQuery(NasFileEntryModel.findOne({
        _id: entryId,
        entryType: 'file',
        previewKind: 'image',
        deletedAt: null,
      }));
      if (!entry) {
        throw new NasCatalogueApiError('NAS_IMAGE_NOT_FOUND', 'The requested image is unavailable.', 404);
      }
      await findBrowsableRoot(String(entry.storageRootId));
      const filter = {
        storageRootId: entry.storageRootId,
        parentPath: entry.parentPath,
        entryType: 'file',
        previewKind: 'image',
        deletedAt: null,
      };
      const [previous, next] = await Promise.all([
        resolveArrayQuery(NasFileEntryModel.find({ ...filter, name: { $lt: entry.name } }), {
          sort: { name: -1, _id: -1 },
          limit: 1,
        }),
        resolveArrayQuery(NasFileEntryModel.find({ ...filter, name: { $gt: entry.name } }), {
          sort: { name: 1, _id: 1 },
          limit: 1,
        }),
      ]);
      return res.json({
        previous: previous[0] ? serializeEntry(previous[0]) : null,
        next: next[0] ? serializeEntry(next[0]) : null,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // A folder asks for thumbnails lazily.  A current thumbnail is permanent
  // until its image version changes; otherwise this queues one small serial
  // connector job and returns preparation state without exposing any path.
  router.post('/entries/:entryId/thumbnails', async (req, res) => {
    try {
      const actorUid = currentActorUid(req.user);
      if (!actorUid) {
        throw new NasCatalogueApiError('NAS_CATALOGUE_ACTOR_REQUIRED', 'Authenticated user identity is required.', 401);
      }
      if (!jobQueue || !nasConfig) {
        throw new NasCatalogueApiError('NAS_DELIVERY_UNAVAILABLE', 'NAS image delivery is not configured.', 503);
      }
      const entryId = assertObjectId(req.params.entryId, 'File entry ID');
      const entry = await resolveOneQuery(NasFileEntryModel.findOne({
        _id: entryId,
        entryType: 'file',
        previewKind: 'image',
        deletedAt: null,
      }));
      if (!entry) {
        throw new NasCatalogueApiError('NAS_IMAGE_NOT_FOUND', 'The requested image is unavailable.', 404);
      }
      const root = await findBrowsableRoot(String(entry.storageRootId));
      if (!root.connectorId || !root.connectorRootId) {
        throw new NasCatalogueApiError('NAS_DELIVERY_UNAVAILABLE', 'The NAS image cannot be prepared.', 409);
      }
      if (thumbnailIsCurrent(entry)) {
        const thumbnailUrl = await getThumbnailStorage().getDownloadUrl({
          key: entry.thumbnailObjectKey,
          fileName: `${entry.name}.jpg`,
          disposition: 'inline',
        });
        return res.json({ thumbnailStatus: 'ready', thumbnailUrl });
      }

      // A connector failure or an administrator cancellation is terminal for
      // this image version.  The file browser polls this endpoint while a
      // thumbnail is being prepared, so immediately treating a failed entry
      // as a fresh request would recreate the cancelled job forever.
      if (entry.thumbnailStatus === 'failed') {
        return res.json({ thumbnailStatus: 'failed' });
      }

      await NasFileEntryModel.findOneAndUpdate(
        { _id: entryId, versionFingerprint: entry.versionFingerprint, deletedAt: null },
        { $set: { thumbnailStatus: 'preparing' } },
        { new: false },
      );
      try {
        const queued = await jobQueue.enqueueThumbnail({
          connectorId: root.connectorId,
          storageRootId: root._id || root.id,
          connectorRootId: root.connectorRootId,
          fileEntryId: entryId,
          versionFingerprint: entry.versionFingerprint,
          requestedBy: actorUid,
        });
        if (queued.created) {
          console.info('[NAS thumbnail] queued', {
            entryId,
            jobId: String(queued.job?._id || queued.job?.id || ''),
          });
        }
        return res.status(202).json({ thumbnailStatus: 'preparing', retryAfterSeconds: 3 });
      } catch (error) {
        await NasFileEntryModel.findOneAndUpdate(
          { _id: entryId, versionFingerprint: entry.versionFingerprint, deletedAt: null },
          { $set: { thumbnailStatus: 'failed' } },
          { new: false },
        );
        throw error;
      }
    } catch (error) {
      return sendError(res, error);
    }
  });

  // A NAS share uses the existing public File Server share page. It is
  // immediately safe to copy, but remains "preparing" until the connector
  // has placed a temporary object in the NAS cache prefix.
  router.post('/entries/:entryId/shares', async (req, res) => {
    try {
      const actorUid = currentActorUid(req.user);
      if (!actorUid) {
        throw new NasCatalogueApiError('NAS_CATALOGUE_ACTOR_REQUIRED', 'Authenticated user identity is required.', 401);
      }
      if (!fileServerConfig?.publicBaseUrl) {
        throw new NasCatalogueApiError('NAS_DELIVERY_UNAVAILABLE', 'NAS file delivery is not configured.', 503);
      }

      const entryId = assertObjectId(req.params.entryId, 'File entry ID');
      const entry = await resolveOneQuery(NasFileEntryModel.findOne({
        _id: entryId,
        entryType: 'file',
        deletedAt: null,
      }));
      if (!entry) {
        throw new NasCatalogueApiError('NAS_CATALOGUE_ENTRY_NOT_FOUND', 'The requested file is unavailable.', 404);
      }
      const root = await findBrowsableRoot(String(entry.storageRootId));
      const { share, rawToken } = await createNasDelivery({ entry, root, actorUid });
      const url = new URL(`/file-download/${rawToken}`, fileServerConfig.publicBaseUrl).toString();
      return res.status(201).json({
        share: serializeShare(share),
        url,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // Authenticated actions deliberately use the same temporary cache as public
  // shares, but return a short-lived S3 URL rather than a share page.  This is
  // the foundation for normal Open/Download now and the image viewer later.
  router.post('/entries/:entryId/deliveries', async (req, res) => {
    try {
      const actorUid = currentActorUid(req.user);
      if (!actorUid) {
        throw new NasCatalogueApiError('NAS_CATALOGUE_ACTOR_REQUIRED', 'Authenticated user identity is required.', 401);
      }
      const disposition = parseDeliveryDisposition(req.body?.disposition);
      const entryId = assertObjectId(req.params.entryId, 'File entry ID');
      const entry = await resolveOneQuery(NasFileEntryModel.findOne({
        _id: entryId,
        entryType: 'file',
        deletedAt: null,
      }));
      if (!entry) {
        throw new NasCatalogueApiError('NAS_CATALOGUE_ENTRY_NOT_FOUND', 'The requested file is unavailable.', 404);
      }
      const root = await findBrowsableRoot(String(entry.storageRootId));
      const { share } = await createNasDelivery({ entry, root, actorUid });
      const delivery = serializeShare(share);
      if (share.deliveryStatus !== 'ready') {
        return res.status(202).json({ delivery, retryAfterSeconds: 3 });
      }
      const downloadUrl = await getCacheStorage().getDownloadUrl({
        key: share.s3Key,
        fileName: share.originalFileName,
        disposition,
      });
      return res.json({ delivery, downloadUrl });
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/deliveries/:shareId', async (req, res) => {
    try {
      const actorUid = currentActorUid(req.user);
      if (!actorUid) {
        throw new NasCatalogueApiError('NAS_CATALOGUE_ACTOR_REQUIRED', 'Authenticated user identity is required.', 401);
      }
      const shareId = assertObjectId(req.params.shareId, 'Delivery ID');
      const disposition = parseDeliveryDisposition(req.query.disposition);
      const share = await normalizeDeliveryState(await findOwnedDelivery({ shareId, actorUid }));
      if (!share) {
        throw new NasCatalogueApiError('NAS_DELIVERY_NOT_FOUND', 'The requested delivery is unavailable.', 404);
      }
      const delivery = serializeShare(share);
      if (share.deliveryStatus === 'preparing') {
        return res.status(202).json({ delivery, retryAfterSeconds: 3 });
      }
      if (share.deliveryStatus === 'expired') {
        throw new NasCatalogueApiError('NAS_DELIVERY_EXPIRED', 'This temporary delivery has expired.', 410);
      }
      if (share.deliveryStatus !== 'ready' || !share.s3Key) {
        throw new NasCatalogueApiError('NAS_DELIVERY_FAILED', 'The file could not be prepared for delivery.', 409);
      }
      const downloadUrl = await getCacheStorage().getDownloadUrl({
        key: share.s3Key,
        fileName: share.originalFileName,
        disposition,
      });
      return res.json({ delivery, downloadUrl });
    } catch (error) {
      return sendError(res, error);
    }
  });

  // A lightbox navigation request is intentionally disposable. Cancelling its
  // owned, still-preparing delivery removes the corresponding cache job so a
  // large skipped image cannot monopolize the connector's serial file lane.
  router.delete('/deliveries/:shareId', async (req, res) => {
    try {
      const actorUid = currentActorUid(req.user);
      if (!actorUid) {
        throw new NasCatalogueApiError('NAS_CATALOGUE_ACTOR_REQUIRED', 'Authenticated user identity is required.', 401);
      }
      const shareId = assertObjectId(req.params.shareId, 'Delivery ID');
      const share = await findOwnedDelivery({ shareId, actorUid });
      if (!share) {
        throw new NasCatalogueApiError('NAS_DELIVERY_NOT_FOUND', 'The requested delivery is unavailable.', 404);
      }
      if (share.deliveryStatus !== 'preparing') {
        return res.status(204).end();
      }

      await NasTransferJobModel.findOneAndUpdate(
        {
          type: CACHE_FOR_DOWNLOAD_JOB_TYPE,
          'payload.fileShareId': shareId,
          status: { $in: ['queued', 'assigned', 'accepted', 'in_progress'] },
        },
        {
          $set: {
            status: 'cancelled',
            completedAt: new Date(),
            progressStage: null,
            errorCode: 'cancelled',
            errorMessage: 'The browser no longer needs this cache delivery.',
          },
          $unset: { idempotencyKey: 1 },
        },
        { new: false },
      );
      await FileShareModel.findOneAndUpdate(
        { _id: shareId, sourceType: 'nas_file', status: 'active', deliveryStatus: 'preparing', createdBy: actorUid },
        { $set: { deliveryStatus: 'failed' } },
        { new: false },
      );
      return res.status(204).end();
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get('/search', async (req, res) => {
    try {
      const query = parseSearchQuery(req.query.q);
      const rootId = req.query.rootId === undefined ? null : assertObjectId(req.query.rootId, 'NAS root ID');
      const limit = parsePageSize(req.query.limit);
      const offset = parseCursor(req.query.cursor);
      if (rootId) await findBrowsableRoot(rootId);
      // A global search must use the same visibility boundary as root/folder
      // browsing.  Old catalogue rows intentionally remain after a root is
      // disabled, but they must not be discoverable through search.
      const browsableRootIds = rootId
        ? [rootId]
        : (await resolveArrayQuery(NasStorageRootModel.find({ status: { $in: ['active', 'offline'] } })))
          .map((root) => objectIdOf(root));
      const filter = {
        deletedAt: null,
        storageRootId: { $in: browsableRootIds },
        $or: [
          { name: { $regex: escapeRegex(query), $options: 'i' } },
          { relativePath: { $regex: escapeRegex(query), $options: 'i' } },
        ],
      };
      const entries = await resolveArrayQuery(NasFileEntryModel.find(filter), {
        sort: { modifiedAt: -1, name: 1, _id: 1 },
        skip: offset,
        limit: limit + 1,
      });
      const hasMore = entries.length > limit;
      return res.json({
        query,
        entries: entries.slice(0, limit).map(serializeEntry),
        nextCursor: hasMore ? String(offset + limit) : null,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
};

module.exports = {
  createNasCatalogueRoutes,
  parseCursor,
  parsePageSize,
  parseSearchQuery,
};
