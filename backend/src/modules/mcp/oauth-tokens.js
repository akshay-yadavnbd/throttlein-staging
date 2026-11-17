/** OAuth token format: `tin_<oat|ort|oac>_<43 base64url chars>` (access, refresh, authorization code). */
'use strict';
const crypto = require('crypto');

const KINDS = { oat: 'access', ort: 'refresh', oac: 'code' };
const TOKEN_RE = /^tin_(oat|ort|oac)_([A-Za-z0-9_-]{43})$/;

const newToken = (kind) => `tin_${kind}_${crypto.randomBytes(32).toString('base64url')}`;
const parseToken = (value) => {
  const m = TOKEN_RE.exec(String(value || ''));
  return m ? { kind: KINDS[m[1]] } : null;
};

module.exports = { newToken, parseToken };
