const Joi = require('joi');

const dealUpdateSchema = Joi.object({
  dealname: Joi.string().optional(),
  amount: Joi.number().optional(),
  dealstage: Joi.string().optional(),
  pipeline: Joi.string().optional(),
  hs_health_score: Joi.number().optional(),
}).min(1).required();

module.exports = { dealUpdateSchema };
