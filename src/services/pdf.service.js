const path = require('path');
const fs = require('fs').promises;
const puppeteer = require('puppeteer');
const handlebars = require('handlebars');
const config = require('../config');

handlebars.registerHelper('multiply', function(a, b) {
  return (a * b).toFixed(2);
});

class PDFService {
  async generateQuotePDF(quoteData) {
    const { hubspotQuoteId, contactName, lineItems, subtotal, currency } = quoteData;

    const templatePath = path.join(__dirname, '../templates/quote.hbs');
    const templateSource = await fs.readFile(templatePath, 'utf8');
    const template = handlebars.compile(templateSource);

    const html = template({
      quoteNumber: hubspotQuoteId,
      date: new Date().toLocaleDateString(),
      contactName: contactName,
      lineItems: lineItems,
      subtotal: subtotal.toFixed(2),
      tax: (subtotal * 0.1).toFixed(2),
      total: (subtotal * 1.1).toFixed(2),
      currency: currency,
    });

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    await fs.mkdir(config.storage.quotesPath, { recursive: true });

    const fileName = `quote-${hubspotQuoteId}-${Date.now()}.pdf`;
    const pdfPath = path.join(config.storage.quotesPath, fileName);

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        bottom: '20px',
        left: '20px',
        right: '20px',
      },
    });

    await browser.close();

    return { pdfPath, html };
  }
}

module.exports = new PDFService();
