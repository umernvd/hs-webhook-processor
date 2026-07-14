const { Router } = require('express');
const webhookRoutes = require('./webhook.routes');
const workflowRoutes = require('./workflow.routes');
const dealRoutes = require('./deal.routes');
const quoteRoutes = require('./quote.routes');
const dealController = require('../controllers/deal.controller');

const router = Router();

router.use('/webhook', workflowRoutes);
router.use('/webhook', webhookRoutes);
router.use('/deals', dealRoutes);
router.use('/quotes', quoteRoutes);
router.get('/webhook-events', dealController.getWebhookEvents.bind(dealController));

module.exports = router;
