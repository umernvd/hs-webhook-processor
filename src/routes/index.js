const { Router } = require('express');
const webhookRoutes = require('./webhook.routes');
const dealRoutes = require('./deal.routes');
const dealController = require('../controllers/deal.controller');

const router = Router();

router.use('/webhook', webhookRoutes);
router.use('/deals', dealRoutes);
router.get('/webhook-events', dealController.getWebhookEvents.bind(dealController));

module.exports = router;
