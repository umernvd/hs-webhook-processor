const dealService = require('../services/deal.service');
const eventRepository = require('../repositories/event.repository');
const { dealQueue } = require('../config/queue');
const { RateLimitError, HubSpotAPIError } = require('../errors/customErrors');

async function processDealJob(job) {
  const { dealId, eventKey } = job.data;

  console.log(`[Job ${job.id}] Processing deal ${dealId}, event ${eventKey}`);

  try {
    const result = await dealService.processDeal(dealId, eventKey);

    await eventRepository.updateStatus(eventKey, 'completed');

    console.log(`[Job ${job.id}] Completed successfully`, result);
    return result;
  } catch (error) {
    if (error instanceof RateLimitError) {
      const delay = error.retryAfter
        ? parseInt(error.retryAfter) * 1000
        : 60000;

      await eventRepository.incrementRetryCount(eventKey);
      await eventRepository.updateStatus(eventKey, 'pending', error.message);

      console.log(`[Job ${job.id}] Rate limited, re-enqueuing with delay ${delay}ms`);

      await dealQueue.add('process-deal', job.data, { delay });

      return { success: false, reason: 'rate_limited', retryAfter: delay };
    }

    console.error(`[Job ${job.id}] Failed:`, error.message);

    if (error instanceof HubSpotAPIError && error.statusCode < 500) {
      await eventRepository.incrementRetryCount(eventKey);
      await eventRepository.updateStatus(eventKey, 'failed', error.message);

      return { success: false, error: error.message };
    }

    await eventRepository.incrementRetryCount(eventKey);
    await eventRepository.updateStatus(eventKey, 'processing', error.message);

    throw error;
  }
}

module.exports = processDealJob;
