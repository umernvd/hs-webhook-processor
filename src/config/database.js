const mongoose = require('mongoose');
const config = require('./index');
const logger = require('../utils/logger');

async function connectDatabase() {
  try {
    await mongoose.connect(config.mongodbUri);
    logger.info('Connected to MongoDB');
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    process.exit(1);
  }
}

async function closeDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}

async function query(collection, pipeline) {
  return mongoose.connection.db.collection(collection).aggregate(pipeline).toArray();
}

module.exports = { connectDatabase, closeDatabase, query, connection: mongoose.connection };
