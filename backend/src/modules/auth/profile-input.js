/** Whitelist and clamp a profile edit. Pure. */
const { AppError } = require('../../errors/AppError');

const ALLOWED = [
  'name',
  'storeName',
  'phone',
  'alternatePhone',
  'address',
  'avatar',
  // Seller return/exchange policy — clamped to 0-365.
  'returnPolicyDays',
  'exchangePolicyDays',
  // COD master toggle + convenience fee (0-999).
  'codEnabled',
  'codCharge',
  // false (default) = seller absorbs the courier and the customer sees free
  // delivery; true = the customer picks a courier at checkout and pays it.
  'deliveryPaidByCustomer',
  // Delivery exclusions — states / pincodes this seller won't ship to.
  'excludedStates',
  'excludedPincodes',
];

/** Array OR comma/newline separated string → trimmed non-empty strings. */
const toList = (v) =>
  (Array.isArray(v) ? v : String(v || '').split(/[,\n]+/)).map((s) => String(s).trim()).filter(Boolean);

function profileUpdates(body) {
  const updates = {};
  for (const k of ALLOWED) if (body[k] !== undefined) updates[k] = body[k];
  // Legacy alias (`shopName` → storeName).
  if (updates.storeName === undefined && body.shopName !== undefined) updates.storeName = body.shopName;

  if (updates.codEnabled !== undefined) updates.codEnabled = !!updates.codEnabled;
  if (updates.deliveryPaidByCustomer !== undefined) updates.deliveryPaidByCustomer = !!updates.deliveryPaidByCustomer;
  if (updates.codCharge !== undefined) {
    const n = Number(updates.codCharge);
    updates.codCharge = Number.isFinite(n) ? Math.max(0, Math.min(999, Math.round(n))) : 0;
  }
  for (const k of ['returnPolicyDays', 'exchangePolicyDays']) {
    if (updates[k] !== undefined) {
      const n = Number(updates[k]);
      updates[k] = Number.isFinite(n) ? Math.max(0, Math.min(365, Math.floor(n))) : 7;
    }
  }
  // States: deduped, max 50. Pincodes: exact six digits, max 500 — rejected, not dropped.
  if (updates.excludedStates !== undefined) {
    updates.excludedStates = [...new Set(toList(updates.excludedStates))].slice(0, 50);
  }
  if (updates.excludedPincodes !== undefined) {
    const pins = [...new Set(toList(updates.excludedPincodes))];
    if (pins.some((p) => !/^\d{6}$/.test(p)))
      throw AppError.badRequest('Each excluded PIN code must contain exactly 6 digits.');
    if (pins.length > 500) throw AppError.badRequest('You can exclude up to 500 PIN codes.');
    updates.excludedPincodes = pins;
  }
  return updates;
}

module.exports = { profileUpdates, ALLOWED };
