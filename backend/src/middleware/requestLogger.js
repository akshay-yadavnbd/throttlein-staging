/**
 * One structured line per request when the response finishes: method, path,
 * status, duration, and the caller's user id when authenticated. Replaces
 * morgan. The request id is added by the logger's request context.
 *
 * The path is `safeRequestPath` (no query string, tokens in reset / verify
 * links redacted) so a log line can never carry a credential.
 */
const { logger } = require('../utils/logger');
const { safeRequestPath } = require('./requestSecurity');

const QUIET_PATHS = new Set(['/api/health']);

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const path = safeRequestPath(req);
    const status = res.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : QUIET_PATHS.has(path) ? 'debug' : 'info';
    const line = { method: req.method, path, status, durationMs: Math.round(durationMs * 10) / 10 };
    if (req.user?._id) line.userId = String(req.user._id);
    if (req.impersonation?.adminId) line.impersonatedBy = String(req.impersonation.adminId);
    logger[level](line, 'request completed');
  });
  next();
}

module.exports = { requestLogger };
