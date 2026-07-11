const { Queue } = require('bullmq');
const Redis = require('ioredis');
const config = require('./index');

let _connection;
let _dealQueue;

function getConnection() {
  if (!_connection) {
    _connection = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      maxRetriesPerRequest: null,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    _connection.on('error', () => {});
  }

  return _connection;
}

function getQueue() {
  if (!_dealQueue) {
    const conn = getConnection();

    _dealQueue = new Queue('deal-processing', {
      connection: conn,
      defaultJobOptions: {
        attempts: config.queue.maxRetries,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: {
          age: 24 * 3600,
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 3600,
        },
      },
    });
  }

  return _dealQueue;
}

async function closeConnections() {
  if (_dealQueue) {
    await _dealQueue.close();
    _dealQueue = null;
  }

  if (_connection) {
    await _connection.quit();
    _connection = null;
  }
}

module.exports = {
  get connection() { return getConnection(); },
  get dealQueue() { return getQueue(); },
  closeConnections,
};
