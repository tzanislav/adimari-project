'use strict';

const mongoose = require('mongoose');

class NasConnectorValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NasConnectorValidationError';
    this.code = 'NAS_CONNECTOR_VALIDATION_ERROR';
  }
}

const hasControlCharacters = (value) => /[\u0000-\u001F\u007F]/.test(value);

const requireString = (value, label) => {
  if (typeof value !== 'string') {
    throw new NasConnectorValidationError(`${label} must be a string.`);
  }
  return value.normalize('NFC');
};

const normalizeRelativePath = (value = '', { allowEmpty = true } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (allowEmpty) return '';
    throw new NasConnectorValidationError('Relative path is required.');
  }

  const path = requireString(value, 'Relative path');
  if (path.startsWith('/') || path.endsWith('/') || path.includes('\\') || hasControlCharacters(path)) {
    throw new NasConnectorValidationError('Relative path is invalid.');
  }
  const segments = path.split('/');
  if (segments.some((segment) => !segment || !segment.trim() || segment === '.' || segment === '..')) {
    throw new NasConnectorValidationError('Relative path must contain safe, non-empty segments.');
  }
  if (path.length > 4_096) {
    throw new NasConnectorValidationError('Relative path must not exceed 4,096 characters.');
  }
  return segments.join('/');
};

const normalizeConnectorRootId = (value) => {
  const rootId = requireString(value, 'Connector root ID');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(rootId)) {
    throw new NasConnectorValidationError('Connector root ID is invalid.');
  }
  return rootId;
};

const normalizeDisplayName = (value) => {
  const name = requireString(value, 'Display name').trim();
  if (!name || name.includes('/') || name.includes('\\') || hasControlCharacters(name) || name.length > 120) {
    throw new NasConnectorValidationError('Display name is invalid.');
  }
  return name;
};

// The connector is the final authority for its filesystem, but rejecting
// impossible Windows destination names before the browser begins a multipart
// upload gives people an immediate, actionable error.  This deliberately
// validates a single filename only; existing catalogue parent paths keep
// their normal relative-path validation.
const normalizeWindowsDestinationFileName = (value) => {
  const fileName = requireString(value, 'File name').trim();
  if (!fileName
    || fileName.length > 255
    || fileName === '.'
    || fileName === '..'
    || /[<>:"/\\|?*]/.test(fileName)
    || /[. ]$/.test(fileName)
    || hasControlCharacters(fileName)) {
    throw new NasConnectorValidationError('File name is not valid for a Windows NAS destination.');
  }

  // Windows reserves these names even when an extension is supplied.
  const stem = fileName.split('.')[0].toUpperCase();
  if (stem === 'CON' || stem === 'PRN' || stem === 'AUX' || stem === 'NUL'
    || /^(COM|LPT)[1-9]$/.test(stem)) {
    throw new NasConnectorValidationError('File name is reserved by Windows and cannot be used on the NAS.');
  }
  return fileName;
};

const normalizeInstallationId = (value) => {
  const installationId = requireString(value, 'Installation ID').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(installationId)) {
    throw new NasConnectorValidationError('Installation ID must be a UUID.');
  }
  return installationId;
};

const normalizeAgentVersion = (value) => {
  const agentVersion = requireString(value, 'Agent version').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._+\-]{0,79}$/.test(agentVersion)) {
    throw new NasConnectorValidationError('Agent version is invalid.');
  }
  return agentVersion;
};

const normalizeUploadsEnabled = (value) => {
  if (typeof value !== 'boolean') {
    throw new NasConnectorValidationError('Uploads enabled must be a boolean.');
  }
  return value;
};

const normalizeConnectorRoot = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NasConnectorValidationError('Connector root is required.');
  }
  return {
    connectorRootId: normalizeConnectorRootId(value.connectorRootId),
    displayName: normalizeDisplayName(value.displayName),
    uploadsEnabled: normalizeUploadsEnabled(value.uploadsEnabled),
  };
};

const normalizeHeartbeatState = (value) => {
  const state = requireString(value, 'Connector state').trim();
  if (!['ready', 'busy', 'degraded'].includes(state)) {
    throw new NasConnectorValidationError('Connector state is invalid.');
  }
  return state;
};

const normalizeQueueLength = (value) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new NasConnectorValidationError('Queue length is invalid.');
  }
  return value;
};

const assertObjectId = (value, label = 'ID') => {
  if (!mongoose.isObjectIdOrHexString(value)) {
    throw new NasConnectorValidationError(`${label} is invalid.`);
  }
  return String(value);
};

module.exports = {
  NasConnectorValidationError,
  assertObjectId,
  normalizeAgentVersion,
  normalizeConnectorRootId,
  normalizeConnectorRoot,
  normalizeDisplayName,
  normalizeWindowsDestinationFileName,
  normalizeHeartbeatState,
  normalizeInstallationId,
  normalizeQueueLength,
  normalizeRelativePath,
  normalizeUploadsEnabled,
};
