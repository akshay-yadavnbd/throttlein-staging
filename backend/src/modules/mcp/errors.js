/**
 * A refusal or failure whose code and message are safe to show the client.
 * Every code here is explained by `tin_access_explain`; anything else that
 * escapes a tool is reported as INTERNAL with a request reference only.
 */
'use strict';

class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const EXPLANATIONS = Object.freeze({
  TOKEN_MISSING: 'No bearer token was sent. Sign in to the connector again.',
  TOKEN_INVALID: 'The token is malformed, unknown or revoked. Sign in again.',
  TOKEN_EXPIRED: 'The access token or the approval period expired. The client refreshes or asks you to sign in again.',
  OWNER_INVALID: 'The staff account behind this connection no longer exists, is suspended or is not a staff role.',
  SERVICE_OFF: 'The AI connector is switched off by a superadmin (Admin → AI connector).',
  USER_NOT_ALLOWED: 'This staff member is not on the AI connector allow-list; ask a superadmin.',
  APP_NOT_ALLOWED: "The AI app's redirect address is not on the allowed list; a superadmin can add it.",
  AUTH_LOCKED: 'Too many failed sign-in attempts from this address; wait 15 minutes.',
  RATE_LIMITED: 'Too many calls in the last minute for this connection or person.',
  QUOTA_EXCEEDED: 'The daily record quota for this connection is used up.',
  TOO_MANY_CONCURRENT: 'Too many calls running at once for this person; retry shortly.',
  CURSOR_INVALID: 'The pagination cursor is invalid, expired or belongs to another tool or person.',
  TIMEOUT: 'The query took too long; narrow the filters.',
  AUDIT_UNAVAILABLE:
    'The request could not be recorded, so its result was withheld. Share the reference with engineering.',
  NOT_FOUND: 'Nothing matches that reference.',
  INVALID_ARGUMENT: 'An argument is missing or not valid; the message says which.',
  CONTACT_NOT_GRANTED:
    'This connection may not reveal contact details; values stay masked. Needs the contact:read scope and the superadmin switch.',
  TOOL_DISABLED: 'A superadmin switched this tool off.',
  FORBIDDEN: 'This connection may not read that area (the staff member lacks the admin permission).',
  UNAVAILABLE: 'A data source (database or cache) is not available right now.',
  INTERNAL: 'Unexpected error; share the reference with engineering.',
});

module.exports = { ToolError, EXPLANATIONS };
