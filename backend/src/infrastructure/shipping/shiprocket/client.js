const { env } = require('../../../config/env');
const { logger } = require('../../../utils/logger');
const { isLive } = require('../../../config/appEnv');
/**
 * Shiprocket API service.
 *
 * Centralised wrapper around https://apiv2.shiprocket.in — every other piece
 * of the integration (pickup-location sync, order create, AWB, pickup,
 * webhooks) imports from here so we only deal with auth / errors in one
 * place.
 *
 * Auth model
 * ----------
 * Shiprocket gives us a JWT in exchange for { email, password }. The token
 * lasts ~10 days. We cache it in-memory and refresh slightly before expiry.
 * Multi-instance deployments would want Redis, but for a single Node process
 * this is fine.
 *
 * Requires Node 18+ for native `fetch`. The backend already runs on Node 18
 * via the nodemon dev script, so no extra dependency.
 *
 * Env vars
 * --------
 *   SHIPROCKET_API_BASE   default https://apiv2.shiprocket.in/v1
 *   SHIPROCKET_EMAIL      API user email from Settings → API → Configure
 *   SHIPROCKET_PASSWORD   API user password
 */

const API_BASE = (env.SHIPROCKET_API_BASE || 'https://apiv2.shiprocket.in/v1').replace(/\/$/, '');
const EMAIL = env.SHIPROCKET_EMAIL || '';
const PASSWORD = env.SHIPROCKET_PASSWORD || '';

/**
 * Mock mode
 * ---------
 * When SHIPROCKET_MOCK_MODE=true in .env, every wrapper below returns a
 * realistic fake payload INSTEAD of hitting the live API. Useful for
 * developing on localhost without burning wallet balance. Toggle off in
 * production.
 *
 * What's mocked vs real
 *   - AWB code:     MOCK<timestamp>-<rand>
 *   - Courier name: "MockExpress (Demo)"
 *   - Label URL:    points to a static placeholder on our own backend
 *   - Tracking:     two-step "Picked up" → "Out for delivery" stub
 *   - OTP:          accepts any 6-digit code, or hardcoded "123456"
 *
 * NOTE: createOrder() and generateAwb() still produce IDs that look real
 * enough to flow through our own DB / UI — sellerShipments entries get
 * populated as if Shiprocket accepted the order.
 */
const MOCK = String(env.SHIPROCKET_MOCK_MODE || '').toLowerCase() === 'true';
// Refused on the live site only. Staging runs with NODE_ENV=production
// too, but APP_ENV=staging marks it as not live (src/config/appEnv.js).
if (MOCK && isLive()) {
  throw new Error('SHIPROCKET_MOCK_MODE must be disabled in production');
}

let mockBannerPrinted = false;
function mockLog(fn) {
  if (!mockBannerPrinted) {
    logger.info(
      '%s',
      '\n┌─ SHIPROCKET MOCK MODE ──────────────────────────────────────┐\n' +
        '│  All Shiprocket API calls are returning fake data.          │\n' +
        '│  No wallet charges. No real AWBs. No real couriers.         │\n' +
        '│  Set SHIPROCKET_MOCK_MODE=false in backend/.env to go live. │\n' +
        '└─────────────────────────────────────────────────────────────┘\n',
    );
    mockBannerPrinted = true;
  }
  logger.info(`[shiprocket-mock] ${fn}`);
}

const mockRand = () => Math.random().toString(36).slice(2, 8).toUpperCase();

// Base URL the seller's browser uses to reach our backend. Configurable via
// env (BACKEND_PUBLIC_URL) so this works behind ngrok / tunnels too.
const MOCK_BASE_URL = env.BACKEND_PUBLIC_URL || `http://localhost:${env.PORT || 5000}`;

// In-process state for mock mode. Persists across requests within a single
// Node process. Restarting the backend clears it (which is desirable —
// matches what would happen on a fresh Shiprocket sandbox account).
const mockState = {
  pickups: new Map(), // nickname -> { id, ...details }
  nextPickupId: 90001,
  // Pre-verified=true so the seller doesn't need to OTP-verify in mock mode.
  defaultVerified: true,
};

function mockAddPickup(payload) {
  const id = mockState.nextPickupId++;
  const entry = {
    id,
    pickup_location: payload.pickup_location,
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    address: payload.address,
    address_2: payload.address_2 || '',
    city: payload.city,
    state: payload.state,
    country: payload.country || 'India',
    pin_code: payload.pin_code,
    phone_verified: mockState.defaultVerified ? 1 : 0,
    status: 1,
  };
  mockState.pickups.set(payload.pickup_location.toLowerCase(), entry);
  return entry;
}

// Shiprocket tokens are valid for 10 days; refresh slightly early to be safe.
const TOKEN_LIFETIME_MS = 9 * 24 * 60 * 60 * 1000;

let tokenCache = { token: null, expiresAt: 0 };
// In-flight login promise so concurrent first-time callers share the same network call.
let loginInFlight = null;

/**
 * Returns a usable JWT, refreshing if needed. Throws if credentials are
 * missing or the API rejects them.
 */
async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }
  if (loginInFlight) return loginInFlight;

  if (!EMAIL || !PASSWORD) {
    throw new Error('Shiprocket credentials missing. Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in backend/.env.');
  }

  loginInFlight = (async () => {
    const r = await fetch(`${API_BASE}/external/auth/login`, {
      signal: AbortSignal.timeout(20000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    /** @type {any} carrier JSON */
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.token) {
      throw new Error(`Shiprocket login failed (${r.status}): ${data.message || JSON.stringify(data)}`);
    }
    tokenCache = {
      token: data.token,
      expiresAt: Date.now() + TOKEN_LIFETIME_MS,
    };
    return data.token;
  })().finally(() => {
    loginInFlight = null;
  });

  return loginInFlight;
}

/**
 * Low-level request helper. All wrappers below funnel through this so we
 * have one place that handles token injection, JSON encoding, and Shiprocket's
 * sometimes-helpful error shape `{ message, errors }`.
 */
async function srRequest(method, path, body) {
  // Safety net: in mock mode, every wrapper above should have short-circuited
  // before reaching here. If we got here, we're about to hit the live API by
  // mistake — abort loudly so the bug surfaces in dev rather than silently
  // burning wallet balance.
  if (MOCK) {
    throw new Error(
      `MOCK MODE LEAK: srRequest(${method} ${path}) was called but no mock wrapper handled it. Add a mock branch in shiprocket.js.`,
    );
  }
  const token = await getToken();
  const url = path.startsWith('http') ? path : `${API_BASE}/external${path.startsWith('/') ? '' : '/'}${path}`;

  const r = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  /** @type {any} carrier JSON */
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Shiprocket sometimes returns 401 if the cached token has been invalidated
    // server-side. Clear the cache so the next call re-logs-in.
    if (r.status === 401) tokenCache = { token: null, expiresAt: 0 };
    const msg = data.message || (Array.isArray(data.errors) ? data.errors.join(', ') : '') || JSON.stringify(data);
    const err = new Error(`Shiprocket ${method} ${path} failed (${r.status}): ${msg}`);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* Endpoint wrappers live in pickups.js, shipments.js and operations.js — one per endpoint
 * the app uses. Add new ones there rather than calling srRequest from elsewhere. */
module.exports = { API_BASE, MOCK, MOCK_BASE_URL, mockLog, mockRand, mockState, mockAddPickup, getToken, srRequest };
