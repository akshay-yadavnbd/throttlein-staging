/**
 * AppError — the one operational error type.
 *
 * Controllers and services throw it (usually via a factory); the global
 * error middleware (middleware/errorHandler.js) is the only place that
 * turns it into an HTTP response:
 *
 *   throw AppError.notFound('Order not found.');
 *   throw AppError.badRequest('Quantity must be at least 1.', { field: 'qty' });
 *   throw AppError.forbidden();                       // default sentence for the code
 *   throw new AppError('CONFLICT', 'Email already in use.');
 *
 * Anything thrown that is NOT an AppError (and carries no status) is a bug:
 * the middleware answers 500 and logs it in full.
 *
 * `details` is for structured, caller-safe extras (field issues, the
 * current version on a conflict); it is sent to the client as-is, so it
 * must never carry secrets or other users' data.
 */
const { ErrorCodes } = require('./codes');

class AppError extends Error {
  /**
   * @param {keyof typeof ErrorCodes | (string & {})} code  a listed code, or a domain-specific one with `options.status`
   * @param {string} [message]  sentence for the person; defaults to the code's
   * @param {unknown} [details] structured, caller-safe extras
   * @param {{ cause?: unknown, status?: number }} [options]
   */
  constructor(code, message, details, options = {}) {
    const def = ErrorCodes[code];
    // A domain-specific code (USER_NOT_FOUND, WRONG_PASSWORD, EMAIL_UNVERIFIED …
    // the auth screens already branch on these) is allowed when the throw
    // site names the status it answers with.
    if (!def && !options.status)
      throw new TypeError(`Unknown error code: ${code} (pass { status } for a domain-specific code)`);
    super(
      message || (def ? def.message : ErrorCodes.BAD_REQUEST.message),
      options.cause ? { cause: options.cause } : undefined,
    );
    this.name = 'AppError';
    this.code = code;
    this.status = options.status || def.status;
    this.details = details;
    this.expose = true;
  }

  static badRequest(message, details) {
    return new AppError('BAD_REQUEST', message, details);
  }
  static validation(message, details) {
    return new AppError('VALIDATION_FAILED', message, details);
  }
  static unauthorized(message, details) {
    return new AppError('UNAUTHORIZED', message, details);
  }
  static forbidden(message, details) {
    return new AppError('FORBIDDEN', message, details);
  }
  static notFound(message, details) {
    return new AppError('NOT_FOUND', message, details);
  }
  static conflict(message, details) {
    return new AppError('CONFLICT', message, details);
  }
  static versionConflict(message, details) {
    return new AppError('VERSION_CONFLICT', message, details);
  }
  static tooLarge(message, details) {
    return new AppError('PAYLOAD_TOO_LARGE', message, details);
  }
  static unprocessable(message, details) {
    return new AppError('UNPROCESSABLE', message, details);
  }
  static rateLimited(message, details) {
    return new AppError('RATE_LIMITED', message, details);
  }
  static internal(message, cause) {
    return new AppError('INTERNAL_ERROR', message, undefined, { cause });
  }
  static upstream(message, cause) {
    return new AppError('UPSTREAM_ERROR', message, undefined, { cause });
  }
  static unavailable(message, details) {
    return new AppError('SERVICE_UNAVAILABLE', message, details);
  }

  /** Legacy helper: an AppError for a bare status + message (the old `res.status(n); throw` idiom). */
  static fromStatus(status, message, details) {
    const { codeForStatus } = require('./codes');
    return new AppError(codeForStatus(status), message, details, { status: Number(status) });
  }
}

module.exports = { AppError };
