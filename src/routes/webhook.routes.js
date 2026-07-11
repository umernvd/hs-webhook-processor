const { Router } = require('express');
const webhookController = require('../controllers/webhook.controller');
const verifyHubSpotSignature = require('../middlewares/signatureVerification');
const { webhookLimiter } = require('../middlewares/rateLimiter');

const router = Router();

router.post(
  '/hubspot',
  webhookLimiter,
  verifyHubSpotSignature,
  webhookController.handleHubSpotWebhook.bind(webhookController)
);

module.exports = router;
