'use strict';

const { createNasStorageService } = require('./nasStorageService');

/**
 * The NAS feature has three isolated object-store prefixes.  Compose them
 * once at startup and pass this immutable set to every NAS route/service so
 * configuration merging and client construction cannot drift by caller.
 */
const createNasStorageSet = ({ nasConfig, fileServerConfig } = {}) => {
  if (!nasConfig || !fileServerConfig) {
    throw new Error('NAS storage set requires NAS and File Server configuration.');
  }

  return Object.freeze({
    cache: createNasStorageService({
      nasConfig,
      fileServerConfig,
      prefix: nasConfig.cachePrefix,
      overrides: {
        uploadUrlTtlSeconds: nasConfig.connectorTransferUrlTtlSeconds,
        downloadUrlTtlSeconds: nasConfig.connectorTransferUrlTtlSeconds,
      },
    }),
    thumbnails: createNasStorageService({
      nasConfig,
      fileServerConfig,
      prefix: nasConfig.thumbnailPrefix,
      overrides: {
        uploadUrlTtlSeconds: nasConfig.connectorTransferUrlTtlSeconds,
        downloadUrlTtlSeconds: nasConfig.connectorTransferUrlTtlSeconds,
      },
    }),
    staging: createNasStorageService({
      nasConfig,
      fileServerConfig,
      prefix: nasConfig.uploadStagingPrefix,
      overrides: {
        uploadPartUrlTtlSeconds: nasConfig.browserUploadUrlTtlSeconds,
        downloadUrlTtlSeconds: nasConfig.connectorTransferUrlTtlSeconds,
      },
    }),
  });
};

module.exports = { createNasStorageSet };
