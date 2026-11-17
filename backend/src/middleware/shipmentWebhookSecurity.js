const crypto = require('crypto');
const rateLimit = require('./rateLimit');
const { env } = require('../config/env');
const { AppError } = require('../errors/AppError');

/**
 * Shiprocket's webhook token check. Fails closed: with no token configured
 * the endpoint answers 503, except on a non-production server that opted
 * into mock mode. Refusals are AppErrors so the error layer answers.
 */
function authenticateShipmentWebhook(req, res, next) {
  const token = env.SHIPROCKET_WEBHOOK_TOKEN || '';
  if (!token) {
    if (!env.isProduction && env.SHIPROCKET_MOCK_MODE) return next();
    return next(
      AppError.unavailable('Webhook authentication is not configured.', { reason: 'webhook-auth-not-configured' }),
    );
  }
  const supplied = String(req.get('x-api-key') || req.get('x-shiprocket-key') || '');
  const digest = (value) => crypto.createHash('sha256').update(value).digest();
  if (!crypto.timingSafeEqual(digest(token), digest(supplied))) {
    return next(AppError.unauthorized('Webhook token is missing or wrong.', { reason: 'bad-token' }));
  }
  return next();
}

// Runs before the JSON parser. Separate from login limits; permits courier bursts.
const shipmentWebhookLimit = rateLimit({ name: 'shipment-webhook', max: 600, window: 60 });
module.exports = { authenticateShipmentWebhook, shipmentWebhookLimit };
