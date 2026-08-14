'use strict';

const NasConnector = require('../models/nasConnector');
const { verifySharedSecret } = require('../services/nasConnectorSecrets');

// The shared connector key is an enrollment-only secret. Once enrollment has
// succeeded, connector API calls identify the already-registered connector by
// its server-issued ID and do not repeatedly validate the shared key.
const CONNECTOR_AUTHORIZATION_PATTERN = /^Connector ([0-9a-fA-F]{24})$/;
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

  return { connectorId: matched[1] };
};

const parseConnectorKeyAuthorization = (authorization) => {
  const matched = typeof authorization === 'string'
    ? CONNECTOR_KEY_AUTHORIZATION_PATTERN.exec(authorization)
    : null;
  return matched ? { sharedSecret: matched[1] } : null;
};

// This enrollment lookup is shared by connector HTTPS routes. It deliberately
// returns only the selected active connector document or null. The shared key
// is verified exclusively by the /connect enrollment endpoint.
const authenticateConnectorAuthorization = async ({
  authorization,
  NasConnectorModel = NasConnector,
} = {}) => {
  const parsed = parseConnectorAuthorization(authorization);
  if (!parsed) return null;

  try {
    const query = NasConnectorModel.findOne({
      _id: parsed.connectorId,
      status: { $in: ['active', 'offline'] },
    });
    const connector = await query;

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
} = {}) => async (req, res, next) => {
  const authorization = req.header('authorization');
  const connector = await authenticateConnectorAuthorization({
    authorization,
    NasConnectorModel,
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
