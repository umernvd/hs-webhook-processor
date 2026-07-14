const eventRepository = require('../repositories/event.repository');
const { dealQueue } = require('../config/queue');
const logger = require('../utils/logger');

class WebhookService {
  async processWebhookEvents(events) {
    const results = [];

    for (const event of events) {
      const objectType = this._getObjectType(event);
      const objectId = String(event.objectId);

      if (objectType === 'quote') {
        await dealQueue.add('process-quote', { quoteId: objectId });
        results.push({ status: 'queued', objectType: 'quote' });
        continue;
      }

      const eventKey = `${event.portalId}_${event.subscriptionId}_${event.eventId}`;

      const savedEvent = await eventRepository.create({
        eventKey,
        dealId: objectId,
        eventType: 'deal.propertyChange',
        payload: event,
      });

      if (!savedEvent) {
        logger.info(`Event ${eventKey} already processed (idempotency)`);
        results.push({ eventKey, status: 'duplicate' });
        continue;
      }

      await dealQueue.add('process-deal', {
        dealId: objectId,
        eventKey,
      });

      results.push({ eventKey, status: 'queued' });
    }

    return results;
  }

  _getObjectType(event) {
    if (event.objectType) {
      return event.objectType.toLowerCase();
    }

    if (event.subscriptionType && event.subscriptionType.includes('quote')) {
      return 'quote';
    }

    return 'deal';
  }
}

module.exports = new WebhookService();
