'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { authenticate, authorizeRole } = require('../auth/authMiddleware');
const { getFileServerConfig } = require('../config/fileServerConfig');
const FileAuditEvent = require('../models/fileAuditEvent');
const FileOperation = require('../models/fileOperation');
const FileShare = require('../models/fileShare');
const {
  FileStorageError,
  createFileStorageService,
} = require('../services/fileStorageService');
const {
  FileStorageValidationError,
  assertManagedS3Key,
  computeMultipartPartSize,
  createManagedS3Key,
  normalizeContentType,
  normalizeFileName,
  normalizeFolderPath,
} = require('../services/fileStorageValidation');
const { createShareToken } = require('../services/fileShareToken');

const UPLOAD_OPERATION_TYPES = ['upload', 'replace'];
const CONFLICT_STRATEGIES = new Set(['cancel', 'replace']);

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

const serializeShare = (share) => {
  const serialized = typeof share?.toObject === 'function' ? share.toObject() : { ...share };
  delete serialized.tokenHash;
  return serialized;
};

const createFileRoutes = (dependencies = {}) => {
  const config = dependencies.config || getFileServerConfig();
  const storage = dependencies.storage || createFileStorageService({ config });
  const FileOperationModel = dependencies.FileOperationModel || FileOperation;
  const FileShareModel = dependencies.FileShareModel || FileShare;
  const FileAuditEventModel = dependencies.FileAuditEventModel || FileAuditEvent;
  const authenticateMiddleware = dependencies.authenticateMiddleware || authenticate;
  const authorizeMiddleware = dependencies.authorizeMiddleware || authorizeRole(['admin', 'moderator']);
  const router = express.Router();

  const audit = async (event) => {
    try {
      await FileAuditEventModel.create(event);
    } catch (error) {
      // Audit failure must not turn a completed S3 operation into a client-visible failure.
      console.error('Failed to record file-server audit event:', error.code || error.name || 'unknown');
    }
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

  router.get('/shares', async (req, res) => {
    try {
      const key = assertManagedS3Key(String(req.query.key || ''), config.prefix);
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
      const key = assertManagedS3Key(String(req.body?.key || ''), config.prefix);
      await storage.headFile({ key });
      const originalFileName = key.slice(key.lastIndexOf('/') + 1);
      let createdShare;
      let rawToken;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { token, tokenHash } = createShareToken();
        try {
          createdShare = await FileShareModel.create({
            s3Key: key,
            originalFileName,
            tokenHash,
            createdBy: actorUid,
          });
          rawToken = token;
          break;
        } catch (error) {
          if (error?.code !== 11000 || attempt === 2) {
            throw error;
          }
        }
      }

      const shareUrl = new URL(`/download/${rawToken}`, config.publicBaseUrl).toString();
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
      const share = await FileShareModel.findOneAndUpdate(
        { _id: req.params.shareId, status: 'active' },
        { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: actorUid } },
        { new: true },
      );
      if (!share) {
        return res.status(404).json({ code: 'FILE_SHARE_NOT_FOUND', error: 'Active share link not found.' });
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

  return router;
};

module.exports = { createFileRoutes };
