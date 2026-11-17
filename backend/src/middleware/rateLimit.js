/**
 * Per-IP rate-limit middleware backed by Redis. Lightweight wrapper around
 * utils/rateLimitStore.rateLimit so route files can just do:
 *
 *   router.post('/login', rateLimit({ name: 'login', max: 10, window: 60 }), ctrl.login);
 *
 * `name`     — namespace for the bucket (`rl:<name>:<ip>`).
 * `max`      — allowed hits per window.
 * `window`   — window length in seconds (default 60).
 * `keyBy`    — optional function (req) => string to override the IP key
 *              (e.g. rate-limit by email on /forgot-password).
 *
 * Uses a bounded local fallback if Redis is down.
 */
const { rateLimit } = require('../utils/rateLimitStore');
const { AppError } = require('../errors/AppError');

function ipOf(req) {
  // Trust proxy is enabled by ELB / Cloudflare; req.ip will be the original.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** @param {{ name: string, max?: number, window?: number, keyBy?: (req: import('express').Request) => string }} opts */
module.exports = function rateLimitMiddleware({ name, max = 60, window = 60, keyBy }) {
  if (!name) throw new Error('rateLimit middleware requires a `name`');
  return async function (req, res, next) {
    const id = (keyBy ? keyBy(req) : ipOf(req)) || 'unknown';
    const key = `rl:${name}:${id}`;
    try {
      const r = await rateLimit(key, max, window);
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', r.remaining);
      res.setHeader('X-RateLimit-Reset', r.resetIn);
      if (!r.allowed) {
        res.setHeader('Retry-After', r.resetIn);
        // The error layer writes the envelope; `details.retryAfter` is what the
        // storefront's import dialog counts down from.
        return next(
          AppError.rateLimited('Too many requests. Please wait a moment and try again.', { retryAfter: r.resetIn }),
        );
      }
    } catch (err) {
      return next(AppError.unavailable('Request protection temporarily unavailable.'));
    }
    next();
  };
};
