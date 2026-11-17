/** Shiprocket orders and shipments: serviceability, create, AWB, pickup, labels, invoices, tracking, cancellation. */
const { MOCK, MOCK_BASE_URL, mockLog, mockRand, srRequest } = require('./client');

/**
 * GET /external/courier/serviceability
 *
 * Check whether a pickup pincode → delivery pincode route is shippable and
 * return courier options with rates. Used on the product detail page and at
 * checkout for the "shipping fee" line.
 */
function serviceability({ pickup_pincode, delivery_pincode, weight, cod = 0 }) {
  if (MOCK) {
    mockLog(`serviceability(${pickup_pincode} → ${delivery_pincode})`);
    return Promise.resolve({
      status: 200,
      data: {
        available_courier_companies: [
          {
            courier_company_id: 1,
            courier_name: 'MockExpress (Demo)',
            rate: 80,
            cod_charges: cod ? 30 : 0,
            estimated_delivery_days: '3',
            etd: '3 days',
            min_weight: 0.5,
          },
          {
            courier_company_id: 2,
            courier_name: 'MockPriority (Demo)',
            rate: 110,
            cod_charges: cod ? 35 : 0,
            estimated_delivery_days: '2',
            etd: '2 days',
            min_weight: 0.5,
          },
        ],
        recommended_by: { id: 1 },
      },
    });
  }
  const qs = new URLSearchParams({
    pickup_postcode: String(pickup_pincode),
    delivery_postcode: String(delivery_pincode),
    weight: String(weight),
    cod: String(cod ? 1 : 0),
  }).toString();
  return srRequest('GET', `/courier/serviceability/?${qs}`);
}

/**
 * POST /external/orders/create/adhoc
 *
 * Create a Shiprocket order from one of our orders. Pass the full payload —
 * we'll build it in the order controller from our Order model.
 *
 * Returns: { order_id, shipment_id, status, ... }
 */
function createOrder(payload) {
  if (MOCK) {
    mockLog(`createOrder(${payload.order_id})`);
    return Promise.resolve({
      order_id: 700000 + Math.floor(Math.random() * 99999),
      shipment_id: 800000 + Math.floor(Math.random() * 99999),
      status: 'NEW',
      status_code: 1,
      onboarding_completed_now: 0,
      awb_code: '',
      courier_company_id: '',
      courier_name: '',
    });
  }
  return srRequest('POST', '/orders/create/adhoc', payload);
}

/**
 * POST /external/courier/assign/awb
 *
 * Generate an Air Waybill (AWB) for a Shiprocket shipment. Pass
 * { shipment_id, courier_id? }. If courier_id is omitted, Shiprocket
 * picks the cheapest.
 */
function generateAwb({ shipment_id, courier_id }) {
  if (MOCK) {
    const awb = `MOCK${Date.now().toString().slice(-8)}${mockRand().slice(0, 3)}`;
    mockLog(`generateAwb(shipment ${shipment_id}) → ${awb}`);
    return Promise.resolve({
      awb_assign_status: 1,
      response: {
        data: {
          awb_code: awb,
          courier_company_id: courier_id || 1,
          courier_name: 'MockExpress (Demo)',
          shipment_id,
          assigned_date_time: new Date().toISOString(),
        },
      },
    });
  }
  const body = { shipment_id };
  if (courier_id) body.courier_id = courier_id;
  return srRequest('POST', '/courier/assign/awb', body);
}

/**
 * POST /external/courier/generate/pickup
 *
 * Tell the assigned courier to pick the parcel up. Call after generateAwb.
 * @param {{ shipment_id?: string | number, pickup_date?: string }} [args]
 */
function schedulePickup({ shipment_id, pickup_date } = {}) {
  if (MOCK) {
    mockLog(`schedulePickup(shipment ${shipment_id})`);
    return Promise.resolve({
      pickup_status: 1,
      response: {
        pickup_scheduled_date: new Date(Date.now() + 86400000).toISOString(),
        pickup_token_number: `MOCKPKP${mockRand()}`,
        status: 1,
        others: 'MOCK: courier scheduled (no real pickup will happen).',
      },
    });
  }
  // pickup_date (YYYY-MM-DD) is optional; Shiprocket expects it as an array.
  return srRequest(
    'POST',
    '/courier/generate/pickup',
    pickup_date ? { shipment_id, pickup_date: [pickup_date] } : { shipment_id },
  );
}

/** GET /external/orders/show/:id — full order detail including timeline */
function getOrder(orderId) {
  if (MOCK) {
    mockLog(`getOrder(${orderId})`);
    return Promise.resolve({
      data: {
        id: orderId,
        channel_order_id: `MOCK-${orderId}`,
        status: 'NEW',
        status_code: 1,
        payment_method: 'COD',
        total: 999,
      },
    });
  }
  return srRequest('GET', `/orders/show/${encodeURIComponent(orderId)}`);
}

/* ──────────────────────────────────────────────────────────────────────────
 * REMOVED: sendPickupOtp() / verifyPickupOtp()
 *
 * There is no pickup-OTP endpoint in Shiprocket's external API. Both wrappers
 * pointed at routes that return 404 — including the /sendotp/{id} vs /sendotp
 * "try both shapes" fallback, which was guesswork, not two documented shapes.
 *
 * Verified 2026-08-03 against the live account: 20 path variants, all 404,
 * while GET /settings/company/pickup → 200 and GET /settings/company/addpickup
 * → 405 "Supported methods: POST" in the same namespace. Not a permissions or
 * module-access problem.
 *
 * The MOCK branches are why this survived so long: in mock mode both returned
 * a cheerful success without touching the network, so the seller OTP flow only
 * ever ran against a fake that always said yes.
 *
 * Pickup phone verification is a panel-only operation (Settings → Pickup
 * Addresses). Read the result back via listPickupLocations()'s `phone_verified`
 * — see readPickupStatus() in the sellers module.
 * ────────────────────────────────────────────────────────────────────────── */

/** POST /external/orders/cancel — cancel one or more Shiprocket orders */
function cancelOrder(ids) {
  const arr = Array.isArray(ids) ? ids : [ids];
  if (MOCK) {
    mockLog(`cancelOrder([${arr.join(', ')}])`);
    return Promise.resolve({ status_code: 1, message: 'MOCK: order(s) cancelled.' });
  }
  return srRequest('POST', '/orders/cancel', { ids: arr });
}

/**
 * POST /external/courier/generate/label  → { label_url: "https://…/label.pdf" }
 * Generates a shipping label PDF for a previously-AWB'd shipment. The URL
 * is hosted on Shiprocket's CDN — we hand it straight to the seller so they
 * print without ever logging in to Shiprocket.
 */
function generateLabel({ shipment_id }) {
  const arr = Array.isArray(shipment_id) ? shipment_id : [shipment_id];
  if (MOCK) {
    mockLog(`generateLabel([${arr.join(', ')}])`);
    // Real, openable URL — the backend serves a styled HTML "label" you can
    // print to PDF via the browser. See src/routes/mockShiprocketRoutes.js.
    return Promise.resolve({
      label_created: 1,
      response: 'MOCK: label generated.',
      label_url: `${MOCK_BASE_URL}/api/mock/label/${encodeURIComponent(arr[0])}`,
    });
  }
  return srRequest('POST', '/courier/generate/label', { shipment_id: arr });
}

/**
 * POST /external/courier/print/invoice  → { invoice_url: "https://…/invoice.pdf" }
 * Tax invoice from Shiprocket. Useful for the seller's own records — separate
 * from the shipping label.
 */
function generateInvoice({ order_id }) {
  const arr = Array.isArray(order_id) ? order_id : [order_id];
  if (MOCK) {
    mockLog(`generateInvoice([${arr.join(', ')}])`);
    return Promise.resolve({
      is_invoice_created: true,
      invoice_url: `${MOCK_BASE_URL}/api/mock/invoice/${encodeURIComponent(arr[0])}`,
      not_created: [],
    });
  }
  return srRequest('POST', '/orders/print/invoice', { ids: arr });
}

/**
 * GET /external/courier/track/awb/{awb_code}  → tracking events
 * Shape: { tracking_data: { track_status, shipment_status, shipment_track,
 *         shipment_track_activities: [{ date, status, activity, location }] } }
 */
function trackByAwb(awb) {
  if (MOCK) {
    mockLog(`trackByAwb(${awb})`);
    const now = Date.now();
    return Promise.resolve({
      tracking_data: {
        track_status: 1,
        shipment_status: 6, // "In Transit" in Shiprocket's enum
        shipment_track: [
          {
            awb_code: awb,
            courier_name: 'MockExpress (Demo)',
            current_status: 'In Transit',
            current_status_id: 6,
            origin: 'Mumbai',
            destination: 'Greater Noida',
            edd: new Date(now + 3 * 86400000).toISOString().slice(0, 10),
          },
        ],
        shipment_track_activities: [
          {
            date: new Date(now - 2 * 3600000).toISOString().replace('T', ' ').slice(0, 19),
            status: 'Picked Up',
            activity: 'MOCK: Shipment picked up by courier',
            location: 'Mumbai Hub',
          },
          {
            date: new Date(now - 1 * 3600000).toISOString().replace('T', ' ').slice(0, 19),
            status: 'In Transit',
            activity: 'MOCK: Shipment is on its way',
            location: 'In-transit',
          },
        ],
      },
    });
  }
  return srRequest('GET', `/courier/track/awb/${encodeURIComponent(awb)}`);
}

/**
 * POST /external/orders/cancel/shipment/awbs  → cancel a specific shipment
 * by its AWB. Only works before the courier picks up; once moved, the order
 * has to be RTO'd via a different flow.
 */
function cancelShipmentByAwb(awbs) {
  const arr = Array.isArray(awbs) ? awbs : [awbs];
  if (MOCK) {
    mockLog(`cancelShipmentByAwb([${arr.join(', ')}])`);
    return Promise.resolve({ status_code: 1, message: 'MOCK: shipment(s) cancelled.' });
  }
  return srRequest('POST', '/orders/cancel/shipment/awbs', { awbs: arr });
}

module.exports = {
  serviceability,
  createOrder,
  generateAwb,
  schedulePickup,
  getOrder,
  cancelOrder,
  generateLabel,
  generateInvoice,
  trackByAwb,
  cancelShipmentByAwb,
};
