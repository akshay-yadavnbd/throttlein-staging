/**
 * Pricing the cart for checkout: every line exactly as the storefront
 * displayed it, stock and seller gates re-checked at order time, delivery
 * re-quoted server-side. Shared by the COD and Razorpay paths so totals stay
 * identical across both.
 */
const mongoose = require('mongoose');
const { AppError } = require('../../errors/AppError');
const { cartAvailability, deliveryQuote } = require('../customers');
// Same live-offer resolution the storefront displays prices with — checkout
// charges what the customer saw (audit A08).
const { loadLiveOffersForSellers, bestOfferForProduct } = require('../offers');
const { effectiveRate: effectiveGstRate } = require('../../utils/gst');
const checkoutRepo = require('./checkout.repository');
const parties = require('./parties.repository');

/** `{ [sellerId]: courierId }` from the client — ids only; every rate is
 *  re-quoted server-side, so a tampered body can change which courier is
 *  used but never what it costs. */
function readDeliveryPicks(body) {
  const raw = body?.deliveryPicks;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [sellerId, courierId] of Object.entries(raw).slice(0, 20)) {
    const id = Number(courierId);
    if (mongoose.isValidObjectId(sellerId) && Number.isFinite(id)) out[sellerId] = id;
  }
  return out;
}

/** The image to snapshot on the line: picked colour's first photo → main gallery → any colour bucket. */
function snapshotImage(p, color) {
  const ciList = Array.isArray(p.colorImages) ? p.colorImages : [];
  if (color) {
    const match = ciList.find((c) => String(c?.color || '').trim() === color);
    if (match && Array.isArray(match.images) && match.images[0]) return match.images[0];
  }
  if (Array.isArray(p.images) && p.images[0]) return p.images[0];
  const anyColorEntry = ciList.find((c) => Array.isArray(c?.images) && c.images.length);
  return anyColorEntry ? anyColorEntry.images[0] : '';
}

/**
 * Load the user's address + cart and snapshot each cart item with current
 * pricing & stock validation (audit A08/A09):
 *   unit = max(1, round(variantPrice − offerSavings))
 * Availability is checked against the EXACT variant, quantities must be sane
 * positive integers, and multiple cart lines of the same product/variant are
 * SUMMED before the stock test. Lines the cart page shows as unbuyable are
 * left in the cart, left out of the order and reported back as `skipped`.
 *
 * Returns `{ user, addr, cart, items, itemsTotal, shippingFee, total,
 * codEligible, codChargeMax, skipped, deliverySelections }`.
 */
async function buildOrderPayload(userId, addressId, opts = {}) {
  const user = await parties.customerById(userId);
  const addr = user?.addresses?.id(addressId);
  if (!addr) throw AppError.badRequest('Please pick a valid shipping address');

  const cart = await checkoutRepo.loadCartForCheckout(userId);
  if (!cart || cart.items.length === 0) throw AppError.badRequest('Your cart is empty');

  const offersBySeller = await loadLiveOffersForSellers(
    cart.items.map((ci) => ci.product?.seller?._id || ci.product?.seller).filter(Boolean),
  );

  // Aggregate requested quantities per product and per product+variant so
  // two lines of the same SKU can't each pass an individual stock check.
  const perProduct = new Map();
  const perVariant = new Map();
  for (const ci of cart.items) {
    if (!ci.product || !cartAvailability.buyable(cartAvailability.lineAvailability(ci))) continue;
    const pid = String(ci.product._id);
    const qty = Number(ci.quantity);
    perProduct.set(pid, (perProduct.get(pid) || 0) + qty);
    const vKey = `${pid}::${String(ci.size || '').trim()}::${String(ci.color || '').trim()}`;
    perVariant.set(vKey, (perVariant.get(vKey) || 0) + qty);
  }

  /** @type {any[]} */
  const items = [];
  const skipped = [];
  for (const ci of cart.items) {
    const p = ci.product;
    const verdict = cartAvailability.lineAvailability(ci);
    if (!cartAvailability.buyable(verdict)) {
      skipped.push({ name: p?.name || 'An item', reason: verdict.message, state: verdict.state });
      continue;
    }
    const qty = Number(ci.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100) throw AppError.badRequest(`Invalid quantity for "${p.name}".`);

    const wantSize = String(ci.size || '').trim();
    const wantColor = String(ci.color || '').trim();
    const variantsList = Array.isArray(p.variants) ? p.variants : [];
    let variant = null;
    if (variantsList.length > 0) {
      variant =
        variantsList.find(
          (v) =>
            (!wantSize || String(v.size || '').trim() === wantSize) &&
            (!wantColor || String(v.color || '').trim() === wantColor),
        ) || null;
      if ((wantSize || wantColor) && !variant) {
        // Unreachable — lineAvailability rejects a missing variant above.
        skipped.push({
          name: p.name,
          reason: `No longer available in ${[wantSize, wantColor].filter(Boolean).join(' / ')}`,
          state: 'unavailable',
        });
        continue;
      }
    }

    const pid = String(p._id);
    const vKey = `${pid}::${wantSize}::${wantColor}`;
    if (variant && (Number(variant.stock) || 0) < (perVariant.get(vKey) || qty)) {
      throw AppError.badRequest(
        `Not enough stock for "${p.name}" (${[wantSize, wantColor].filter(Boolean).join(' / ')})`,
      );
    }
    if ((p.stock ?? 0) < (perProduct.get(pid) || qty)) throw AppError.badRequest(`Not enough stock for "${p.name}"`);

    // Effective unit price — same arithmetic as the product page.
    const basePrice = Number(p.price) || 0;
    const variantBase =
      variant && variant.price != null && Number(variant.price) > 0 ? Number(variant.price) : basePrice;
    const variantMrp =
      variant && variant.mrp != null && Number(variant.mrp) > 0 ? Number(variant.mrp) : Number(p.mrp) || 0;
    const best = bestOfferForProduct(p, offersBySeller.get(String(p.seller?._id || p.seller)) || []);
    const savings = best ? best.savings : 0;
    const unitPrice = Math.max(1, Math.round(variantBase - savings));

    items.push({
      product: p._id,
      name: p.name,
      image: snapshotImage(p, wantColor),
      seller: p.seller?._id || p.seller,
      brand: p.brand?.name || '',
      category: p.category?.name || '',
      size: ci.size || '',
      color: ci.color || '',
      price: unitPrice,
      mrp: Math.max(variantMrp, variantBase),
      quantity: qty,
      subtotal: unitPrice * qty,
      gstRate: effectiveGstRate(p.gstRate),
      hsn: p.hsn || '',
      codAvailable: p.codAvailable !== false,
      ...(best ? { offer: { _id: best.offer._id, title: best.offer.title, savings } } : {}),
    });
  }
  if (items.length === 0) {
    const first = skipped[0];
    throw AppError.badRequest(
      first
        ? `${first.name} is ${String(first.reason || 'unavailable').toLowerCase()} — nothing in your bag can be ordered right now.`
        : 'All cart items became unavailable. Refresh and try again.',
    );
  }

  const itemsTotal = items.reduce((s, i) => s + i.subtotal, 0);

  /* Delivery (per seller): no platform shipping fee. A seller who passes
   * delivery on had the customer pick a courier in the cart; we RE-QUOTE it
   * here so the charge is always Shiprocket's own rate at order time. */
  const quoteGroups = await deliveryQuote.quoteCart({
    lines: items.map((i) => ({ sellerId: i.seller, productId: i.product, quantity: i.quantity, subtotal: i.subtotal })),
    address: addr,
    cod: opts.cod === true,
  });
  const picked = deliveryQuote.resolveSelections(quoteGroups, opts.deliveryPicks || {});
  if (picked.error) throw AppError.badRequest(picked.error);
  const deliverySelections = picked.selections;
  const shippingFee = picked.total;

  const sellerIds = Array.from(new Set(items.map((i) => String(i.seller))));
  const sellers = await parties.sellersForCheckout(sellerIds);

  // Seller-eligibility gate (audit A09): re-check approval at order time.
  const sellerById = new Map(sellers.map((s) => [String(s._id), s]));
  for (const id of sellerIds) {
    const s = sellerById.get(id);
    if (!s || s.status !== 'approved') {
      throw AppError.badRequest(
        `${s?.storeName || s?.name || 'A seller'} in your cart is not currently accepting orders. ` +
          'Remove their items and try again.',
      );
    }
  }

  /* Snapshot each seller's return/exchange window onto the line (audit A19):
   * the policy is whatever applied at purchase. */
  for (const it of items) {
    const s = sellerById.get(String(it.seller));
    it.returnPolicyDays = s?.returnPolicyDays ?? 7;
    it.exchangePolicyDays = s?.exchangePolicyDays ?? 7;
  }

  // Delivery-exclusion gate: a seller can exclude states and pincodes
  // (exact 6-digit or numeric prefix). Name the store so the buyer knows
  // which items to remove.
  const addrState = String(addr.state || '')
    .trim()
    .toLowerCase();
  const addrPin = String(addr.pincode || '').trim();
  const blocked = sellers.find((s) => {
    const stateHit = (s.excludedStates || []).some((x) => String(x).trim().toLowerCase() === addrState);
    const pinHit = (s.excludedPincodes || []).some((x) => {
      const p = String(x).trim();
      return p.length === 6 ? addrPin === p : addrPin.startsWith(p);
    });
    return stateHit || pinHit;
  });
  if (blocked) {
    throw AppError.badRequest(
      `${blocked.storeName || blocked.name || 'A seller'} doesn't deliver to ` +
        `${addr.state} (${addr.pincode}). Remove their items or pick a different address.`,
    );
  }

  // COD per cart: every seller must opt in and no product may refuse it; the
  // surcharge charged once is the highest individual seller's fee.
  const allProductsCodOk = items.every((i) => i.codAvailable !== false);
  const codEligible = sellers.length > 0 && sellers.every((s) => s.codEnabled !== false) && allProductsCodOk;
  const codChargeMax = codEligible ? sellers.reduce((m, s) => Math.max(m, Number(s.codCharge) || 0), 0) : 0;

  // `total` stays prepaid-style; the COD path adds codChargeMax in finalizeOrder.
  const total = itemsTotal + shippingFee;

  return {
    user,
    addr,
    cart,
    items,
    itemsTotal,
    shippingFee,
    total,
    codEligible,
    codChargeMax,
    skipped,
    deliverySelections,
  };
}

module.exports = { readDeliveryPicks, buildOrderPayload };
