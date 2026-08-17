'use strict';

const { Transform } = require('stream');
const yazl = require('yazl');
const FileAuditEvent = require('../models/fileAuditEvent');
const FileShare = require('../models/fileShare');
const FileShareEntry = require('../models/fileShareEntry');
const { FileStorageError, createFileStorageService } = require('./fileStorageService');

const DEFAULT_STALE_HEARTBEAT_MS = 10 * 60 * 1000;
const DEFAULT_RECOVERY_INTERVAL_MS = 60 * 1000;
const DEFAULT_OPERATION_TIMEOUT_MS = 60 * 1000;

const asPlainObject = (value) => (typeof value?.toObject === 'function' ? value.toObject() : value);

const queryResult = async (query) => {
  if (query && typeof query.lean === 'function') return query.lean();
  return query;
};

const normalizeArchiveFileName = (folderName) => {
  let baseName = String(folderName || 'folder').trim() || 'folder';
  while (Buffer.byteLength(`${baseName}.zip`, 'utf8') > 255) {
    baseName = baseName.slice(0, -1);
  }
  return `${baseName || 'folder'}.zip`;
};

const errorCode = (error) => error?.code || error?.name || 'FOLDER_SHARE_ARCHIVE_FAILED';

const createFolderShareArchiveService = (dependencies = {}) => {
  const config = dependencies.config;
  const storage = dependencies.storage || createFileStorageService({ config });
  const FileShareModel = dependencies.FileShareModel || FileShare;
  const FileShareEntryModel = dependencies.FileShareEntryModel || FileShareEntry;
  const FileAuditEventModel = dependencies.FileAuditEventModel || FileAuditEvent;
  const logger = dependencies.logger || console;
  const now = dependencies.now || (() => new Date());
  const setImmediateFn = dependencies.setImmediateFn || setImmediate;
  const clearImmediateFn = dependencies.clearImmediateFn || clearImmediate;
  const setTimeoutFn = dependencies.setTimeoutFn || setTimeout;
  const clearTimeoutFn = dependencies.clearTimeoutFn || clearTimeout;
  const staleHeartbeatMs = dependencies.staleHeartbeatMs || DEFAULT_STALE_HEARTBEAT_MS;
  const recoveryIntervalMs = dependencies.recoveryIntervalMs || DEFAULT_RECOVERY_INTERVAL_MS;
  const explicitOperationTimeout = Number.isSafeInteger(dependencies.operationTimeoutMs)
    ? dependencies.operationTimeoutMs
    : dependencies.databaseOperationTimeoutMs;
  const operationTimeoutMs = Number.isSafeInteger(explicitOperationTimeout) && explicitOperationTimeout > 0
    ? explicitOperationTimeout
    : Math.min(staleHeartbeatMs, DEFAULT_OPERATION_TIMEOUT_MS);
  const buildConcurrency = config?.shareArchiveBuildConcurrency || 1;
  const queuedIds = new Set();
  const pendingIds = [];
  const activeBuildsByShareId = new Map();
  let runningBuilds = 0;
  let drainHandle = null;
  let recoveryTimer = null;

  const withOperationTimeout = async (operation, name) => {
    const operationPromise = Promise.resolve().then(() => (
      typeof operation === 'function' ? operation() : operation
    ));
    // Database queries also use maxTimeMS, but a broken database or S3 socket
    // can still leave a client promise pending. Do not let that pin the only
    // archive worker indefinitely. A late claim result is deliberately ignored;
    // recovery will reclaim its stale lease if it reached MongoDB.
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeoutFn(() => {
        reject(new FileStorageError({
          code: 'FOLDER_SHARE_ARCHIVE_OPERATION_TIMEOUT',
          message: `Folder-share archive ${name} timed out.`,
          status: 503,
        }));
      }, operationTimeoutMs);
      timeoutHandle?.unref?.();
    });
    try {
      return await Promise.race([operationPromise, timeoutPromise]);
    } finally {
      clearTimeoutFn(timeoutHandle);
      // Ensure a query that resolves or rejects after the client-side timeout
      // never turns into an unhandled rejection.
      void operationPromise.catch(() => undefined);
    }
  };

  const withMaxTimeMs = (query) => (
    typeof query?.maxTimeMS === 'function' ? query.maxTimeMS(operationTimeoutMs) : query
  );

  const audit = async (event) => {
    try {
      await FileAuditEventModel.create(event);
    } catch (error) {
      logger.error('Failed to record folder-share archive audit event:', error.code || error.name || 'unknown');
    }
  };

  const updatePreparingProgress = async (shareId, attempt, processedFiles, processedBytes) => {
    if (typeof FileShareModel.updateOne !== 'function') return;
    await withOperationTimeout(withMaxTimeMs(FileShareModel.updateOne(
      {
        _id: shareId,
        status: 'active',
        shareType: 'folder',
        'archive.status': 'preparing',
        'archive.attempts': attempt,
      },
      {
        $set: {
          'archive.processedFiles': processedFiles,
          'archive.processedBytes': processedBytes,
          'archive.heartbeatAt': now(),
        },
      },
    )), 'progress update');
  };

  const markFailed = async (shareId, attempt, error) => {
    const code = errorCode(error);
    try {
      if (typeof FileShareModel.updateOne === 'function') {
        await withOperationTimeout(withMaxTimeMs(FileShareModel.updateOne(
          {
            _id: shareId,
            status: 'active',
            shareType: 'folder',
            'archive.status': 'preparing',
            'archive.attempts': attempt,
          },
          {
            $set: {
              'archive.status': 'failed',
              'archive.failedAt': now(),
              'archive.errorCode': code,
              'archive.heartbeatAt': null,
            },
          },
        )), 'failure update');
      }
      void audit({
        action: 'share_archive_failed',
        result: 'failure',
        fileShareId: shareId,
        details: { code },
      });
    } catch (updateError) {
      logger.error('Failed to mark folder-share archive as failed:', updateError.code || updateError.name || 'unknown');
    }
  };

  const claimBuild = async (shareId) => {
    const staleBefore = new Date(now().getTime() - staleHeartbeatMs);
    const query = {
      _id: shareId,
      status: 'active',
      shareType: 'folder',
      $or: [
        { 'archive.status': 'queued' },
        { 'archive.status': 'preparing', 'archive.heartbeatAt': { $lt: staleBefore } },
        { 'archive.status': 'preparing', 'archive.heartbeatAt': null, 'archive.startedAt': { $lt: staleBefore } },
      ],
    };
    const updates = {
      $set: {
        'archive.status': 'preparing',
        'archive.startedAt': now(),
        'archive.heartbeatAt': now(),
        'archive.completedAt': null,
        'archive.failedAt': null,
        'archive.errorCode': null,
        'archive.size': null,
        'archive.processedFiles': 0,
        'archive.processedBytes': 0,
      },
      $inc: { 'archive.attempts': 1 },
    };
    return withMaxTimeMs(FileShareModel.findOneAndUpdate(query, updates, { new: true }));
  };

  const addActiveBuild = (shareId, activeBuild) => {
    const builds = activeBuildsByShareId.get(shareId) || new Set();
    builds.add(activeBuild);
    activeBuildsByShareId.set(shareId, builds);
  };

  const removeActiveBuild = (shareId, activeBuild) => {
    const builds = activeBuildsByShareId.get(shareId);
    if (!builds) return;
    builds.delete(activeBuild);
    if (!builds.size) activeBuildsByShareId.delete(shareId);
  };

  const abortActiveBuild = (activeBuild) => {
    if (!activeBuild.cancelled) {
      activeBuild.cancelled = true;
      const cancellationError = new Error('Folder-share archive build was cancelled.');
      cancellationError.code = 'FOLDER_SHARE_ARCHIVE_CANCELLED';
      activeBuild.cancellationError = cancellationError;
      activeBuild.abortController.abort();
      activeBuild.sourceStreams.forEach((stream) => stream.destroy(cancellationError));
      activeBuild.zipfile?.outputStream.destroy(cancellationError);
    }
    const abortedUpload = activeBuild.upload?.abort();
    if (abortedUpload && typeof abortedUpload.catch === 'function') {
      void abortedUpload.catch(() => undefined);
    }
  };

  const touchActiveBuild = (activeBuild) => {
    activeBuild.lastActivityAt = now();
  };

  const deleteArchiveLater = (key) => {
    if (!key || typeof storage.deleteShareArchive !== 'function') return;
    // Cleanup must never keep an archive worker slot occupied. An orphan is
    // private and covered by the archive-prefix lifecycle rule if S3 is down.
    void withOperationTimeout(() => storage.deleteShareArchive({ key }), 'archive cleanup')
      .catch(() => undefined);
  };

  const buildArchive = async (shareId) => {
    let shareDocument;
    try {
      shareDocument = await withOperationTimeout(claimBuild(shareId), 'claim');
    } catch (error) {
      // The share remains queued/preparing and recovery can retry the claim.
      // Never allow a transient MongoDB failure to become an unhandled promise.
      logger.error('Folder-share archive claim failed:', errorCode(error));
      return;
    }
    if (!shareDocument) return;
    const share = asPlainObject(shareDocument);
    const normalizedShareId = String(share._id);
    const archiveAttempt = Number(share.archive?.attempts);
    let archiveKey = null;
    let finalizationMayHaveCommitted = false;
    const activeBuild = {
      abortController: new AbortController(),
      cancelled: false,
      cancellationError: null,
      lastActivityAt: now(),
      sourceStreams: new Set(),
      upload: null,
      zipfile: null,
    };
    addActiveBuild(normalizedShareId, activeBuild);

    try {
      const entries = await withOperationTimeout(
        queryResult(withMaxTimeMs(
          FileShareEntryModel.find({ fileShareId: share._id }).sort({ archivePath: 1 }),
        )),
        'manifest read',
      );
      if (!Array.isArray(entries) || entries.length === 0 || entries.length !== share.fileCount) {
        throw new FileStorageError({
          code: 'FOLDER_SHARE_SNAPSHOT_INVALID',
          message: 'The folder-share snapshot is incomplete.',
          status: 500,
        });
      }
      if (activeBuild.cancelled) return;
      touchActiveBuild(activeBuild);

      void audit({
        action: 'share_archive_started',
        result: 'success',
        fileShareId: share._id,
        s3Key: share.s3Key,
        details: { fileCount: entries.length, totalBytes: share.totalBytes },
      });

      archiveKey = storage.createShareArchiveKey({ shareId: normalizedShareId, attempt: archiveAttempt });
      const archiveFileName = normalizeArchiveFileName(share.originalFileName);
      const zipfile = new yazl.ZipFile();
      activeBuild.zipfile = zipfile;
      let processedFiles = 0;
      let processedBytes = 0;
      let lastProgressWriteAt = 0;
      let pendingProgressWrite = Promise.resolve();

      const persistProgress = (force = false) => {
        touchActiveBuild(activeBuild);
        const timestamp = Date.now();
        if (!force && timestamp - lastProgressWriteAt < 1_000) return;
        lastProgressWriteAt = timestamp;
        pendingProgressWrite = pendingProgressWrite
          .catch(() => undefined)
          .then(() => updatePreparingProgress(share._id, archiveAttempt, processedFiles, processedBytes));
      };

      zipfile.on('error', (error) => {
        zipfile.outputStream.destroy(error);
      });
      // Registering the listener prevents a stream error from becoming an
      // unhandled event; Upload receives the same error through its body.
      zipfile.outputStream.on('error', () => undefined);

      for (const entry of entries) {
        zipfile.addReadStreamLazy(
          entry.archivePath,
          {
            size: entry.size,
            mtime: entry.lastModified || share.createdAt || now(),
            compress: false,
          },
          (callback) => {
            if (activeBuild.cancelled) {
              const cancellationError = new Error('Folder-share archive build was cancelled.');
              cancellationError.code = 'FOLDER_SHARE_ARCHIVE_CANCELLED';
              callback(cancellationError);
              return;
            }
            touchActiveBuild(activeBuild);
            storage.getShareableFileStream({
              key: entry.s3Key,
              eTag: entry.eTag,
              abortSignal: activeBuild.abortController.signal,
            })
              .then((sourceStream) => {
                touchActiveBuild(activeBuild);
                activeBuild.sourceStreams.add(sourceStream);
                const progressStream = new Transform({
                  transform(chunk, encoding, done) {
                    processedBytes += chunk.length;
                    persistProgress();
                    done(null, chunk);
                  },
                });
                // Cancellation or an S3 stream failure is also delivered to
                // yazl through this stream. Keep an explicit listener here so
                // Node never treats that expected error path as unhandled.
                progressStream.on('error', () => undefined);
                progressStream.on('finish', () => {
                  processedFiles += 1;
                  persistProgress(true);
                });
                sourceStream.once('close', () => activeBuild.sourceStreams.delete(sourceStream));
                sourceStream.on('error', (error) => progressStream.destroy(error));
                sourceStream.pipe(progressStream);
                callback(null, progressStream);
              })
              .catch(callback);
          },
        );
      }

      const uploadPromise = storage.uploadShareArchive({
        key: archiveKey,
        body: zipfile.outputStream,
        onUploadCreated: (upload) => {
          activeBuild.upload = upload;
          if (activeBuild.cancelled) abortActiveBuild(activeBuild);
        },
        onProgress: () => persistProgress(),
      });
      zipfile.end();
      await uploadPromise;
      await pendingProgressWrite;
      touchActiveBuild(activeBuild);
      const archiveObject = await withOperationTimeout(
        () => storage.headShareArchive({
          key: archiveKey,
          abortSignal: activeBuild.abortController.signal,
        }),
        'archive verification',
      );
      if (activeBuild.cancelled) throw activeBuild.cancellationError;
      // If the client times out after this request has been sent, MongoDB may
      // still commit it. Preserve the object in that ambiguous case rather
      // than creating a ready record that points to a deleted archive.
      finalizationMayHaveCommitted = true;
      const readyShare = await withOperationTimeout(withMaxTimeMs(FileShareModel.findOneAndUpdate(
        {
          _id: share._id,
          status: 'active',
          shareType: 'folder',
          'archive.status': 'preparing',
          'archive.attempts': archiveAttempt,
        },
        {
          $set: {
            'archive.status': 'ready',
            'archive.s3Key': archiveKey,
            'archive.fileName': archiveFileName,
            'archive.size': Number(archiveObject.ContentLength) || 0,
            'archive.completedAt': now(),
            'archive.heartbeatAt': null,
            'archive.errorCode': null,
            'archive.processedFiles': processedFiles,
            'archive.processedBytes': processedBytes,
          },
        },
        { new: true },
      )), 'ready update');
      finalizationMayHaveCommitted = false;

      if (!readyShare) {
        // A revoke won the race while packaging. The archive must never become
        // reachable through that revoked token, and is removed best-effort.
        deleteArchiveLater(archiveKey);
        return;
      }

      void audit({
        action: 'share_archive_completed',
        result: 'success',
        fileShareId: share._id,
        s3Key: share.s3Key,
        details: { fileCount: processedFiles, totalBytes: processedBytes, archiveBytes: Number(archiveObject.ContentLength) || 0 },
      });
    } catch (error) {
      if (!finalizationMayHaveCommitted) deleteArchiveLater(archiveKey);
      if (activeBuild.cancelled) return;
      await markFailed(share._id, archiveAttempt, error);
      logger.error('Folder-share ZIP build failed:', errorCode(error));
    } finally {
      removeActiveBuild(normalizedShareId, activeBuild);
    }
  };

  const drain = () => {
    drainHandle = null;
    while (runningBuilds < buildConcurrency && pendingIds.length) {
      const shareId = pendingIds.shift();
      queuedIds.delete(shareId);
      runningBuilds += 1;
      void buildArchive(shareId)
        .catch((error) => {
          logger.error('Folder-share archive worker failed unexpectedly:', errorCode(error));
        })
        .finally(() => {
          runningBuilds -= 1;
          scheduleDrain();
        });
    }
  };

  const scheduleDrain = () => {
    if (drainHandle !== null) return;
    drainHandle = setImmediateFn(drain);
  };

  const enqueue = (shareId) => {
    const normalizedShareId = String(shareId || '');
    if (!normalizedShareId || queuedIds.has(normalizedShareId)) return false;
    queuedIds.add(normalizedShareId);
    pendingIds.push(normalizedShareId);
    scheduleDrain();
    return true;
  };

  const cancel = (shareId) => {
    const normalizedShareId = String(shareId || '');
    let cancelled = queuedIds.delete(normalizedShareId);
    const index = pendingIds.indexOf(normalizedShareId);
    if (index >= 0) pendingIds.splice(index, 1);
    const activeBuilds = activeBuildsByShareId.get(normalizedShareId);
    if (activeBuilds?.size) {
      activeBuilds.forEach(abortActiveBuild);
      cancelled = true;
    }
    return cancelled;
  };

  const recover = async () => {
    const staleBefore = new Date(now().getTime() - staleHeartbeatMs);
    try {
      let query = FileShareModel.find({
        status: 'active',
        shareType: 'folder',
        $or: [
          { 'archive.status': 'queued' },
          { 'archive.status': 'preparing', 'archive.heartbeatAt': { $lt: staleBefore } },
          { 'archive.status': 'preparing', 'archive.heartbeatAt': null, 'archive.startedAt': { $lt: staleBefore } },
        ],
      });
      if (typeof query.select === 'function') query = query.select('_id');
      if (typeof query.limit === 'function') query = query.limit(100);
      const pendingShares = await withOperationTimeout(
        queryResult(withMaxTimeMs(query)),
        'recovery query',
      );
      for (const pendingShare of pendingShares || []) {
        const shareId = String(pendingShare._id);
        const activeBuilds = activeBuildsByShareId.get(shareId);
        if (activeBuilds?.size) {
          const staleBuilds = Array.from(activeBuilds).filter((activeBuild) => (
            !activeBuild.lastActivityAt || activeBuild.lastActivityAt < staleBefore
          ));
          if (!staleBuilds.length) continue;
          // A local worker has stopped making progress. Aborting it releases a
          // concurrency slot so the queued recovery attempt can actually run.
          staleBuilds.forEach(abortActiveBuild);
        }
        enqueue(pendingShare._id);
      }
    } catch (error) {
      logger.error('Folder-share archive recovery failed:', errorCode(error));
    }
  };

  const start = () => {
    void recover();
    if (recoveryTimer === null) {
      recoveryTimer = setInterval(() => void recover(), recoveryIntervalMs);
      recoveryTimer.unref?.();
    }
  };

  const stop = () => {
    if (drainHandle !== null) {
      clearImmediateFn(drainHandle);
      drainHandle = null;
    }
    if (recoveryTimer !== null) {
      clearInterval(recoveryTimer);
      recoveryTimer = null;
    }
  };

  return {
    enqueue,
    cancel,
    recover,
    start,
    stop,
  };
};

module.exports = {
  DEFAULT_RECOVERY_INTERVAL_MS,
  DEFAULT_STALE_HEARTBEAT_MS,
  createFolderShareArchiveService,
  normalizeArchiveFileName,
};
