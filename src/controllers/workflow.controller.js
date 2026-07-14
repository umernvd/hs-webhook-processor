const { dealQueue } = require('../config/queue');
const { ValidationError } = require('../errors/customErrors');

class WorkflowController {
  async handleWorkflowEvent(req, res, next) {
    try {
      const body = req.body;

      const quoteId = body.hs_object_id || body.objectId;

      if (!quoteId) {
        throw new ValidationError('No quote ID found in workflow payload');
      }

      const contactId = body.contactId || null;

      await dealQueue.add('process-quote', { quoteId: String(quoteId), contactId: contactId });

      res.status(200).json({
        received: true,
        quoteId: String(quoteId),
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new WorkflowController();
