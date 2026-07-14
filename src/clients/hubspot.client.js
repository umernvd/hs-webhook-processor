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

  async getQuote(quoteId) {
    try {
      const response = await this.client.crm.quotes.basicApi.getById(
        quoteId,
        ['hs_title', 'hs_expiration_date', 'amount', 'hs_currency']
      );
      return response;
    } catch (error) {
      this._handleError(error);
    }
  }

  async getQuoteAssociations(quoteId) {
    try {
      const [deals, contacts] = await Promise.all([
        this.client.crm.associations.v4.basicApi.getPage('quotes', quoteId, 'deals'),
        this.client.crm.associations.v4.basicApi.getPage('quotes', quoteId, 'contacts'),
      ]);
      return {
        deals: deals.results || [],
        contacts: contacts.results || [],
      };
    } catch (error) {
      this._handleError(error);
    }
  }

  async getContact(contactId) {
    try {
      const response = await this.client.crm.contacts.basicApi.getById(
        contactId,
        ['email', 'firstname', 'lastname', 'company']
      );
      return response;
    } catch (error) {
      this._handleError(error);
    }
  }

  async getQuoteLineItems(quoteId) {
    try {
      const response = await this.client.crm.associations.v4.basicApi.getPage(
        'quotes', quoteId, 'line_items'
      );

      if (!response.results || response.results.length === 0) {
        return [];
      }

      const lineItemIds = response.results.map(r => r.toObjectId);
      const lineItems = await Promise.all(
        lineItemIds.map(id =>
          this.client.crm.lineItems.basicApi.getById(id, [
            'name', 'quantity', 'price', 'amount'
          ])
        )
      );

      return lineItems;
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
