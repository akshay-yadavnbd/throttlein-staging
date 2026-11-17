/**
 * Who is talking to the assistant. The dashboard sends the same JWT it uses
 * for the API; we never decode or trust it ourselves — the API's /auth/me
 * decides, exactly as it does for every dashboard request, and we admit only
 * sellers and superadmins. Resolved identities are cached briefly per token.
 */
'use strict';
const crypto = require('crypto');

const ALLOWED_ROLES = new Set(['seller', 'superadmin']);
const CACHE_TTL_MS = 60 * 1000;

class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createAuth({ backend, now = Date.now }) {
  const cache = new Map();
  const key = (token) => crypto.createHash('sha256').update(token).digest('hex');

  async function resolve(token) {
    if (!token) throw new AuthError(401, 'Sign in to use the assistant.');
    const k = key(token);
    const hit = cache.get(k);
    if (hit && hit.expires > now()) return hit.user;
    let data;
    try { data = await backend.call(token, { method: 'GET', path: '/auth/me' }); } catch (error) {
      if (error.status === 401 || error.status === 403) throw new AuthError(401, 'Your session has ended. Sign in again.');
      throw new AuthError(503, 'The Throttlein API is not reachable right now.');
    }
    const u = data?.user;
    if (!u || !ALLOWED_ROLES.has(u.role)) throw new AuthError(403, 'The assistant is available to sellers and superadmins only.');
    if (u.status === 'suspended') throw new AuthError(403, 'This account is suspended.');
    const user = Object.freeze({
      id: String(u._id || u.id), name: u.name || '', email: u.email || '', role: u.role,
      storeName: u.storeName || '', status: u.status || '', kycStatus: u.kyc?.status || 'not_started',
    });
    if (cache.size > 5000) cache.clear();
    cache.set(k, { user, expires: now() + CACHE_TTL_MS });
    return user;
  }

  return { resolve, AuthError };
}

module.exports = { createAuth, AuthError, ALLOWED_ROLES };
