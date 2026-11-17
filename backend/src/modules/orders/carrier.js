/**
 * Pure helpers for talking to the carrier (Shiprocket): ids, dates, address
 * clamps, item shapes and parcel envelopes. No I/O except the product
 * profile lookup behind parcelEnvelope / sliceWeightKg.
 */
const crypto = require('node:crypto');
const inventory = require('./inventory.repository');

const ALREADY_BOOKED = /already\s+(been\s+)?(generated|scheduled|created|booked)/i;

/** Next courier working day (Mon–Sat) in IST as YYYY-MM-DD, for pickup re-booking. */
function nextPickupDate() {
  const ist = new Date(Date.now() + 330 * 60000);
  ist.setUTCDate(ist.getUTCDate() + 1);
  if (ist.getUTCDay() === 0) ist.setUTCDate(ist.getUTCDate() + 1); // skip Sunday
  return ist.toISOString().slice(0, 10);
}

/**
 * Shiprocket-safe order_id. Shiprocket enforces uniqueness on `order_id`
 * across the account and one of our orders produces several pushes (one
 * per seller, -RTN per return, -RPL per replacement), so each push gets a
 * random 6-hex suffix: <orderNumber>-<6-hex>[-<kind>].
 */
function buildShiprocketOrderId(orderNumber, kind = '') {
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  const kindTag = kind ? `-${kind}` : '';
  return `${orderNumber}-${suffix}${kindTag}`;
}

/**
 * Shiprocket rejects address line 1 + line 2 over 190 characters combined.
 * Clamp ONLY the copy sent to Shiprocket — the order keeps the full address.
 * Line 1 keeps up to 140 chars; line 2 gets what remains of a 186-char budget.
 */
function clampShiprocketAddress(line1, line2) {
  const a1 = String(line1 || '')
    .trim()
    .slice(0, 140);
  const a2 = String(line2 || '')
    .trim()
    .slice(0, Math.max(0, 186 - a1.length));
  return { a1, a2 };
}

const digitsPhone = (v) =>
  String(v || '')
    .replace(/\D/g, '')
    .slice(-10);

const splitName = (fullName) => {
  const name = String(fullName || '').trim();
  return { first: name.split(/\s+/)[0] || name || 'Customer', last: name.split(/\s+/).slice(1).join(' ') || '' };
};

const carrierDate = (d) => (d ? new Date(d) : new Date()).toISOString().slice(0, 19).replace('T', ' ');

/** Shiprocket's `order_items` shape from order lines. */
function carrierItems(lines, { qc = false, priceOf = (it) => it.price } = {}) {
  return lines.map((it) => ({
    name: String(it.name).slice(0, 100),
    sku: it.product ? String(it.product) : `SKU-${Math.random().toString(36).slice(2, 8)}`,
    units: it.quantity,
    selling_price: priceOf(it),
    discount: 0,
    tax: 0,
    hsn: 0,
    ...(qc ? { qc_enable: true } : {}),
  }));
}

/** The AWB payload's useful fields, whichever of Shiprocket's shapes arrived. */
const awbPayload = (awbResp) => awbResp?.response?.data || awbResp?.data || awbResp;

/**
 * Parcel envelope (weight in kg, box dims in cm) for a set of line items —
 * Order.items (`product` + `quantity`) or Shiprocket items (`sku` + `units`).
 * Dimensions collapse to the LARGEST value on each axis; weight is clamped
 * to Shiprocket's 0.5 kg minimum; unknown products fall back to the defaults.
 */
async function parcelEnvelope(items) {
  const profiles = await inventory.parcelProfiles(items.map((it) => it.product || it.sku));
  let totalGrams = 0;
  let dims = { ...inventory.DEFAULT_DIMS };
  for (const it of items) {
    const p = inventory.profileFor(profiles, it.product || it.sku);
    const qty = Number(it.quantity || it.units || 0) || 1;
    totalGrams += p.weightGrams * qty;
    dims = {
      length: Math.max(dims.length, p.length),
      breadth: Math.max(dims.breadth, p.breadth),
      height: Math.max(dims.height, p.height),
    };
  }
  return { weight: Math.max(0.5, totalGrams / 1000), ...dims };
}

/** Weight of this seller's slice in kg (min 0.5). */
async function sliceWeightKg(order, sellerId) {
  const mine = (order.items || []).filter((it) => String(it.seller) === String(sellerId));
  const profiles = await inventory.parcelProfiles(mine.map((it) => it.product));
  const grams = mine.reduce((s, it) => s + inventory.profileFor(profiles, it.product).weightGrams * it.quantity, 0);
  return Math.max(0.5, grams / 1000);
}

module.exports = {
  ALREADY_BOOKED,
  nextPickupDate,
  buildShiprocketOrderId,
  clampShiprocketAddress,
  digitsPhone,
  splitName,
  carrierDate,
  carrierItems,
  awbPayload,
  parcelEnvelope,
  sliceWeightKg,
};
