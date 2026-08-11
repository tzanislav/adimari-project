'use strict';

const express = require('express');
const { getFileServerConfig } = require('../config/fileServerConfig');
const FileAuditEvent = require('../models/fileAuditEvent');
const FileShare = require('../models/fileShare');
const { FileStorageError, createFileStorageService } = require('../services/fileStorageService');
const { hashShareToken } = require('../services/fileShareToken');

const notFound = (res) => res.status(404).json({ error: 'Download link not found.' });

const createPublicDownloadRoutes = (dependencies = {}) => {
  const config = dependencies.config || getFileServerConfig();
  const storage = dependencies.storage || createFileStorageService({ config });
  const FileShareModel = dependencies.FileShareModel || FileShare;
  const FileAuditEventModel = dependencies.FileAuditEventModel || FileAuditEvent;
  const router = express.Router();

  const audit = async (event) => {
    try {
      await FileAuditEventModel.create(event);
    } catch (error) {
      console.error('Failed to record public file-download audit event:', error.code || error.name || 'unknown');
    }
  };

  router.get('/:token', async (req, res) => {
    let tokenHash;
    try {
      tokenHash = hashShareToken(req.params.token);
    } catch {
      return notFound(res);
    }

    try {
      const share = await FileShareModel.findOne({ tokenHash, status: 'active' }).select('+tokenHash');
      if (!share) {
        return notFound(res);
      }

      await storage.headFile({ key: share.s3Key });
      const downloadUrl = await storage.getDownloadUrl({
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
      return res.redirect(302, downloadUrl);
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

  return router;
};

module.exports = { createPublicDownloadRoutes };
