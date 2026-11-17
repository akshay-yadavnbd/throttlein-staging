/**
 * The global error layer — the single place that turns a failure into an
 * HTTP response. Express 5 forwards rejected async handlers here.
 *
 * Every error answers with one envelope:
 *
 *   { success: false, code, message, details?, requestId }
 *
 *   code       one of errors/codes.js — what clients branch on
 *   message    a sentence for the person (frontends may swap it from
 *              their own catalogue, keyed by code)
 *   details    structured, caller-safe extras (field issues …)
 *   requestId  the X-Request-Id of this request, for support lookups
 *
 * What it understands, in order:
 *   - AppError                      → its status, code, message, details
 *   - legacy throws: `res.status(n); throw new Error(m)` or an error
 *     carrying `status` / `statusCode`  → that status, code derived from it
 *   - Mongoose: VersionError (409), CastError (400), duplicate key (409),
 *     ValidationError (400); Multer limits (413 / 400)
 *   - anything else                 → 500, logged in full, message masked
 *                                    in production
 */
const { env } = require('../config/env');
const { AppError } = require('../errors/AppError');
const { ErrorCodes, codeForStatus } = require('../errors/codes');
const { safeRequestPath } = require('./requestSecurity');
const { logger } = require('../utils/logger');

function notFound(req, _res, next) {
  next(AppError.notFound(`Not found - ${req.originalUrl}`));
}

/** Translate whatever was thrown into { status, code, message, details, log }. */
function classify(err, res) {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details, log: err.status >= 500 };
  }
  // Mongoose / driver / upload errors first: they carry no status of their own.
  if (err.name === 'VersionError')
    return { status: 409, code: 'VERSION_CONFLICT', message: ErrorCodes.VERSION_CONFLICT.message };
  if (err.name === 'CastError' && err.kind === 'ObjectId')
    return { status: 400, code: 'BAD_REQUEST', message: 'Invalid resource id' };
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return {
      status: 409,
      code: 'CONFLICT',
      message: `Duplicate ${field}: a record with that value already exists.`,
      details: { field },
    };
  }
  if (err.name === 'ValidationError' && err.errors) {
    const issues = Object.entries(err.errors).map(([path, v]) => ({ path, message: v.message }));
    return {
      status: 400,
      code: 'VALIDATION_FAILED',
      message: issues.map((i) => i.message).join(', '),
      details: { issues },
    };
  }
  if (err.name === 'MulterError') {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    return {
      status: tooLarge ? 413 : 400,
      code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
      message: ErrorCodes.PAYLOAD_TOO_LARGE.message,
    };
  }
  // Body-parser / express errors carry `status` (400 bad JSON, 413 too large).
  const supplied = Number(err.status || err.statusCode);
  const status = supplied >= 400 && supplied <= 599 ? supplied : res.statusCode >= 400 ? res.statusCode : 500;
  const code = codeForStatus(status);
  const message = err.message || ErrorCodes[code].message;
  return { status, code, message, details: err.details, log: status >= 500 };
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const { status, code, details } = classify(err, res);
  let { message } = classify(err, res);

  if (status >= 500) {
    // Full detail to the log (the request id rides along from the logger's
    // request context); never the stack or internals to the client.
    logger.error({ err, status, code, method: req.method, path: safeRequestPath(req) }, 'request failed');
    if (env.isProduction) message = ErrorCodes.INTERNAL_ERROR.message;
  }

  const body = { success: false, code, message };
  if (details !== undefined) body.details = details;
  if (req.id) body.requestId = req.id;
  if (!env.isProduction && status >= 500) body.stack = err.stack;
  res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
