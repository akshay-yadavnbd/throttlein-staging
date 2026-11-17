/**
 * Mock Shiprocket label / invoice / tracking endpoints.
 *
 * Only active when SHIPROCKET_MOCK_MODE=true. Serves HTML pages styled to
 * look like a real shipping label / tax invoice — printable from the
 * browser (Ctrl+P → Save as PDF). Lets sellers test the full ship-and-print
 * flow on localhost without burning any real Shiprocket wallet balance.
 *
 * The pages populate with REAL order data when available (looked up via the
 * AWB code on the label and the Shiprocket order id on the invoice), so the
 * output looks indistinguishable from production aside from the dev banner.
 *
 * In live mode these URLs aren't used — the real Shiprocket label/invoice
 * URLs returned by their API replace these stubs.
 */
const express = require('express');
const asyncHandler = require('express-async-handler');
const { MOCK } = require('./mock-shiprocket/config');
const { isLive } = require('../config/appEnv');
const { labelPage, invoicePage, manifestPage } = require('./mock-shiprocket/pages');
const { fireWebhook, simulateDelivery } = require('./mock-shiprocket/carrier-sim');

const router = express.Router();

// Reject everything if mock mode isn't on — these routes shouldn't exist
// in production traffic.
router.use((req, res, next) => {
  // Staging may serve these (src/config/appEnv.js); the live site never does.
  if (!MOCK || isLive()) {
    return res.status(404).send('Not found');
  }
  // Defeat browser caching so template edits land immediately during dev.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

router.get('/label/:awb', labelPage);
router.get('/invoice/:orderId', invoicePage);
router.get('/manifest/:shipmentIds', manifestPage);

/**
 * POST /api/mock/shiprocket/fire-webhook/:awb
 * Body (optional): { status_id, status, scans? }
 *
 * Dev-only helper. Synthesizes a Shiprocket-shaped webhook payload for the
 * given AWB and POSTs it to our own webhook handler. Lets you walk an order
 * through delivered/undelivered/RTO states without an actual courier or
 * ngrok tunnel. Only active when SHIPROCKET_MOCK_MODE=true.
 */
router.post('/shiprocket/fire-webhook/:awb', express.json(), fireWebhook);

/**
 * GET /api/mock/health
 *
 * Cheap way for the frontends to detect mock mode is on (200 with json
 * means yes; 404 from the outer guard means no). Used by the seller order
 * page to decide whether to render the "Simulate delivery" dev button.
 */
router.get('/health', (req, res) => {
  res.json({ ok: true, mockMode: true });
});

router.post('/shipment/:orderId/:entryId/simulate-delivery', asyncHandler(simulateDelivery));

module.exports = router;
