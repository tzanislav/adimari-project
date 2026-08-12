'use strict';

const NasConnector = require('../models/nasConnector');
const { verifySharedSecret } = require('../services/nasConnectorSecrets');

const CONNECTOR_AUTHORIZATION_PATTERN = /^Connector ([0-9a-fA-F]{24})\.([A-Za-z0-9_-]{43})$/;
const CONNECTOR_KEY_AUTHORIZATION_PATTERN = /^ConnectorKey ([A-Za-z0-9_-]{43})$/;

const unauthorized = (res) => res.status(401).json({
  code: 'NAS_CONNECTOR_UNAUTHORIZED',
  error: 'Connector authentication failed.',
});

const parseConnectorAuthorization = (authorization) => {
  const matched = typeof authorization === 'string'
    ? CONNECTOR_AUTHORIZATION_PATTERN.exec(authorization)
    : null;
  if (!matched) return null;

  const [, connectorId, sharedSecret] = matched;
  return { connectorId, sharedSecret };
};

const parseConnectorKeyAuthorization = (authorization) => {
  const matched = typeof authorization === 'string'
    ? CONNECTOR_KEY_AUTHORIZATION_PATTERN.exec(authorization)
    : null;
  return matched ? { sharedSecret: matched[1] } : null;
};

// This authentication primitive is shared by the Express heartbeat route and
// the HTTP upgrade handler. It deliberately returns only the selected connector
// document or null. The supplied shared key is compared only to the server
// configuration; it is never logged or stored in MongoDB.
const authenticateConnectorAuthorization = async ({
  authorization,
  NasConnectorModel = NasConnector,
  sharedSecret,
} = {}) => {
  const parsed = parseConnectorAuthorization(authorization);
  if (!parsed || !verifySharedSecret({ sharedSecret: parsed.sharedSecret, expectedSecret: sharedSecret })) return null;

  try {
    const connector = await NasConnectorModel.findOne({
      _id: parsed.connectorId,
      status: { $in: ['active', 'offline'] },
    });

    if (!connector) {
      return null;
    }

    return connector;
  } catch {
    // Do not surface storage/authentication details to an unauthenticated
    // connector request. Callers intentionally return the same generic failure.
    return null;
  }
};

const authenticateConnectorKeyAuthorization = ({ authorization, sharedSecret } = {}) => {
  const parsed = parseConnectorKeyAuthorization(authorization);
  return Boolean(parsed && verifySharedSecret({ sharedSecret: parsed.sharedSecret, expectedSecret: sharedSecret }));
};

const createConnectorAuthenticateMiddleware = ({
  NasConnectorModel = NasConnector,
  sharedSecret,
} = {}) => async (req, res, next) => {
  const authorization = req.header('authorization');
  const connector = await authenticateConnectorAuthorization({
    authorization,
    NasConnectorModel,
    sharedSecret,
  });
  if (!connector) return unauthorized(res);

  req.connector = connector;
  return next();
};

module.exports = {
  CONNECTOR_AUTHORIZATION_PATTERN,
  CONNECTOR_KEY_AUTHORIZATION_PATTERN,
  authenticateConnectorKeyAuthorization,
  authenticateConnectorAuthorization,
  createConnectorAuthenticateMiddleware,
  parseConnectorAuthorization,
  parseConnectorKeyAuthorization,
};
