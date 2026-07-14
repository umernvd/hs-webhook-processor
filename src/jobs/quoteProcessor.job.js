const quoteService = require('../services/quote.service');
const { RateLimitError, HubSpotAPIError } = require('../errors/customErrors');
const { dealQueue } = require('../config/queue');

async function processQuoteJob(job) {
  const { quoteId, contactId } = job.data;

  console.log(`[Job ${job.id}] Processing quote ${quoteId}`);

  try {
    const result = await quoteService.processQuote(quoteId, contactId);

    console.log(`[Job ${job.id}] Completed successfully`, result);
    return result;

  } catch (error) {
    console.error(`[Job ${job.id}] Failed:`, error.message);

    if (error instanceof RateLimitError) {
      const delay = error.retryAfter
        ? parseInt(error.retryAfter) * 1000
        : 60000;

      console.log(`[Job ${job.id}] Rate limited, re-enqueuing with delay ${delay}ms`);

      await dealQueue.add('process-quote', job.data, { delay: delay });

      return { success: false, reason: 'rate_limited', retryAfter: delay };
    }

    if (error instanceof HubSpotAPIError && error.statusCode < 500) {
      return { success: false, error: error.message };
    }

    throw error;
  }
}

module.exports = processQuoteJob;
