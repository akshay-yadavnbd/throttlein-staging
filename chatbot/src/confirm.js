/**
 * Two-step changes. A write tool's first call returns a preview plus a signed
 * confirmation bound to the user, the tool and the exact arguments; the change
 * runs only when the same call comes back with that confirmation within five
 * minutes. The model cannot forge one, and a confirmation for one change
 * cannot be reused for another.
 */
'use strict';
const crypto = require('crypto');

function canonical(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const mac = (secret, text) => crypto.createHmac('sha256', secret).update(text).digest('base64url');

function sign(secret, { user, tool, args, ttlMs = 5 * 60 * 1000, now = Date.now }) {
  const body = Buffer.from(JSON.stringify({ u: user, t: tool, a: mac(secret, canonical(args)), e: now() + ttlMs }), 'utf8').toString('base64url');
  return { confirmation: `${body}.${mac(secret, body)}`, expiresAt: new Date(now() + ttlMs).toISOString() };
}

/** 'ok' | 'expired' | 'invalid' */
function check(secret, confirmation, { user, tool, args, now = Date.now }) {
  if (typeof confirmation !== 'string' || confirmation.length > 600) return 'invalid';
  const dot = confirmation.lastIndexOf('.');
  if (dot < 1) return 'invalid';
  const body = confirmation.slice(0, dot);
  const sig = Buffer.from(confirmation.slice(dot + 1), 'base64url');
  const expected = Buffer.from(mac(secret, body), 'base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return 'invalid';
  let data;
  try { data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return 'invalid'; }
  if (data.u !== user || data.t !== tool || data.a !== mac(secret, canonical(args))) return 'invalid';
  if (data.e < now()) return 'expired';
  return 'ok';
}

module.exports = { sign, check, canonical };
