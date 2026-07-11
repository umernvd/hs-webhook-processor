const hubspot = require('@hubspot/api-client');
const config = require('../config');
const { HubSpotAPIError, RateLimitError } = require('../errors/customErrors');

class HubSpotClient {
  constructor() {
    this.client = new hubspot.Client({
      accessToken: config.hubspot.accessToken,
    });
  }

  async getDeal(dealId) {
    try {
      const response = await this.client.crm.deals.basicApi.getById(
        dealId,
        ['amount', 'dealstage', 'closedate', 'dealname']
      );
      return response;
    } catch (error) {
      this._handleError(error);
    }
  }

  async getAssociatedContacts(dealId) {
    try {
      const response = await this.client.crm.associations.v4.basicApi.getPage(
        'deals', dealId, 'contacts'
      );
      return response.results || [];
    } catch (error) {
      this._handleError(error);
    }
  }

  async getAssociatedCompanies(dealId) {
    try {
      const response = await this.client.crm.associations.v4.basicApi.getPage(
        'deals', dealId, 'companies'
      );
      return response.results || [];
    } catch (error) {
      this._handleError(error);
    }
  }

  async listDeals(limit = 100) {
    try {
      const response = await this.client.crm.deals.basicApi.getPage(
        limit, undefined,
        ['dealname', 'dealstage', 'amount', 'closedate', 'createdate']
      );
      return response.results || [];
    } catch (error) {
      this._handleError(error);
    }
  }

  async updateDeal(dealId, properties) {
    try {
      const response = await this.client.crm.deals.basicApi.update(dealId, {
        properties,
      });
      return response;
    } catch (error) {
      this._handleError(error);
    }
  }

  _handleError(error) {
    const statusCode = error.response?.statusCode || error.statusCode;

    if (statusCode === 429) {
      const retryAfter = error.response?.headers?.['retry-after'];
      throw new RateLimitError(retryAfter);
    }

    if (statusCode === 404) {
      throw new HubSpotAPIError('Deal not found', 404);
    }

    if (statusCode >= 500) {
      throw new HubSpotAPIError('HubSpot server error', statusCode);
    }

    throw new HubSpotAPIError(
      error.message || 'HubSpot API error',
      statusCode || 500
    );
  }
}

module.exports = new HubSpotClient();
