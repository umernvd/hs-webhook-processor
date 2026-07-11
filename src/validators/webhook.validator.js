const Joi = require('joi');
const { ValidationError } = require('../errors/customErrors');

const webhookEventSchema = Joi.object({
  objectId: Joi.number().required(),
  propertyName: Joi.string().optional(),
  propertyValue: Joi.string().optional(),
  changeSource: Joi.string().optional(),
  eventId: Joi.number().required(),
  subscriptionId: Joi.number().required(),
  portalId: Joi.number().required(),
  occurredAt: Joi.number().required(),
});

const webhookPayloadSchema = Joi.array().items(webhookEventSchema).min(1);

function validateWebhookPayload(payload) {
  const { error, value } = webhookPayloadSchema.validate(payload);

  if (error) {
    throw new ValidationError(`Invalid webhook payload: ${error.message}`);
  }

  return value;
}

module.exports = { validateWebhookPayload };
