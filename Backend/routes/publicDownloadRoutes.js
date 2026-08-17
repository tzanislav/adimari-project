'use strict';

const express = require('express');
const { getFileServerConfig } = require('../config/fileServerConfig');
const FileAuditEvent = require('../models/fileAuditEvent');
const FileShare = require('../models/fileShare');
const FileShareEntry = require('../models/fileShareEntry');
const { FileStorageError, createFileStorageService } = require('../services/fileStorageService');
const { hashShareToken } = require('../services/fileShareToken');

const notFound = (res) => res.status(404).json({ error: 'Download link not found.' });

const createPublicDownloadRoutes = (dependencies = {}) => {
  const config = dependencies.config || getFileServerConfig();
  const storage = dependencies.storage || createFileStorageService({ config });
  const FileShareModel = dependencies.FileShareModel || FileShare;
  const FileShareEntryModel = dependencies.FileShareEntryModel || FileShareEntry;
  const FileAuditEventModel = dependencies.FileAuditEventModel || FileAuditEvent;
  const archiveService = dependencies.archiveService || { enqueue: () => false };
  const router = express.Router();

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
    return FileShareModel.findOne({ tokenHash, status: 'active' }).select('+tokenHash +archive.s3Key');
  };

  const loadExistingShare = async (req, res) => {
    const share = await findActiveShare(req.params.token);
    if (!share) {
      notFound(res);
      return null;
    }
    return share;
  };

  const serializeArchive = (archive = {}) => ({
    status: archive.status || 'queued',
    fileName: archive.fileName || null,
    size: Number.isFinite(archive.size) ? archive.size : null,
    processedFiles: Number.isFinite(archive.processedFiles) ? archive.processedFiles : 0,
    processedBytes: Number.isFinite(archive.processedBytes) ? archive.processedBytes : 0,
  });

  const markMissingArchiveAsFailed = async (share) => {
    const archive = share.archive || {};
    if (archive.status !== 'ready') return false;

    let archiveMissing = !archive.s3Key;
    if (!archiveMissing) {
      try {
        await storage.headShareArchive({ key: archive.s3Key });
      } catch (error) {
        if (!(error instanceof FileStorageError) || error.code !== 'FILE_NOT_FOUND') throw error;
        archiveMissing = true;
      }
    }
    if (!archiveMissing) return false;

    if (typeof FileShareModel.updateOne === 'function') {
      await FileShareModel.updateOne(
        { _id: share._id, status: 'active', shareType: 'folder', 'archive.status': 'ready' },
        {
          $set: {
            'archive.status': 'failed',
            'archive.errorCode': 'FOLDER_SHARE_ARCHIVE_MISSING',
            'archive.failedAt': new Date(),
            'archive.heartbeatAt': null,
          },
        },
      );
    }
    share.archive ||= {};
    share.archive.status = 'failed';
    share.archive.errorCode = 'FOLDER_SHARE_ARCHIVE_MISSING';
    return true;
  };

  const loadFolderInfo = async (share) => {
    const entries = await FileShareEntryModel.find({ fileShareId: share._id })
      .sort({ archivePath: 1 })
      .lean();
    return {
      type: 'folder',
      folder: {
        name: share.originalFileName,
        fileCount: share.fileCount,
        totalBytes: share.totalBytes,
        archive: serializeArchive(share.archive),
        files: entries.map((entry) => ({
          path: entry.archivePath,
          name: entry.archivePath.slice(entry.archivePath.lastIndexOf('/') + 1),
          size: entry.size,
        })),
      },
    };
  };

  router.get('/:token/info', async (req, res) => {
    try {
      const share = await loadExistingShare(req, res);
      if (!share) return undefined;
      // A capability URL can expose the complete folder manifest, so never let
      // a browser or intermediary retain this response after the session.
      res.set({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' });
      if (share.shareType === 'folder') {
        await markMissingArchiveAsFailed(share);
        if (['queued', 'preparing'].includes(share.archive?.status)) {
          archiveService.enqueue(share._id);
        }
        return res.json(await loadFolderInfo(share));
      }
      if (!share.s3Key) return notFound(res);
      const object = await storage.headShareableFile({ key: share.s3Key });
      return res.json({
        type: 'file',
        file: {
          name: share.originalFileName,
          size: object.ContentLength || 0,
          contentType: object.ContentType || 'application/octet-stream',
        },
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
      if (share.shareType === 'folder') {
        await markMissingArchiveAsFailed(share);
        const archive = share.archive || {};
        if (['queued', 'preparing'].includes(archive.status)) {
          archiveService.enqueue(share._id);
          res.set({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'Retry-After': '3' });
          return res.status(202).json({ archive: serializeArchive(archive) });
        }
        if (archive.status !== 'ready' || !archive.s3Key) {
          return res.status(503).json({ error: 'The folder archive could not be prepared. Ask the sender to create a new link.' });
        }

        const downloadUrl = await storage.getShareArchiveDownloadUrl({
          key: archive.s3Key,
          fileName: archive.fileName || `${share.originalFileName}.zip`,
        });
        const countedShare = await FileShareModel.findOneAndUpdate(
          { _id: share._id, status: 'active' },
          { $inc: { downloadCount: 1 }, $set: { lastDownloadedAt: new Date() } },
          { new: true },
        );
        if (!countedShare) return notFound(res);

        await audit({
          action: 'share_download_started',
          result: 'success',
          s3Key: share.s3Key,
          fileShareId: share._id,
          details: { shareType: 'folder', fileCount: share.fileCount },
        });
        res.set({ 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' });
        return res.json({ downloadUrl });
      }
      if (!share.s3Key) return notFound(res);
      await storage.headShareableFile({ key: share.s3Key });
      const downloadUrl = await storage.getShareableDownloadUrl({
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
        details: { shareType: 'file' },
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
