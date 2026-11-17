/**
 * Typed error codes — the vocabulary clients key off.
 *
 * Every refusal the API makes carries one of these in the response's `code`
 * field, next to a human sentence in `message`. Frontends branch on the
 * code (and may replace the sentence from their own message catalogue);
 * the sentence is never parsed.
 *
 * Each entry: the HTTP status it answers with and the default sentence a
 * throw site gets when it supplies none.
 */
const ErrorCodes = Object.freeze({
  BAD_REQUEST: { status: 400, message: 'The request could not be understood.' },
  VALIDATION_FAILED: { status: 400, message: 'Some details are missing or invalid.' },
  UNAUTHORIZED: { status: 401, message: 'Sign in to continue.' },
  FORBIDDEN: { status: 403, message: 'You don’t have permission to do this.' },
  NOT_FOUND: { status: 404, message: 'That record could not be found.' },
  CONFLICT: { status: 409, message: 'This conflicts with an existing record.' },
  VERSION_CONFLICT: { status: 409, message: 'This record changed. Refresh and try again.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'Upload exceeds the allowed limits.' },
  UNPROCESSABLE: { status: 422, message: 'The request is valid but cannot be processed.' },
  RATE_LIMITED: { status: 429, message: 'Too many requests. Please wait a moment and try again.' },
  INTERNAL_ERROR: { status: 500, message: 'An internal error occurred. Please try again.' },
  UPSTREAM_ERROR: { status: 502, message: 'A service we depend on did not respond correctly.' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'This feature is not available right now.' },
});

/** The code a bare status maps to when a legacy throw site supplied only a status. */
function codeForStatus(status) {
  switch (Number(status)) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 422:
      return 'UNPROCESSABLE';
    case 429:
      return 'RATE_LIMITED';
    case 502:
      return 'UPSTREAM_ERROR';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return Number(status) >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  }
}

module.exports = { ErrorCodes, codeForStatus };
