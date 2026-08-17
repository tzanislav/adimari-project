'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { authenticate, authorizeRole } = require('../auth/authMiddleware');
const { getFileServerConfig } = require('../config/fileServerConfig');
const FileAuditEvent = require('../models/fileAuditEvent');
const FileOperation = require('../models/fileOperation');
const FileShare = require('../models/fileShare');
const FileShareEntry = require('../models/fileShareEntry');
const {
  FileStorageError,
  createFileStorageService,
} = require('../services/fileStorageService');
const {
  FileStorageValidationError,
  assertManagedS3Key,
  assertS3KeyWithinPrefixes,
  computeMultipartPartSize,
  createManagedS3Key,
  normalizeContentType,
  normalizeFileName,
  normalizeFolderPath,
} = require('../services/fileStorageValidation');
const { createShareToken } = require('../services/fileShareToken');

const UPLOAD_OPERATION_TYPES = ['upload', 'replace'];
const CONFLICT_STRATEGIES = new Set(['cancel', 'replace']);
const INLINE_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const NON_RETRYABLE_FOLDER_ARCHIVE_CODES = new Set([
  'FILE_NOT_FOUND',
  'FILE_CONFLICT',
  'FOLDER_SHARE_SNAPSHOT_INVALID',
]);

const currentActorUid = (user) => user?.uid || user?.user_id || user?.email || null;

const sendError = (res, error) => {
  if (error instanceof FileStorageValidationError) {
    return res.status(400).json({ code: error.code, error: error.message });
  }

  if (error instanceof FileStorageError) {
    return res.status(error.status).json({ code: error.code, error: error.message });
  }

  if (error?.name === 'CastError' || error?.name === 'ValidationError') {
    return res.status(400).json({ code: 'FILE_REQUEST_INVALID', error: 'The file request is invalid.' });
  }

  return res.status(500).json({ code: 'FILE_OPERATION_FAILED', error: 'The file operation failed.' });
};

const toFileDetails = (key, object) => ({
  key,
  name: key.slice(key.lastIndexOf('/') + 1),
  size: object.ContentLength,
  eTag: object.ETag,
  contentType: object.ContentType,
  lastModified: object.LastModified,
  versionId: object.VersionId || null,
});

const isNotFound = (error) => error instanceof FileStorageError && error.code === 'FILE_NOT_FOUND';

const isInlineImage = (key, contentType = '') => {
  if (/^image\/(jpeg|png|webp)$/i.test(contentType)) return true;
  return INLINE_IMAGE_EXTENSIONS.has(key.split('.').pop()?.toLowerCase());
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const serializeShare = (share) => {
  const serialized = typeof share?.toObject === 'function' ? share.toObject() : { ...share };
  delete serialized.tokenHash;
  if (serialized.archive) {
    delete serialized.archive.s3Key;
    delete serialized.archive.heartbeatAt;
  }
  return serialized;
};

const createFileRoutes = (dependencies = {}) => {
  const config = dependencies.config || getFileServerConfig();
  const storage = dependencies.storage || createFileStorageService({ config });
  const FileOperationModel = dependencies.FileOperationModel || FileOperation;
  const FileShareModel = dependencies.FileShareModel || FileShare;
  const FileShareEntryModel = dependencies.FileShareEntryModel || FileShareEntry;
  const FileAuditEventModel = dependencies.FileAuditEventModel || FileAuditEvent;
  const archiveService = dependencies.archiveService || { enqueue: () => false };
  const authenticateMiddleware = dependencies.authenticateMiddleware || authenticate;
  const authorizeMiddleware = dependencies.authorizeMiddleware || authorizeRole(['admin', 'moderator']);
  const router = express.Router();
  const shareableKey = (key) => assertS3KeyWithinPrefixes(
    key,
    config.shareablePrefixes || [config.prefix],
  );

  const audit = async (event) => {
    try {
      await FileAuditEventModel.create(event);
    } catch (error) {
      // Audit failure must not turn a completed S3 operation into a client-visible failure.
      console.error('Failed to record file-server audit event:', error.code || error.name || 'unknown');
    }
  };

  const shareUrlForToken = (token) => new URL(`/file-download/${token}`, config.publicBaseUrl).toString();

  const createShareRecord = async (attributes) => {
    let createdShare;
    let rawToken;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { token, tokenHash } = createShareToken();
      try {
        createdShare = await FileShareModel.create({ ...attributes, tokenHash });
        rawToken = token;
        break;
      } catch (error) {
        if (error?.code !== 11000 || attempt === 2) throw error;
      }
    }

    return { createdShare, rawToken };
  };

  const deleteFolderShareArchive = async (share) => {
    if (typeof storage.createShareArchiveKey !== 'function' || typeof storage.deleteShareArchive !== 'function') return;
    try {
      const shareId = typeof share === 'object' ? share?._id : share;
      const archiveKey = typeof share === 'object' ? share?.archive?.s3Key : null;
      const archiveAttempt = Number(typeof share === 'object' ? share?.archive?.attempts : null);
      if (!archiveKey && (!Number.isSafeInteger(archiveAttempt) || archiveAttempt < 1)) return;
      const key = archiveKey || storage.createShareArchiveKey({ shareId, attempt: archiveAttempt });
      await storage.deleteShareArchive({ key });
    } catch (error) {
      // A revoked token never returns a URL, so delayed S3 cleanup is safe.
      // Lifecycle cleanup remains the final guard if this best-effort call fails.
      console.error('Failed to remove revoked folder-share archive:', error.code || error.name || 'unknown');
    }
  };

  const revokeFolderSharesContaining = async (entryFilter, actorUid) => {
    if (typeof FileShareEntryModel.distinct !== 'function') return [];
    const shareIds = await FileShareEntryModel.distinct('fileShareId', entryFilter);
    if (!shareIds?.length) return [];
    let sharesForCleanup = shareIds.map((_id) => ({ _id }));
    if (typeof FileShareModel.find === 'function') {
      let query = FileShareModel.find({ _id: { $in: shareIds }, status: 'active', shareType: 'folder' });
      if (typeof query.select === 'function') query = query.select('+archive.s3Key');
      sharesForCleanup = typeof query.lean === 'function' ? await query.lean() : await query;
    }
    await FileShareModel.updateMany(
      { _id: { $in: shareIds }, status: 'active', shareType: 'folder' },
      { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: actorUid } },
    );
    shareIds.forEach((shareId) => archiveService.cancel?.(shareId));
    await Promise.all(sharesForCleanup.map((share) => deleteFolderShareArchive(share)));
    return shareIds;
  };

  const markOperation = async (operation, status, updates = {}) => {
    Object.assign(operation, updates, { status });
    if (Object.prototype.hasOwnProperty.call(updates, 'context') && typeof operation.markModified === 'function') {
      operation.markModified('context');
    }
    return operation.save();
  };

  const recordOperationFailure = async (operation, error, status = 'failed') => {
    await markOperation(operation, status, {
      errorCode: error.code || error.name || 'FILE_OPERATION_FAILED',
      errorMessage: error.message,
    });
  };

  const findExistingObject = async (key) => {
    try {
      return await storage.headFile({ key });
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  };

  const rejectPendingDestinationOperation = async (destinationKey) => {
    const pendingOperation = await FileOperationModel.findOne({
      destinationKey,
      status: 'pending',
      type: { $in: ['upload', 'replace', 'move'] },
    });
    if (pendingOperation) {
      const error = new FileStorageError({
        code: 'FILE_OPERATION_IN_PROGRESS',
        message: 'Another file operation is already in progress for this destination.',
        status: 409,
      });
      throw error;
    }
  };

  router.use(authenticateMiddleware, authorizeMiddleware);

  router.get('/', async (req, res) => {
    try {
      const listing = await storage.listFolder({
        folder: req.query.folder || '',
        continuationToken: req.query.cursor,
        maxKeys: req.query.limit === undefined ? 100 : Number(req.query.limit),
      });
      res.json(listing);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/object', async (req, res) => {
    try {
      const key = String(req.query.key || '');
      const object = await storage.headFile({ key });
      res.json(toFileDetails(key, object));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/folders', async (req, res) => {
    try {
      res.json({ folders: await storage.listAllFolders() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/stats', async (req, res) => {
    try {
      res.json({ ...(await storage.getUsageStats()), generatedAt: new Date() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/download', async (req, res) => {
    try {
      const key = String(req.query.key || '');
      const object = await storage.headFile({ key });
      const openInNewTab = isInlineImage(key, object.ContentType);
      const fileName = key.slice(key.lastIndexOf('/') + 1);
      const url = await storage.getDownloadUrl({
        key,
        fileName,
        disposition: openInNewTab ? 'inline' : 'attachment',
      });
      res.json({ url, openInNewTab });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/folders', async (req, res) => {
    const actorUid = currentActorUid(req.user);
    try {
      const folder = normalizeFolderPath(req.body?.folder);
      const marker = await storage.createFolderMarker({ folder });
      await audit({ action: 'folder_created', result: 'success', actorUid, s3Key: marker.key });
      res.status(201).json(marker);
    } catch (error) {
      await audit({ action: 'folder_created', result: 'failure', actorUid, details: { code: error.code || error.name } });
      sendError(res, error);
    }
  });

  router.get('/folder-shares', async (req, res) => {
    try {
      const folder = normalizeFolderPath(req.query.folder);
      if (!folder) {
        throw new FileStorageValidationError('A non-root folder path is required for sharing.');
      }
      const prefix = `${config.prefix}${folder}/`;
      const shares = await FileShareModel.find({ shareType: 'folder', s3Key: prefix })
        .sort({ createdAt: -1 })
        .lean();
      shares
        .filter((share) => ['queued', 'preparing'].includes(share.archive?.status))
        .forEach((share) => archiveService.enqueue(share._id));
      res.json({ folder, shares: shares.map(serializeShare) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/folder-shares', async (req, res) => {
    const actorUid = currentActorUid(req.user);
    let createdShare;
    try {
      if (!actorUid) {
        throw new FileStorageValidationError('Authenticated user identity is required.');
      }
      const folder = normalizeFolderPath(req.body?.folder);
      if (!folder) {
        throw new FileStorageValidationError('A non-root folder path is required for sharing.');
      }
      const snapshot = await storage.listFolderShareSnapshot({
        folder,
        maxFiles: config.shareArchiveMaxFiles,
        maxBytes: config.shareArchiveMaxBytes,
      });
      if (!snapshot.files.length) {
        throw new FileStorageValidationError('An empty folder cannot be shared.');
      }

      const originalFileName = folder.slice(folder.lastIndexOf('/') + 1);
      const created = await createShareRecord({
        shareType: 'folder',
        s3Key: snapshot.prefix,
        originalFileName,
        folderPath: folder,
        fileCount: snapshot.files.length,
        totalBytes: snapshot.totalBytes,
        // Keep the share invisible to archive recovery until all immutable
        // snapshot rows have committed successfully.
        archive: { status: 'initializing' },
        createdBy: actorUid,
      });
      createdShare = created.createdShare;
      await FileShareEntryModel.insertMany(snapshot.files.map((file) => ({
        fileShareId: createdShare._id,
        s3Key: file.key,
        archivePath: file.archivePath,
        size: file.size,
        lastModified: file.lastModified,
        eTag: file.eTag,
      })));

      const queuedShare = await FileShareModel.findOneAndUpdate(
        { _id: createdShare._id, status: 'active', shareType: 'folder', 'archive.status': 'initializing' },
        { $set: { 'archive.status': 'queued' } },
        { new: true },
      );
      if (!queuedShare) {
        throw new FileStorageError({
          code: 'FOLDER_SHARE_INITIALIZATION_FAILED',
          message: 'The folder share could not be initialized.',
          status: 500,
        });
      }
      createdShare = queuedShare;

      const url = shareUrlForToken(created.rawToken);
      await audit({
        action: 'folder_share_created',
        result: 'success',
        actorUid,
        s3Key: snapshot.prefix,
        fileShareId: createdShare._id,
        details: { fileCount: snapshot.files.length, totalBytes: snapshot.totalBytes },
      });
      archiveService.enqueue(createdShare._id);
      return res.status(201).json({ share: serializeShare(createdShare), url });
    } catch (error) {
      if (createdShare?._id && typeof FileShareEntryModel.deleteMany === 'function') {
        await FileShareEntryModel.deleteMany({ fileShareId: createdShare._id }).catch(() => undefined);
      }
      if (createdShare?._id && typeof FileShareModel.deleteOne === 'function') {
        await FileShareModel.deleteOne({ _id: createdShare._id }).catch(() => undefined);
      }
      await audit({ action: 'folder_share_created', result: 'failure', actorUid, details: { code: error.code || error.name } });
      return sendError(res, error);
    }
  });

  router.post('/folder-shares/:shareId/retry', async (req, res) => {
    const actorUid = currentActorUid(req.user);
    try {
      if (!actorUid || !mongoose.isValidObjectId(req.params.shareId)) {
        throw new FileStorageValidationError('Share ID is invalid.');
      }
      const share = await FileShareModel.findOneAndUpdate(
        {
          _id: req.params.shareId,
          status: 'active',
          shareType: 'folder',
          'archive.status': 'failed',
          'archive.errorCode': { $nin: Array.from(NON_RETRYABLE_FOLDER_ARCHIVE_CODES) },
        },
        {
          $set: {
            'archive.status': 'queued',
            'archive.errorCode': null,
            'archive.failedAt': null,
            'archive.heartbeatAt': null,
            'archive.s3Key': null,
            'archive.fileName': null,
            'archive.size': null,
            'archive.completedAt': null,
            'archive.processedFiles': 0,
            'archive.processedBytes': 0,
          },
        },
        { new: true },
      );
      if (!share) {
        return res.status(409).json({
          code: 'FOLDER_SHARE_RECREATE_REQUIRED',
          error: 'This folder snapshot changed or no longer exists. Create a new folder share link instead.',
        });
      }
      archiveService.enqueue(share._id);
      await audit({ action: 'share_archive_queued', result: 'success', actorUid, s3Key: share.s3Key, fileShareId: share._id });
      return res.json({ share: serializeShare(share) });
    } catch (error) {
      await audit({ action: 'share_archive_queued', result: 'failure', actorUid, details: { code: error.code || error.name } });
      return sendError(res, error);
    }
  });

  router.get('/shares', async (req, res) => {
    try {
      const key = shareableKey(String(req.query.key || ''));
      const shares = await FileShareModel.find({ s3Key: key }).sort({ createdAt: -1 }).lean();
      res.json({ key, shares: shares.map(serializeShare) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/shares', async (req, res) => {
    const actorUid = currentActorUid(req.user);
    try {
      if (!actorUid) {
        throw new FileStorageValidationError('Authenticated user identity is required.');
      }
      const key = shareableKey(String(req.body?.key || ''));
      await storage.headShareableFile({ key });
      const originalFileName = key.slice(key.lastIndexOf('/') + 1);
      const { createdShare, rawToken } = await createShareRecord({
        shareType: 'file',
        s3Key: key,
        originalFileName,
        createdBy: actorUid,
      });

      const shareUrl = shareUrlForToken(rawToken);
      await audit({ action: 'share_created', result: 'success', actorUid, s3Key: key, fileShareId: createdShare._id });
      res.status(201).json({ share: serializeShare(createdShare), url: shareUrl });
    } catch (error) {
      await audit({ action: 'share_created', result: 'failure', actorUid, details: { code: error.code || error.name } });
      sendError(res, error);
    }
  });

  router.post('/shares/:shareId/revoke', async (req, res) => {
    const actorUid = currentActorUid(req.user);
    try {
      if (!actorUid || !mongoose.isValidObjectId(req.params.shareId)) {
        throw new FileStorageValidationError('Share ID is invalid.');
      }
      let shareQuery = FileShareModel.findOneAndUpdate(
        { _id: req.params.shareId, status: 'active' },
        { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: actorUid } },
        { new: true },
      );
      if (typeof shareQuery.select === 'function') shareQuery = shareQuery.select('+archive.s3Key');
      const share = await shareQuery;
      if (!share) {
        return res.status(404).json({ code: 'FILE_SHARE_NOT_FOUND', error: 'Active share link not found.' });
      }

      if (share.shareType === 'folder') {
        archiveService.cancel?.(share._id);
        await deleteFolderShareArchive(share);
      }
      await audit({ action: 'share_revoked', result: 'success', actorUid, s3Key: share.s3Key, fileShareId: share._id });
      return res.json({ share: serializeShare(share) });
    } catch (error) {
      await audit({ action: 'share_revoked', result: 'failure', actorUid, details: { code: error.code || error.name } });
      return sendError(res, error);
    }
  });

  router.post('/uploads', async (req, res) => {
    const actorUid = currentActorUid(req.user);
    let operation;
    try {
      if (!actorUid) {
        throw new FileStorageValidationError('Authenticated user identity is required.');
      }

      const folder = normalizeFolderPath(req.body?.folder);
      const fileName = normalizeFileName(req.body?.fileName);
      const contentType = normalizeContentType(req.body?.contentType);
      const size = Number(req.body?.size);
      const conflictStrategy = req.body?.conflictStrategy || 'cancel';
      if (!CONFLICT_STRATEGIES.has(conflictStrategy)) {
        throw new FileStorageValidationError('Conflict strategy must be cancel or replace.');
      }

      const key = createManagedS3Key({ prefix: config.prefix, folder, fileName });
      const partSize = computeMultipartPartSize({
        fileSize: size,
        preferredPartSize: config.multipartPartSizeBytes,
      });
      await rejectPendingDestinationOperation(key);

      const existingObject = await findExistingObject(key);
      if (existingObject && conflictStrategy !== 'replace') {
        return res.status(409).json({
          code: 'FILE_NAME_CONFLICT',
          error: 'A file with this name already exists.',
          existingFile: toFileDetails(key, existingObject),
        });
      }

      operation = await FileOperationModel.create({
        type: existingObject ? 'replace' : 'upload',
        destinationKey: key,
        actorUid,
        context: {
          expectedSize: size,
          contentType,
          partSize,
          preventsOverwrite: !existingObject,
        },
      });
      const multipart = await storage.createMultipartUpload({ folder, fileName, contentType });
      await markOperation(operation, 'pending', {
        context: { ...operation.context, uploadId: multipart.uploadId },
      });
      await audit({ action: 'upload_started', result: 'success', actorUid, s3Key: key, operationId: operation._id });

      return res.status(201).json({
        operationId: operation._id,
        key,
        uploadId: multipart.uploadId,
        partSize,
        maxParts: 10_000,
      });
    } catch (error) {
      if (operation) {
        await recordOperationFailure(operation, error);
      }
      await audit({ action: 'upload_started', result: 'failure', actorUid, operationId: operation?._id, details: { code: error.code || error.name } });
      return sendError(res, error);
    }
  });

  router.post('/uploads/:operationId/parts', async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.operationId)) {
        throw new FileStorageValidationError('Upload operation ID is invalid.');
      }
      const operation = await FileOperationModel.findOne({
        _id: req.params.operationId,
        type: { $in: UPLOAD_OPERATION_TYPES },
        status: 'pending',
      });
      if (!operation?.context?.uploadId) {
        return res.status(404).json({ code: 'FILE_UPLOAD_NOT_FOUND', error: 'The active upload was not found.' });
      }

      const result = await storage.createMultipartPartUrls({
        key: operation.destinationKey,
        uploadId: operation.context.uploadId,
        partNumbers: req.body?.partNumbers,
      });
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/uploads/:operationId/complete', async (req, res) => {
    const actorUid = currentActorUid(req.user);
    let operation;
    try {
      if (!mongoose.isValidObjectId(req.params.operationId)) {
        throw new FileStorageValidationError('Upload operation ID is invalid.');
      }
      operation = await FileOperationModel.findOne({
        _id: req.params.operationId,
        type: { $in: UPLOAD_OPERATION_TYPES },
        status: 'pending',
      });
      if (!operation?.context?.uploadId) {
        return res.status(404).json({ code: 'FILE_UPLOAD_NOT_FOUND', error: 'The active upload was not found.' });
      }

      await storage.completeMultipartUpload({
        key: operation.destinationKey,
        uploadId: operation.context.uploadId,
        parts: req.body?.parts,
        preventOverwrite: operation.context.preventsOverwrite === true,
      });
      const object = await storage.headFile({ key: operation.destinationKey });
      await markOperation(operation, 'completed', { errorCode: null, errorMessage: null });
      await audit({ action: 'upload_completed', result: 'success', actorUid, s3Key: operation.destinationKey, operationId: operation._id });
      res.json({ operationId: operation._id, file: toFileDetails(operation.destinationKey, object) });
    } catch (error) {
      if (operation) {
        await recordOperationFailure(operation, error);
      }
      await audit({ action: 'upload_completed', result: 'failure', actorUid, operationId: operation?._id, details: { code: error.code || error.name } });
      sendError(res, error);
    }
  });

  router.post('/uploads/:operationId/abort', async (req, res) => {
    const actorUid = currentActorUid(req.user);
    let operation;
    try {
      if (!mongoose.isValidObjectId(req.params.operationId)) {
        throw new FileStorageValidationError('Upload operation ID is invalid.');
      }
      operation = await FileOperationModel.findOne({
        _id: req.params.operationId,
        type: { $in: UPLOAD_OPERATION_TYPES },
        status: 'pending',
      });
      if (!operation?.context?.uploadId) {
        return res.status(404).json({ code: 'FILE_UPLOAD_NOT_FOUND', error: 'The active upload was not found.' });
      }

      await storage.abortMultipartUpload({ key: operation.destinationKey, uploadId: operation.context.uploadId });
      await markOperation(operation, 'aborted');
      await audit({ action: 'upload_aborted', result: 'success', actorUid, s3Key: operation.destinationKey, operationId: operation._id });
      res.status(204).end();
    } catch (error) {
      if (operation) {
        await recordOperationFailure(operation, error);
      }
      await audit({ action: 'upload_aborted', result: 'failure', actorUid, operationId: operation?._id, details: { code: error.code || error.name } });
      sendError(res, error);
    }
  });

  router.post('/move', async (req, res) => {
    const actorUid = currentActorUid(req.user);
    let operation;
    try {
      if (!actorUid) {
        throw new FileStorageValidationError('Authenticated user identity is required.');
      }
      const sourceKey = assertManagedS3Key(String(req.body?.sourceKey || ''), config.prefix);
      const destinationFolder = normalizeFolderPath(req.body?.destinationFolder);
      const destinationFileName = normalizeFileName(req.body?.destinationFileName);
      const destinationKey = createManagedS3Key({ prefix: config.prefix, folder: destinationFolder, fileName: destinationFileName });
      const conflictStrategy = req.body?.conflictStrategy || 'cancel';
      if (!CONFLICT_STRATEGIES.has(conflictStrategy)) {
        throw new FileStorageValidationError('Conflict strategy must be cancel or replace.');
      }
      await rejectPendingDestinationOperation(destinationKey);
      const existingObject = await findExistingObject(destinationKey);
      if (existingObject && conflictStrategy !== 'replace') {
        return res.status(409).json({
          code: 'FILE_NAME_CONFLICT',
          error: 'A file with this name already exists.',
          existingFile: toFileDetails(destinationKey, existingObject),
        });
      }

      operation = await FileOperationModel.create({ type: 'move', sourceKey, destinationKey, actorUid });
      const result = await storage.moveFile({ sourceKey, destinationFolder, destinationFileName });
      try {
        await FileShareModel.updateMany(
          { s3Key: result.sourceKey, status: 'active' },
          { $set: { s3Key: result.destinationKey } },
        );
        // A folder manifest records the source object's original key and ETag.
        // Moving it removes that key, so invalidate any affected folder link
        // rather than allowing a pending ZIP to fail later without context.
        await revokeFolderSharesContaining({ s3Key: result.sourceKey }, actorUid);
      } catch (error) {
        await recordOperationFailure(operation, error, 'needs_repair');
        throw new FileStorageError({
          code: 'FILE_MOVE_NEEDS_REPAIR',
          message: 'The file was moved, but related share links require repair.',
          status: 500,
          cause: error,
        });
      }
      await markOperation(operation, 'completed');
      await audit({ action: 'file_moved', result: 'success', actorUid, s3Key: result.destinationKey, operationId: operation._id });
      res.json({ operationId: operation._id, sourceKey: result.sourceKey, destinationKey: result.destinationKey });
    } catch (error) {
      if (operation && operation.status === 'pending') {
        await recordOperationFailure(operation, error);
      }
      await audit({ action: 'file_moved', result: 'failure', actorUid, operationId: operation?._id, details: { code: error.code || error.name } });
      sendError(res, error);
    }
  });

  router.delete('/object', async (req, res) => {
    const actorUid = currentActorUid(req.user);
    let operation;
    try {
      if (!actorUid) {
        throw new FileStorageValidationError('Authenticated user identity is required.');
      }
      const key = assertManagedS3Key(String(req.query.key || ''), config.prefix);
      operation = await FileOperationModel.create({ type: 'delete', sourceKey: key, actorUid });
      await storage.deleteFile({ key });
      try {
        await FileShareModel.updateMany(
          { s3Key: key, status: 'active' },
          { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: actorUid } },
        );
        await revokeFolderSharesContaining({ s3Key: key }, actorUid);
      } catch (error) {
        await recordOperationFailure(operation, error, 'needs_repair');
        throw new FileStorageError({
          code: 'FILE_DELETE_NEEDS_REPAIR',
          message: 'The file was deleted, but related share links require repair.',
          status: 500,
          cause: error,
        });
      }
      await markOperation(operation, 'completed');
      await audit({ action: 'file_deleted', result: 'success', actorUid, s3Key: key, operationId: operation._id });
      res.status(204).end();
    } catch (error) {
      if (operation && operation.status === 'pending') {
        await recordOperationFailure(operation, error);
      }
      await audit({ action: 'file_deleted', result: 'failure', actorUid, operationId: operation?._id, details: { code: error.code || error.name } });
      sendError(res, error);
    }
  });

  router.delete('/folder', async (req, res) => {
    const actorUid = currentActorUid(req.user);
    let operation;
    try {
      if (!actorUid) {
        throw new FileStorageValidationError('Authenticated user identity is required.');
      }
      const folder = normalizeFolderPath(req.query.folder);
      if (!folder) {
        throw new FileStorageValidationError('The root folder cannot be deleted.');
      }
      const prefix = `${config.prefix}${folder}/`;
      operation = await FileOperationModel.create({ type: 'folder_delete', sourceKey: prefix, actorUid });
      const result = await storage.deleteFolder({ folder });
      try {
        await FileShareModel.updateMany(
          { s3Key: { $regex: new RegExp(`^${escapeRegex(result.prefix)}`) }, status: 'active' },
          { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: actorUid } },
        );
        await revokeFolderSharesContaining(
          { s3Key: { $regex: new RegExp(`^${escapeRegex(result.prefix)}`) } },
          actorUid,
        );
      } catch (error) {
        await recordOperationFailure(operation, error, 'needs_repair');
        throw new FileStorageError({
          code: 'FILE_FOLDER_DELETE_NEEDS_REPAIR',
          message: 'The folder was deleted, but related share links require repair.',
          status: 500,
          cause: error,
        });
      }
      await markOperation(operation, 'completed', { context: { deletedCount: result.deletedCount } });
      await audit({ action: 'folder_deleted', result: 'success', actorUid, s3Key: result.prefix, operationId: operation._id, details: { deletedCount: result.deletedCount } });
      return res.json({ folder: result.folder, deletedCount: result.deletedCount });
    } catch (error) {
      if (operation && operation.status === 'pending') {
        await recordOperationFailure(operation, error);
      }
      await audit({ action: 'folder_deleted', result: 'failure', actorUid, operationId: operation?._id, details: { code: error.code || error.name } });
      return sendError(res, error);
    }
  });

  return router;
};

module.exports = { createFileRoutes };
