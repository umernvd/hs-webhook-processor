require('dotenv').config();
const Joi = require('joi');

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  MONGODB_URI: Joi.string().default('mongodb://localhost:27017/hs-webhook'),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  HUBSPOT_ACCESS_TOKEN: Joi.string().required(),
  HUBSPOT_CLIENT_SECRET: Joi.string().required(),
  HUBSPOT_APP_ID: Joi.string().allow('').optional(),
  QUEUE_CONCURRENCY: Joi.number().default(5),
  QUEUE_MAX_RETRIES: Joi.number().default(3),
  SMTP_HOST: Joi.string().allow('').optional(),
  SMTP_PORT: Joi.number().default(587),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASS: Joi.string().allow('').optional(),
  SMTP_FROM: Joi.string().allow('').optional(),
  PDF_STORAGE_PATH: Joi.string().default('./storage/quotes'),
  WORKFLOW_SECRET: Joi.string().allow('').optional(),
}).unknown();

const { error, value: env } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

const config = {
  env: env.NODE_ENV,
  port: env.PORT,

  hubspot: {
    accessToken: env.HUBSPOT_ACCESS_TOKEN,
    clientSecret: env.HUBSPOT_CLIENT_SECRET,
    appId: env.HUBSPOT_APP_ID,
  },

  mongodbUri: env.MONGODB_URI,

  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  },

  queue: {
    concurrency: env.QUEUE_CONCURRENCY,
    maxRetries: env.QUEUE_MAX_RETRIES,
  },

  email: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM,
  },

  storage: {
    quotesPath: env.PDF_STORAGE_PATH,
  },

  workflow: {
    secret: env.WORKFLOW_SECRET,
  },
};

module.exports = config;
