const webhookService = require('../services/webhook.service');
const { validateWebhookPayload } = require('../validators/webhook.validator');
const logger = require('../utils/logger');

class WebhookController {
  async handleHubSpotWebhook(req, res, next) {
    try {
      const events = validateWebhookPayload(req.body);

      const results = await webhookService.processWebhookEvents(events);

      logger.info(`Processed ${events.length} webhook events`, { requestId: req.id });

      res.status(200).json({
        received: true,
        count: events.length,
        results,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new WebhookController();
