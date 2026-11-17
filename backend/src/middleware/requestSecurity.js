const crypto = require('node:crypto');
const { env } = require('../config/env');
const { AppError } = require('../errors/AppError');

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** Reject query operators, update paths and prototype keys; never silently rewrite input. */
function assertSafeInput(value, depth = 0, budget = { remaining: 25000 }) {
  if (depth > 32 || --budget.remaining < 0) {
    throw AppError.badRequest('Request structure is too complex.');
  }
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.') || FORBIDDEN_KEYS.has(key) || key.includes('\0')) {
      throw AppError.badRequest('Invalid request field.');
    }
    assertSafeInput(value[key], depth + 1, budget);
  }
}

function validateRequest(req, _res, next) {
  try {
    assertSafeInput(req.body);
    assertSafeInput(req.query);
    // Query parameters are scalar throughout this API. Duplicate/nested
    // values must not become arrays or MongoDB selector objects.
    for (const [key, value] of Object.entries(req.query || {})) {
      if (typeof value !== 'string' || key.includes('[') || key.includes(']') || value.length > 4000) {
        throw AppError.badRequest('Invalid query parameter.');
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (env.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  if (req.headers.authorization) res.setHeader('Cache-Control', 'private, no-store');
  next();
}

function emailRateKey(req) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return crypto.createHash('sha256').update(email).digest('hex');
}

function safeRequestPath(req) {
  return String(req.originalUrl || req.path || '')
    .split('?')[0]
    .replace(/(\/(?:reset-password|verify-email|set-password)\/)[^/]+/g, '$1[redacted]');
}

module.exports = { assertSafeInput, validateRequest, securityHeaders, emailRateKey, safeRequestPath };
