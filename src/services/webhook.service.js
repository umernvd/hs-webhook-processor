const eventRepository = require('../repositories/event.repository');
const { dealQueue } = require('../config/queue');
const logger = require('../utils/logger');

class WebhookService {
  async processWebhookEvents(events) {
    const results = [];

    for (const event of events) {
      const eventKey = `${event.portalId}_${event.subscriptionId}_${event.eventId}`;
      const dealId = String(event.objectId);

      const savedEvent = await eventRepository.create({
        eventKey,
        dealId,
        eventType: 'deal.propertyChange',
        payload: event,
      });

      if (!savedEvent) {
        logger.info(`Event ${eventKey} already processed (idempotency)`);
        results.push({ eventKey, status: 'duplicate' });
        continue;
      }

      await dealQueue.add('process-deal', {
        dealId,
        eventKey,
      });

      results.push({ eventKey, status: 'queued' });
    }

    return results;
  }
}

module.exports = new WebhookService();
