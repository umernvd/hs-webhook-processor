const app = require('./src/app');
const config = require('./src/config');
const { connectDatabase, closeDatabase } = require('./src/config/database');
const { closeConnections } = require('./src/config/queue');
const logger = require('./src/utils/logger');

async function start() {
  await connectDatabase();

  const server = app.listen(config.port, () => {
    logger.info(`Server running on port ${config.port}`);
  });

  async function gracefulShutdown(signal) {
    logger.info(`${signal} received. Starting graceful shutdown...`);

    server.close(() => {
      logger.info('HTTP server closed');
    });

    try {
      await closeConnections();
      logger.info('Queue connections closed');

      await closeDatabase();
      logger.info('Database connection closed');

      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

start().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
