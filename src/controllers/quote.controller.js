const { dealQueue } = require('../config/queue');
const { ValidationError } = require('../errors/customErrors');

class QuoteController {
  async regenerate(req, res, next) {
    try {
      const { quoteId } = req.params;

      if (!quoteId) {
        throw new ValidationError('Quote ID is required');
      }

      const contactId = req.body.contactId || null;

      await dealQueue.add('process-quote', { quoteId: quoteId, contactId: contactId });

      res.status(202).json({
        message: 'Quote regeneration queued',
        quoteId: quoteId,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new QuoteController();
