/**
 * Request id — one id per request, on the response header, on every error
 * envelope and on every log line, so a user-reported failure ("reference
 * abc123") can be matched to the server log that caused it.
 *
 * Honours an incoming `X-Request-Id` from a trusted proxy (same id end to
 * end); otherwise mints one. Stored on `req.id` and `res.locals.requestId`,
 * and the rest of the request runs inside the logger's request context so
 * `logger.*` calls anywhere downstream carry it automatically.
 */
const crypto = require('node:crypto');
const { runWithRequestContext } = require('../utils/logger');

const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  const id = incoming && SAFE_ID.test(incoming) ? incoming : crypto.randomUUID();
  req.id = id;
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  runWithRequestContext(id, () => next());
}

module.exports = { requestId };
