const rateLimit = require('express-rate-limit');

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many webhook requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { webhookLimiter };
