const { Event } = require('../models');

class EventRepository {
  async create(eventData) {
    try {
      const doc = {
        eventId: eventData.eventKey,
        eventType: eventData.eventType,
        objectId: eventData.dealId,
        payload: eventData.payload || {},
      };
      if (eventData.payload) {
        doc.subscriptionId = String(eventData.payload.subscriptionId || '');
        doc.portalId = String(eventData.payload.portalId || '');
        doc.propertyName = eventData.payload.propertyName;
        doc.propertyValue = eventData.payload.propertyValue;
        doc.changeSource = eventData.payload.changeSource;
      }
      return await Event.create(doc);
    } catch (error) {
      if (error.code === 11000) {
        return null;
      }
      throw error;
    }
  }

  async findByEventId(eventId) {
    return Event.findOne({ eventId }).lean();
  }

  async updateStatus(eventKey, status, errorMessage = null) {
    const update = { status, processedAt: new Date(), lastError: errorMessage || '' };
    return Event.findOneAndUpdate({ eventId: eventKey }, update, { new: true }).lean();
  }

  async incrementRetryCount(eventKey) {
    return Event.findOneAndUpdate(
      { eventId: eventKey },
      { $inc: { retryCount: 1 } },
      { new: true }
    ).lean();
  }

  async findByDealId(dealId, limit = 10, offset = 0) {
    return Event.find({ objectId: dealId })
      .sort({ createdAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .lean();
  }

  async findByStatus(status, limit = 100, offset = 0) {
    return Event.find({ status })
      .sort({ createdAt: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .lean();
  }
}

module.exports = new EventRepository();
