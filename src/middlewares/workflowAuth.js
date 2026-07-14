const config = require('../config');
const { AuthenticationError } = require('../errors/customErrors');

function verifyWorkflowSecret(req, res, next) {
  const secret = req.headers['workflowsecret'];

  if (!secret || secret !== config.workflow.secret) {
    return next(new AuthenticationError('Invalid workflow secret'));
  }

  next();
}

module.exports = verifyWorkflowSecret;
