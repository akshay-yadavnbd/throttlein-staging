/**
 * Process entry point: .env → validated config → database → boot tasks →
 * HTTP server → background workers → graceful shutdown.
 *
 *   npm start            node src/index.js
 *   npm run dev          nodemon src/index.js
 *
 * `backend/server.js` is a one-line shim that requires this file, kept for
 * callers that still name it.
 */
// Load backend/.env first (every entry point does), then the validated
// configuration: it checks every variable the server reads (fails fast in
// production on a missing MONGO_URI or a weak JWT_SECRET) and is the only
// module that touches process.env.
require('./config/loadEnv');
const { env } = require('./config/env');

const http = require('node:http');
const mongoose = require('mongoose');
const { rootLogger: log } = require('./utils/logger');
const connectDB = require('./database/mongo');
const { createApp } = require('./app');

const PORT = env.PORT || 5000;
const SHUTDOWN_GRACE_MS = 10_000;

/** One-off work that must finish before the first request is served. */
async function runBootTasks() {
  await require('./modules/orders/shipment-event.model').init();
  await require('./utils/retainCheckoutIntents')();
  for (const seed of [
    'seedAdmin',
    'seedCategories',
    'seedBrands',
    'seedPages',
    'seedFaqs',
    'seedPromoBlocks',
    'seedHomeSeoBlock',
    'seedMediaBackfill',
    'seedMediaReferencePrune',
  ]) {
    await require(`./database/seed/${seed}`)();
  }
}

/** Interval workers. Each start* returns a stop function. */
function startWorkers() {
  return [
    require('./modules/orders').startShipmentWorker(),
    require('./modules/customers').startCartReminderWorker(),
  ].filter((stop) => typeof stop === 'function');
}

async function main() {
  await connectDB();
  await runBootTasks();

  const app = createApp();
  const server = http.createServer(app);
  let stopWorkers = [];

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, () => {
      server.off('error', reject);
      stopWorkers = startWorkers();
      log.info(
        { port: PORT, revision: env.DEPLOY_COMMIT || 'local', env: env.NODE_ENV },
        `Seller Management API listening on http://localhost:${PORT}`,
      );
      if (!env.RAZORPAY_WEBHOOK_SECRET) {
        log.warn(
          'razorpay: webhook disabled — RAZORPAY_WEBHOOK_SECRET is not set, so /api/hooks/razorpay rejects every event',
        );
      }
      resolve();
    });
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    // Hard exit if the graceful close hangs; armed before anything awaits.
    setTimeout(() => {
      log.error('shutdown timed out; exiting');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();

    for (const stop of stopWorkers) {
      try {
        stop();
      } catch (err) {
        log.error({ err }, 'worker stop failed');
      }
    }
    // Stop accepting, drop idle keep-alive sockets, let in-flight requests finish.
    server.closeIdleConnections?.();
    const closeError = await new Promise((resolve) => server.close(resolve));
    if (closeError) log.error({ err: closeError }, 'error closing http server');

    try {
      const redis = require('./database/redis').getClient();
      if (redis && typeof redis.quit === 'function') await redis.quit();
    } catch (err) {
      log.error({ err }, 'error closing redis');
    }
    await mongoose.connection.close().catch((err) => log.error({ err }, 'error closing mongodb'));
    log.info('shutdown complete');
    process.exit(closeError ? 1 : 0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

// Crash policy, on purpose:
//  - unhandledRejection: log and carry on. Background workers fire many
//    fire-and-forget promises (emails, Shiprocket pushes); a transient
//    rejection in one must not take the API down.
//  - uncaughtException: Node's default (fatal). A synchronous throw that
//    escaped every handler means unknowable in-process state.
process.on('unhandledRejection', (reason) => {
  log.error({ err: reason }, 'unhandled promise rejection');
});

main().catch((err) => {
  log.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
