const crypto = require('crypto');

function requestIdMiddleware(req, res, next) {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
}

module.exports = requestIdMiddleware;
