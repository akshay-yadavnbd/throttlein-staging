/**
 * Read-only MCP tools over production data.
 *
 * Each entry is plain data — name (`tin_<area>_<verb>`), the OAuth scope it
 * needs (./scopes.js), a zod input shape, which argument values are safe to
 * keep in the audit summary, whether its output carries customer/seller free
 * text, and `run(args, ctx)` returning `{ items, meta?, cursorAfter? }` — so
 * the runtime (./runtime.js) can register exactly the tools the connection's
 * scopes and the superadmin's settings allow, and the list stays reviewable
 * in one place.
 *
 * Every query is bounded (page size from settings, date windows) because
 * these run on the live cluster, and every record passes through ./redact.js.
 * Throw `ToolError(code, message)` for conditions the caller can act on.
 */
'use strict';
const { overviewTools, auditTools } = require('./tools-ops');
const { orderTools } = require('./tools-orders');
const { partnerTools } = require('./tools-partners');
const {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PRODUCT_STATUSES,
  REFUND_STATUSES,
  SHIPMENT_STATUSES,
  dayIST,
  istDayStart,
} = require('./tool-helpers');

/** Every tool, in registration order. */
const tools = [...overviewTools, ...orderTools, ...partnerTools, ...auditTools];

module.exports = {
  tools,
  dayIST,
  istDayStart,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  SHIPMENT_STATUSES,
  REFUND_STATUSES,
  PRODUCT_STATUSES,
};
