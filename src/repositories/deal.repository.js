const { Deal } = require('../models');

class DealRepository {
  async findByDealId(dealId) {
    return Deal.findOne({ hubspotDealId: dealId }).lean();
  }

  async findDealByHubspotId(hubspotDealId) {
    return Deal.findOne({ hubspotDealId }).lean();
  }

  async upsertDeal(hubspotDealId, properties) {
    return Deal.findOneAndUpdate(
      { hubspotDealId },
      { hubspotDealId, properties, syncStatus: 'synced', lastSyncedAt: new Date() },
      { upsert: true, new: true }
    ).lean();
  }

  async listDeals(limit = 50, offset = 0) {
    return Deal.find()
      .sort({ updatedAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .lean();
  }

  async updateHealthScore(hubspotDealId, score) {
    return Deal.findOneAndUpdate(
      { hubspotDealId },
      { healthScore: score, syncStatus: 'synced', lastSyncedAt: new Date() },
      { new: true }
    ).lean();
  }

  async upsertSyncStatus(dealId, data) {
    const update = { lastSyncedAt: new Date() };
    if (data.healthScore !== undefined) update.healthScore = data.healthScore;
    if (data.syncStatus) update.syncStatus = data.syncStatus;
    if (data.errorMessage !== undefined) update.errorMessage = data.errorMessage;

    return Deal.findOneAndUpdate(
      { hubspotDealId: dealId },
      { $set: update },
      { upsert: true, new: true }
    ).lean();
  }
}

module.exports = new DealRepository();
