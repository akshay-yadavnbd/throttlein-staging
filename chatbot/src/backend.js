/**
 * The only way the assistant reaches Throttlein data: allow-listed calls to
 * the public API, authenticated with the signed-in user's own JWT. Anything
 * not in ROUTES cannot be called, whatever a tool (or the model) asks for,
 * and the API's ownership checks decide what each user may see or change.
 */
'use strict';

class BackendError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// method + path pattern. Params are matched and encoded; query keys are declared per route.
const ROUTES = [
  { method: 'GET', pattern: /^\/auth\/me$/ },
  { method: 'GET', pattern: /^\/products\/mine$/ },
  { method: 'GET', pattern: /^\/products\/[A-Za-z0-9_-]{1,120}$/ },
  { method: 'PUT', pattern: /^\/products\/[a-f0-9]{24}$/ },
  { method: 'DELETE', pattern: /^\/products\/[a-f0-9]{24}$/ },
  { method: 'POST', pattern: /^\/products\/bulk-status$/ },
  { method: 'POST', pattern: /^\/products\/import-url$/ },
  { method: 'POST', pattern: /^\/products$/ },
  { method: 'GET', pattern: /^\/categories$/, query: ['flat', 'all'] },
  { method: 'GET', pattern: /^\/brands$/, query: ['all'] },
  { method: 'GET', pattern: /^\/admin\/products$/, query: ['scope', 'status', 'q', 'page', 'limit'] },
  { method: 'PATCH', pattern: /^\/admin\/products\/[a-f0-9]{24}\/status$/ },
  // Orders: the seller's own slice (the seller routes scope to req.user), or every order (read-only) for a superadmin.
  { method: 'GET', pattern: /^\/seller\/orders$/, query: ['page', 'limit'] },
  { method: 'GET', pattern: /^\/seller\/orders\/[A-Za-z0-9-]{3,40}$/ },
  { method: 'GET', pattern: /^\/seller\/orders\/[A-Za-z0-9-]{3,40}\/(couriers|track)$/ },
  { method: 'PATCH', pattern: /^\/seller\/orders\/[A-Za-z0-9-]{3,40}\/status$/ },
  { method: 'POST', pattern: /^\/seller\/orders\/[A-Za-z0-9-]{3,40}\/(ship|reschedule-pickup|retry-push|cancel-order|cancel-shipment|hide|ndr-action)$/ },
  { method: 'GET', pattern: /^\/seller\/return-requests$/ },
  { method: 'GET', pattern: /^\/seller\/return-requests\/[a-f0-9]{24}$/ },
  { method: 'POST', pattern: /^\/seller\/orders\/[A-Za-z0-9-]{3,40}\/return-request\/[a-f0-9]{24}\/(approve|decline|verify|raise-refund|ship-replacement)$/ },
  { method: 'GET', pattern: /^\/seller\/payouts$/ },
  { method: 'GET', pattern: /^\/seller\/offers$/, query: ['status', 'page', 'limit'] },
  { method: 'POST', pattern: /^\/seller\/offers$/ },
  { method: 'PUT', pattern: /^\/seller\/offers\/[a-f0-9]{24}$/ },
  { method: 'DELETE', pattern: /^\/seller\/offers\/[a-f0-9]{24}$/ },
  { method: 'GET', pattern: /^\/seller\/offline-sales$/, query: ['from', 'to', 'page', 'limit', 'product'] },
  { method: 'POST', pattern: /^\/seller\/offline-sales$/ },
  { method: 'DELETE', pattern: /^\/seller\/offline-sales\/[a-f0-9]{24}$/ },
  { method: 'GET', pattern: /^\/seller\/media$/, query: ['q', 'folder', 'page', 'limit'] },
  { method: 'POST', pattern: /^\/seller\/media\/bulk-delete$/ },
  { method: 'GET', pattern: /^\/seller\/brand-category-requests$/ },
  { method: 'POST', pattern: /^\/seller\/brand-category-requests$/ },
  { method: 'PATCH', pattern: /^\/seller\/brand-category-requests\/[a-f0-9]{24}$/ },
  { method: 'DELETE', pattern: /^\/seller\/brand-category-requests\/[a-f0-9]{24}$/ },
  { method: 'GET', pattern: /^\/seller\/kyc$/ },
  // Profile fields only; the API strips anything else. KYC writes and password changes are deliberately absent.
  { method: 'PUT', pattern: /^\/auth\/profile$/ },
  { method: 'GET', pattern: /^\/admin\/orders$/, query: ['status', 'paymentStatus', 'sellerId', 'q', 'from', 'to', 'page', 'limit'] },
  { method: 'GET', pattern: /^\/admin\/orders\/[A-Za-z0-9-]{3,40}$/ },
  // Chat history (the user's own conversations). Used by the service itself, never by a tool.
  { method: 'GET', pattern: /^\/assistant\/conversations$/, query: ['limit'] },
  { method: 'POST', pattern: /^\/assistant\/conversations$/ },
  { method: 'GET', pattern: /^\/assistant\/conversations\/[a-f0-9]{24}$/ },
  { method: 'POST', pattern: /^\/assistant\/conversations\/[a-f0-9]{24}\/messages$/ },
  { method: 'PATCH', pattern: /^\/assistant\/conversations\/[a-f0-9]{24}$/ },
  { method: 'DELETE', pattern: /^\/assistant\/conversations\/[a-f0-9]{24}$/ },
];

/**
 * The API's success envelope `{ data, meta? }` → the plain object the tools read.
 * Endpoints move to the envelope screen by screen (docs/backend-conventions.md,
 * "Responses"); legacy answers (`{ success, … }`) pass through untouched. Paging
 * meta is folded back in as `total` / `page` / `pages`, with `meta` kept beside it.
 */
function fromEnvelope(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const keys = Object.keys(body);
  if (!keys.includes('data') || !keys.every((k) => k === 'data' || k === 'meta')) return body;
  const { data, meta } = body;
  const flat = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : { value: data };
  if (meta) {
    flat.meta = meta;
    if (flat.total === undefined) flat.total = meta.totalItems;
    if (flat.page === undefined) flat.page = meta.page;
    if (flat.pages === undefined) flat.pages = meta.totalPages;
  }
  return flat;
}

function createBackend({ baseUrl, timeoutMs = 15000, maxBytes = 4 * 1024 * 1024, fetchImpl = fetch }) {
  /** `body` is sent as JSON; `form` (a FormData with fields and files) as multipart, for the product create route. */
  async function call(token, { method = 'GET', path, query, body, form, timeout }) {
    const route = ROUTES.find((r) => r.method === method && r.pattern.test(path));
    if (!route) throw new BackendError(500, `Route ${method} ${path} is not allowed for the assistant`);
    const url = new URL(baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (!(route.query || []).includes(k) || v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v).slice(0, 200));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout || timeoutMs);
    let response;
    try {
      response = await fetchImpl(url.href, {
        method, signal: controller.signal, redirect: 'manual',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body !== undefined && !form && { 'Content-Type': 'application/json' }), 'User-Agent': 'throttlein-assistant/1.0' },
        body: form || (body === undefined ? undefined : JSON.stringify(body)),
      });
    } catch (error) {
      throw new BackendError(error.name === 'AbortError' ? 504 : 502, error.name === 'AbortError' ? 'The Throttlein API took too long to answer.' : 'The Throttlein API could not be reached.');
    } finally { clearTimeout(timer); }
    const length = Number(response.headers.get('content-length') || 0);
    if (length > maxBytes) throw new BackendError(502, 'The API answer was too large.');
    const text = await response.text();
    if (text.length > maxBytes) throw new BackendError(502, 'The API answer was too large.');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      // The API's own messages are written for users ("You can only update your own products.").
      const message = (data && typeof data.message === 'string' && data.message.slice(0, 300)) || `The API answered ${response.status}.`;
      throw new BackendError(response.status, message);
    }
    return fromEnvelope(data);
  }
  return { call, ROUTES };
}

module.exports = { createBackend, BackendError, ROUTES, fromEnvelope };
