'use strict';

const express = require('express');
const { getFileServerConfig } = require('../config/fileServerConfig');
const FileAuditEvent = require('../models/fileAuditEvent');
const FileShare = require('../models/fileShare');
const NasFileEntry = require('../models/nasFileEntry');
const { FileStorageError, createFileStorageService } = require('../services/fileStorageService');
const { createNasStorageService } = require('../services/nasStorageService');
const { hashShareToken } = require('../services/fileShareToken');

const notFound = (res) => res.status(404).json({ error: 'Download link not found.' });

const createPublicDownloadRoutes = (dependencies = {}) => {
  const config = dependencies.config || getFileServerConfig();
  const storage = dependencies.storage || createFileStorageService({ config });
  const nasConfig = dependencies.nasConfig || null;
  let cacheStorage = dependencies.cacheStorage || dependencies.storageSet?.cache || null;
  const FileShareModel = dependencies.FileShareModel || FileShare;
  const NasFileEntryModel = dependencies.NasFileEntryModel || NasFileEntry;
  const FileAuditEventModel = dependencies.FileAuditEventModel || FileAuditEvent;
  const router = express.Router();

  // Existing File Server shares live under `files/`; connector-prepared
  // shares live under the isolated `nas-cache/` prefix in the same bucket.
  // The storage service deliberately validates each key against its prefix,
  // so choose it from the trusted share source rather than weakening either
  // prefix validation.
  const storageForShare = (share) => {
    if (share.sourceType !== 'nas_file') return storage;
    if (cacheStorage) return cacheStorage;
    if (!nasConfig) {
      throw new FileStorageError({
        code: 'FILE_STORAGE_UNAVAILABLE',
        message: 'NAS cache storage is not configured.',
        status: 503,
      });
    }
    cacheStorage = createNasStorageService({
      nasConfig,
      fileServerConfig: config,
      prefix: nasConfig.cachePrefix,
      overrides: {
        downloadUrlTtlSeconds: config.downloadUrlTtlSeconds,
      },
    });
    return cacheStorage;
  };

  const audit = async (event) => {
    try {
      await FileAuditEventModel.create(event);
    } catch (error) {
      console.error('Failed to record public file-download audit event:', error.code || error.name || 'unknown');
    }
  };

  const findActiveShare = async (token) => {
    let tokenHash;
    try {
      tokenHash = hashShareToken(token);
    } catch {
      return null;
    }
    return FileShareModel.findOne({ tokenHash, status: 'active' }).select('+tokenHash');
  };

  const loadExistingShare = async (req, res) => {
    let share = await findActiveShare(req.params.token);
    if (!share) {
      notFound(res);
      return null;
    }
    // S3 lifecycle removes the temporary object after the configured cache
    // lifetime. Mark the public link consistently before any caller attempts
    // to request a URL for an object that no longer belongs to the share.
    if (share.sourceType === 'nas_file'
      && share.cacheExpiresAt
      && new Date(share.cacheExpiresAt) <= new Date()
      && share.deliveryStatus !== 'expired') {
      const expired = await FileShareModel.findOneAndUpdate(
        { _id: share._id, status: 'active' },
        { $set: { deliveryStatus: 'expired' } },
        { new: true },
      );
      if (expired) share = expired;
    }
    return share;
  };

  const serializeNonReadyNasShare = async (share) => {
    if (share.sourceType !== 'nas_file' || !share.nasFileEntryId) return null;
    const entry = await NasFileEntryModel.findOne({ _id: share.nasFileEntryId, deletedAt: null });
    // A deleted NAS source must never be represented as ready. Keep the public
    // response opaque: it reveals no original folder or native path.
    if (!entry) return null;
    return {
      file: {
        name: share.originalFileName,
        size: entry.sizeBytes || 0,
        contentType: entry.contentType || 'application/octet-stream',
      },
      deliveryStatus: share.deliveryStatus,
      retryAfterSeconds: share.deliveryStatus === 'preparing' ? 3 : null,
    };
  };

  router.get('/:token/info', async (req, res) => {
    try {
      const share = await loadExistingShare(req, res);
      if (!share) return undefined;
      if (share.sourceType === 'nas_file' && share.deliveryStatus !== 'ready') {
        const pending = await serializeNonReadyNasShare(share);
        return pending ? res.json(pending) : notFound(res);
      }
      if (!share.s3Key) return notFound(res);
      const object = await storageForShare(share).headFile({ key: share.s3Key });
      return res.json({
        file: {
          name: share.originalFileName,
          size: object.ContentLength || 0,
          contentType: object.ContentType || 'application/octet-stream',
        },
        deliveryStatus: 'ready',
      });
    } catch (error) {
      if (error instanceof FileStorageError && error.code === 'FILE_NOT_FOUND') {
        return notFound(res);
      }
      if (error instanceof FileStorageError) {
        return res.status(503).json({ error: 'File download is temporarily unavailable.' });
      }
      console.error('Public file information lookup failed:', error.code || error.name || 'unknown');
      return res.status(503).json({ error: 'File download is temporarily unavailable.' });
    }
  });

  router.post('/:token/download', async (req, res) => {
    try {
      const share = await loadExistingShare(req, res);
      if (!share) return undefined;
      if (share.sourceType === 'nas_file' && share.deliveryStatus === 'preparing') {
        return res.status(202).json({ deliveryStatus: 'preparing', retryAfterSeconds: 3 });
      }
      if (share.sourceType === 'nas_file' && share.deliveryStatus !== 'ready') {
        return res.status(503).json({ error: 'File preparation was not completed.' });
      }
      if (!share.s3Key) return notFound(res);
      const shareStorage = storageForShare(share);
      await shareStorage.headFile({ key: share.s3Key });
      const downloadUrl = await shareStorage.getDownloadUrl({
        key: share.s3Key,
        fileName: share.originalFileName,
      });
      const countedShare = await FileShareModel.findOneAndUpdate(
        { _id: share._id, status: 'active' },
        { $inc: { downloadCount: 1 }, $set: { lastDownloadedAt: new Date() } },
        { new: true },
      );
      if (!countedShare) {
        return notFound(res);
      }

      await audit({
        action: 'share_download_started',
        result: 'success',
        s3Key: countedShare.s3Key,
        fileShareId: countedShare._id,
      });
      res.set({
        'Cache-Control': 'no-store, private',
        'Referrer-Policy': 'no-referrer',
      });
      return res.json({ downloadUrl });
    } catch (error) {
      if (error instanceof FileStorageError && error.code === 'FILE_NOT_FOUND') {
        return notFound(res);
      }

      if (error instanceof FileStorageError) {
        return res.status(503).json({ error: 'File download is temporarily unavailable.' });
      }

      console.error('Public file download failed:', error.code || error.name || 'unknown');
      return res.status(503).json({ error: 'File download is temporarily unavailable.' });
    }
  });

  // Keep already-created /download/:token links working, but show the branded page.
  router.get('/:token', async (req, res) => {
    try {
      const share = await loadExistingShare(req, res);
      if (!share) return undefined;
      const destination = new URL(`/file-download/${encodeURIComponent(req.params.token)}`, config.publicBaseUrl).toString();
      res.set({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' });
      return res.redirect(302, destination);
    } catch (error) {
      console.error('Public share-page redirect failed:', error.code || error.name || 'unknown');
      return res.status(503).json({ error: 'File download is temporarily unavailable.' });
    }
  });

  return router;
};

module.exports = { createPublicDownloadRoutes };
