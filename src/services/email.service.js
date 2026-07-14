const nodemailer = require('nodemailer');
const config = require('../config');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: {
        user: config.email.user,
        pass: config.email.pass,
      },
    });
  }

  async sendQuoteEmail(recipientEmail, recipientName, pdfPath, quoteNumber) {
    const mailOptions = {
      from: config.email.from,
      to: recipientEmail,
      subject: `Your Quote #${quoteNumber}`,
      html: `
        <p>Dear ${recipientName},</p>
        <p>Thank you for your interest! Please find your quote attached.</p>
        <p>If you have any questions, feel free to reach out.</p>
        <br>
        <p>Best regards,<br>Your Company Team</p>
      `,
      attachments: [
        {
          filename: `Quote-${quoteNumber}.pdf`,
          path: pdfPath,
        },
      ],
    };

    const info = await this.transporter.sendMail(mailOptions);
    return info;
  }

  async verifyConnection() {
    return await this.transporter.verify();
  }
}

module.exports = new EmailService();
