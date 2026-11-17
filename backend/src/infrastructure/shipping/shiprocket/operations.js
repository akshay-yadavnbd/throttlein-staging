/** Shiprocket operations: NDR (non-delivery) actions, return orders, manifests, wallet and COD remittance. */
const { MOCK, MOCK_BASE_URL, mockLog, srRequest } = require('./client');

/* ── NDR (Non-Delivery Report) ─────────────────────────────────────────── */

/** GET /v1/external/ndr/all — list all NDR-marked shipments on the account */
function listNdr({ page = 1, per_page = 50 } = {}) {
  if (MOCK) {
    mockLog(`listNdr(page=${page})`);
    // Synthesize empty NDR list — controller will filter to this seller anyway.
    return Promise.resolve({ data: [], meta: { current_page: page, per_page, total: 0 } });
  }
  const qs = new URLSearchParams({ page: String(page), per_page: String(per_page) }).toString();
  return srRequest('GET', `/ndr/all?${qs}`);
}

/**
 * POST /v1/external/ndr/{awb}/action
 *
 * Seller responds to an NDR. action ∈ "re-attempt" | "return" | "fake-attempt".
 * Optional address override fields if the customer corrected their address.
 */
function ndrAction({ awb, action, comments = '', ...overrides }) {
  if (MOCK) {
    mockLog(`ndrAction(${awb}, ${action})`);
    return Promise.resolve({
      status: 1,
      message: `MOCK: NDR action "${action}" queued for AWB ${awb}`,
    });
  }
  return srRequest('POST', `/ndr/${encodeURIComponent(awb)}/action`, {
    action,
    comments,
    ...overrides,
  });
}

/* ── Returns / reverse pickup ──────────────────────────────────────────── */

/**
 * POST /v1/external/orders/create/return
 *
 * Create a reverse-pickup (return) order. Payload mirrors adhoc-order create
 * but with the CUSTOMER as the pickup source and the SELLER as the delivery
 * destination — Shiprocket courier picks the parcel up from the buyer.
 */
function createReturnOrder(payload) {
  if (MOCK) {
    mockLog(`createReturnOrder(${payload.order_id})`);
    return Promise.resolve({
      order_id: 700000 + Math.floor(Math.random() * 99999),
      shipment_id: 800000 + Math.floor(Math.random() * 99999),
      status: 'RETURN-NEW',
      status_code: 1,
      awb_code: '',
      courier_company_id: '',
      courier_name: '',
    });
  }
  return srRequest('POST', '/orders/create/return', payload);
}

/* ── Manifest ──────────────────────────────────────────────────────────── */

/**
 * POST /v1/external/manifests/generate
 *
 * Generate a manifest (the list of shipments handed over to the courier).
 * Pass an array of shipment_ids — typically all of a seller's AWBs created
 * the same day.
 */
function generateManifest({ shipment_id }) {
  const arr = Array.isArray(shipment_id) ? shipment_id : [shipment_id];
  if (MOCK) {
    mockLog(`generateManifest([${arr.join(', ')}])`);
    return Promise.resolve({
      status: 200,
      manifest_url: `${MOCK_BASE_URL}/api/mock/manifest/${encodeURIComponent(arr.join(','))}`,
    });
  }
  return srRequest('POST', '/manifests/generate', { shipment_id: arr });
}

/**
 * POST /v1/external/manifests/print
 *
 * Fetch the URL of a manifest that was already generated. Shiprocket
 * refuses /manifests/generate on the second call with "Manifest already
 * generated" — that's when we fall back to this endpoint instead.
 */
function printManifest({ order_ids }) {
  const arr = Array.isArray(order_ids) ? order_ids : [order_ids];
  if (MOCK) {
    mockLog(`printManifest([${arr.join(', ')}])`);
    return Promise.resolve({
      status: 200,
      manifest_url: `${MOCK_BASE_URL}/api/mock/manifest/${encodeURIComponent(arr.join(','))}`,
    });
  }
  return srRequest('POST', '/manifests/print', { order_ids: arr });
}

/* ── Wallet / COD remittance (admin-only reads) ────────────────────────── */

/** GET /v1/external/account/details/wallet-balance — current wallet balance */
function walletBalance() {
  if (MOCK) {
    mockLog('walletBalance()');
    return Promise.resolve({
      data: { balance_amount: 12345.67, hold_amount: 0, available_amount: 12345.67 },
    });
  }
  return srRequest('GET', '/account/details/wallet-balance');
}

/**
 * GET /v1/external/account/details/statement — wallet transactions
 * @param {{ from?: string, to?: string, page?: number, per_page?: number }} [query]
 */
function walletStatement({ from, to, page = 1, per_page = 50 } = {}) {
  if (MOCK) {
    mockLog(`walletStatement(${from} → ${to})`);
    return Promise.resolve({ data: [], meta: { current_page: page, per_page, total: 0 } });
  }
  const params = { page: String(page), per_page: String(per_page) };
  if (from) params.from = from;
  if (to) params.to = to;
  const qs = new URLSearchParams(params).toString();
  return srRequest('GET', `/account/details/statement?${qs}`);
}

/** GET /v1/external/account/details/cod-remittance — COD payouts from Shiprocket to us */
function codRemittance() {
  if (MOCK) {
    mockLog('codRemittance()');
    return Promise.resolve({ data: [] });
  }
  return srRequest('GET', '/account/details/cod-remittance');
}

module.exports = {
  listNdr,
  ndrAction,
  createReturnOrder,
  generateManifest,
  printManifest,
  walletBalance,
  walletStatement,
  codRemittance,
};
