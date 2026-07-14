const hubspotClient = require('../clients/hubspot.client');
const pdfService = require('./pdf.service');
const emailService = require('./email.service');
const logger = require('../utils/logger');

class QuoteService {
  async processQuote(quoteId, overrideContactId = null) {
    try {
      logger.info('Processing quote', { quoteId: quoteId });

      const [quote, associations] = await Promise.all([
        hubspotClient.getQuote(quoteId),
        hubspotClient.getQuoteAssociations(quoteId),
      ]);

      let contact;

      if (overrideContactId) {
        contact = await hubspotClient.getContact(overrideContactId);
        if (!contact.properties.email) {
          throw new Error('Specified contact has no email address');
        }
      } else {
        if (!associations.contacts || associations.contacts.length === 0) {
          throw new Error('No contact associated with quote');
        }

        contact = null;
        for (const assoc of associations.contacts) {
          const c = await hubspotClient.getContact(assoc.toObjectId);
          if (c.properties.email) {
            contact = c;
            break;
          }
        }

        if (!contact) {
          throw new Error('No associated contact has an email address');
        }
      }

      const lineItems = await hubspotClient.getQuoteLineItems(quoteId);

      const contactName = [
        contact.properties.firstname || '',
        contact.properties.lastname || ''
      ].join(' ').trim();

      const mappedLineItems = lineItems.map(function(item) {
        return {
          name: item.properties.name,
          quantity: parseFloat(item.properties.quantity) || 1,
          price: parseFloat(item.properties.price) || 0,
        };
      });

      const computedSubtotal = mappedLineItems.reduce(function(sum, item) {
        return sum + item.quantity * item.price;
      }, 0);

      const quoteData = {
        hubspotQuoteId: quoteId,
        contactName: contactName,
        lineItems: mappedLineItems,
        subtotal: computedSubtotal,
        currency: quote.properties.hs_currency || 'USD',
      };

      const { pdfPath } = await pdfService.generateQuotePDF(quoteData);

      await emailService.sendQuoteEmail(
        contact.properties.email,
        quoteData.contactName,
        pdfPath,
        quoteId
      );

      logger.info('Quote processed successfully', { quoteId: quoteId });
      return { success: true, quoteId: quoteId };

    } catch (error) {
      logger.error('Failed to process quote', {
        quoteId: quoteId,
        error: error.message,
      });
      throw error;
    }
  }
}

module.exports = new QuoteService();
