const mongoose = require('mongoose');
const { env } = require('../config/env');
const { logger } = require('../utils/logger');

async function connectDB() {
  const uri = env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set in .env');

  mongoose.set('strictQuery', true);
  const conn = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
  });
  logger.info(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
  return conn;
}

module.exports = connectDB;
