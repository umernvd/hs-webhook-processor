const hubspotClient = require('../clients/hubspot.client');
const dealService = require('../services/deal.service');
const dealRepository = require('../repositories/deal.repository');
const eventRepository = require('../repositories/event.repository');
const { dealQueue } = require('../config/queue');
const { ValidationError, NotFoundError } = require('../errors/customErrors');

class DealController {
  async getDeal(req, res, next) {
    try {
      const { id } = req.params;

      if (!id || !/^\d+$/.test(id)) {
        throw new ValidationError('Invalid deal ID format');
      }

      const deal = await dealRepository.findDealByHubspotId(id);
      if (!deal) throw new NotFoundError('Deal not found');
      res.json(deal);
    } catch (error) {
      next(error);
    }
  }

  async listDeals(req, res, next) {
    try {
      const { limit } = req.query;
      const deals = await hubspotClient.listDeals(limit || 100);
      res.json(deals);
    } catch (error) {
      next(error);
    }
  }

  async recalculate(req, res, next) {
    try {
      const { dealId } = req.params;

      if (!dealId || !/^\d+$/.test(dealId)) {
        throw new ValidationError('Invalid deal ID format');
      }

      const eventKey = `manual_${dealId}_${Date.now()}`;

      await eventRepository.create({
        eventKey,
        dealId,
        eventType: 'manual.recalculate',
        payload: { source: 'manual', requestId: req.id },
      });

      await dealQueue.add('process-deal', { dealId, eventKey });

      res.status(202).json({
        message: 'Recalculation queued',
        dealId,
        eventKey,
      });
    } catch (error) {
      next(error);
    }
  }

  async getSyncStatus(req, res, next) {
    try {
      const { dealId } = req.params;

      if (!dealId || !/^\d+$/.test(dealId)) {
        throw new ValidationError('Invalid deal ID format');
      }

      const status = await dealService.getSyncStatus(dealId);

      res.status(200).json(status);
    } catch (error) {
      next(error);
    }
  }

  async getWebhookEvents(req, res, next) {
    try {
      const { status, dealId, limit = 50, offset = 0 } = req.query;

      let events;

      if (dealId) {
        events = await eventRepository.findByDealId(dealId, limit, offset);
      } else if (status) {
        events = await eventRepository.findByStatus(status, limit, offset);
      } else {
        throw new ValidationError('Provide either dealId or status filter');
      }

      res.status(200).json({
        events,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new DealController();
