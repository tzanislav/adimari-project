'use strict';

const NasConnector = require('../models/nasConnector');
const { verifyDeviceSecret } = require('../services/nasConnectorSecrets');

const CONNECTOR_AUTHORIZATION_PATTERN = /^Connector ([0-9a-fA-F]{24})\.([A-Za-z0-9_-]{43})$/;

const unauthorized = (res) => res.status(401).json({
  code: 'NAS_CONNECTOR_UNAUTHORIZED',
  error: 'Connector authentication failed.',
});

const resolveSelectedQuery = async (query) => {
  if (!query) return query;
  return typeof query.select === 'function' ? query.select('+credentialHash') : query;
};

const parseConnectorAuthorization = (authorization) => {
  const matched = typeof authorization === 'string'
    ? CONNECTOR_AUTHORIZATION_PATTERN.exec(authorization)
    : null;
  if (!matched) return null;

  const [, connectorId, deviceSecret] = matched;
  return { connectorId, deviceSecret };
};

// This authentication primitive is shared by the Express heartbeat route and
// the HTTP upgrade handler. It deliberately returns only the selected connector
// document (which includes the stored HMAC) or null. It never returns or logs a
// supplied raw device credential.
const authenticateConnectorAuthorization = async ({
  authorization,
  NasConnectorModel = NasConnector,
  hmacSecret,
} = {}) => {
  const parsed = parseConnectorAuthorization(authorization);
  if (!parsed) return null;

  try {
    const connector = await resolveSelectedQuery(NasConnectorModel.findOne({
      _id: parsed.connectorId,
      status: { $in: ['active', 'offline'] },
    }));

    if (!connector || !verifyDeviceSecret({
      deviceSecret: parsed.deviceSecret,
      expectedHash: connector.credentialHash,
      hmacSecret,
    })) {
      return null;
    }

    return connector;
  } catch {
    // Do not surface storage/authentication details to an unauthenticated
    // connector request. Callers intentionally return the same generic failure.
    return null;
  }
};

const createConnectorAuthenticateMiddleware = ({
  NasConnectorModel = NasConnector,
  hmacSecret,
} = {}) => async (req, res, next) => {
  const authorization = req.header('authorization');
  const connector = await authenticateConnectorAuthorization({
    authorization,
    NasConnectorModel,
    hmacSecret,
  });
  if (!connector) return unauthorized(res);

  req.connector = connector;
  return next();
};

module.exports = {
  CONNECTOR_AUTHORIZATION_PATTERN,
  authenticateConnectorAuthorization,
  createConnectorAuthenticateMiddleware,
  parseConnectorAuthorization,
};
