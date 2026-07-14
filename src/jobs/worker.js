const { Worker } = require('bullmq');
const { connection } = require('../config/queue');
const config = require('../config');
const { connectDatabase, closeDatabase } = require('../config/database');
const processDealJob = require('./dealProcessor.job');
const processQuoteJob = require('./quoteProcessor.job');
const logger = require('../utils/logger');

connectDatabase().then(() => {
  const worker = new Worker('deal-processing', async (job) => {
    if (job.name === 'process-quote') {
      return await processQuoteJob(job);
    }
    return await processDealJob(job);
  }, {
    connection,
    concurrency: config.queue.concurrency,
    limiter: {
      max: 10,
      duration: 1000,
    },
  });

  worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job.id} failed`, { error: err.message });
  });

  worker.on('error', (err) => {
    logger.error('Worker error', { error: err.message });
  });

  logger.info('Worker started');

  async function gracefulShutdown(signal) {
    logger.info(`${signal} received. Closing worker...`);

    await worker.close();
    logger.info('Worker closed');

    await connection.quit();
    logger.info('Redis connection closed');

    await closeDatabase();
    logger.info('Database connection closed');

    process.exit(0);
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}).catch((error) => {
  logger.error('Failed to start worker:', error);
  process.exit(1);
});
