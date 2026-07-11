const crypto = require('crypto');
const config = require('../config');
const { AuthenticationError } = require('../errors/customErrors');

function verifyHubSpotSignature(req, res, next) {
  const signature = req.headers['x-hubspot-signature-v3'];
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const timestamp = req.headers['x-hubspot-request-timestamp'];

  if (!signature || !timestamp) {
    return next(new AuthenticationError('Missing signature headers'));
  }

  const requestTime = parseInt(timestamp);
  const currentTime = Date.now();
  if (currentTime - requestTime > 5 * 60 * 1000) {
    return next(new AuthenticationError('Request timestamp too old'));
  }

  const sourceString = config.hubspot.clientSecret + rawBody + timestamp;

  const hash = crypto
    .createHmac('sha256', config.hubspot.clientSecret)
    .update(sourceString)
    .digest('base64');

  if (hash !== signature) {
    return next(new AuthenticationError('Invalid signature'));
  }

  next();
}

module.exports = verifyHubSpotSignature;
