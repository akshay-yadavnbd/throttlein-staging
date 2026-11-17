/** Seller-entered offer fields → a clean partial update. Unknown keys are dropped; junk numbers, dates and ids are coerced, never saved. */
const mongoose = require('mongoose');

/** '' / null clear an optional amount; anything not a non-negative number clears it too. */
function optionalAmount(v) {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function optionalDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function sanitiseOfferBody(body) {
  const out = {};
  if (typeof body.title === 'string') out.title = body.title.trim();
  if (typeof body.description === 'string') out.description = body.description.trim();
  if (body.discountType === 'percent' || body.discountType === 'flat') out.discountType = body.discountType;
  if (body.discountValue !== undefined) {
    const n = Number(body.discountValue);
    out.discountValue = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if (body.maxDiscount !== undefined) out.maxDiscount = optionalAmount(body.maxDiscount);
  if (body.minCartAmount !== undefined) out.minCartAmount = optionalAmount(body.minCartAmount);
  if (body.scope === 'all' || body.scope === 'selected') out.scope = body.scope;
  if (Array.isArray(body.products)) {
    // De-duplicated valid ObjectIds only, so a hand-crafted payload cannot break the save.
    const seen = new Set();
    out.products = body.products
      .map((v) => String(v))
      .filter((v) => mongoose.isValidObjectId(v) && !seen.has(v) && seen.add(v));
  }
  if ('startsAt' in body) out.startsAt = optionalDate(body.startsAt);
  if ('endsAt' in body) out.endsAt = optionalDate(body.endsAt);
  if (typeof body.enabled === 'boolean') out.enabled = body.enabled;
  return out;
}

module.exports = { sanitiseOfferBody };
