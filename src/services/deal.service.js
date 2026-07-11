const hubspotClient = require('../clients/hubspot.client');
const healthScoreService = require('./healthScore.service');
const dealRepository = require('../repositories/deal.repository');
const { NotFoundError } = require('../errors/customErrors');

class DealService {
  async processDeal(dealId, eventKey) {
    try {
      await dealRepository.upsertSyncStatus(dealId, {
        syncStatus: 'processing',
      });

      const deal = await hubspotClient.getDeal(dealId);
      const contacts = await hubspotClient.getAssociatedContacts(dealId);
      const companies = await hubspotClient.getAssociatedCompanies(dealId);

      const healthScore = healthScoreService.calculate(deal, contacts, companies);

      await hubspotClient.updateDeal(dealId, {
        integration_health_score: healthScore,
        integration_sync_status: 'completed',
        integration_last_synced_at: new Date().toISOString(),
        integration_error_message: '',
      });

      await dealRepository.upsertSyncStatus(dealId, {
        healthScore,
        syncStatus: 'completed',
        errorMessage: null,
      });

      return { success: true, healthScore };
    } catch (error) {
      await dealRepository.upsertSyncStatus(dealId, {
        syncStatus: 'failed',
        errorMessage: error.message,
      });

      throw error;
    }
  }

  async getSyncStatus(dealId) {
    const status = await dealRepository.findByDealId(dealId);
    if (!status) {
      throw new NotFoundError('No sync status found for this deal');
    }
    return status;
  }
}

module.exports = new DealService();
