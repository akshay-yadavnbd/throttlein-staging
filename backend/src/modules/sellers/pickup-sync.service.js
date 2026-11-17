/**
 * The seller's pickup location on Shiprocket: push it, read its state,
 * let the seller re-sync or edit it.
 *
 * Shiprocket's external API exposes NO pickup-phone OTP endpoint (probed
 * 2026-08-03, 20 candidate paths, all 404 — while GET /settings/company/pickup
 * is 200 and POST-only paths answer 405, so the 404s are real). Phone
 * verification happens in Shiprocket's own panel; `readPickupStatus` reads
 * `phone_verified` back and keeps `pickupVerifiedAt` in step. Shiprocket
 * confirmed in writing (Sep 2026) that verification is not required to ship
 * through the API, so nothing here may gate shipping on it.
 */
const shiprocket = require('../../infrastructure/shipping/shiprocket');
const { env } = require('../../config/env');
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const repo = require('./sellers.repository');
const { phone10 } = require('./kyc-rules');

/** The address payload Shiprocket's pickup endpoints take. */
function pickupPayload(nickname, addr, fallback = {}) {
  return {
    pickup_location: nickname,
    name: addr.contactName || fallback.name,
    email: addr.contactEmail || fallback.email,
    phone: phone10(addr.contactPhone),
    address: addr.line1,
    address_2: addr.line2 || '',
    city: addr.city,
    state: addr.state,
    country: addr.country || 'India',
    pin_code: String(addr.pincode),
  };
}

/**
 * Push a seller's KYC pickup address to Shiprocket as a Pickup Location.
 * The nickname is the seller slug (max 36 chars, Shiprocket's limit).
 * Updates seller.kyc.shiprocket in place — the caller saves.
 *
 * Returns { ok: true } on success, { ok: false, error } on failure. Never
 * throws: it runs after KYC approval, and transient Shiprocket downtime
 * must not block the approval flow.
 */
async function syncSellerPickupToShiprocket(seller) {
  seller.kyc = seller.kyc || {};
  seller.kyc.shiprocket = seller.kyc.shiprocket || {};
  const addr = seller.kyc.pickupAddress || {};

  // Hard prerequisites — refuse to call Shiprocket with junk data.
  if (!seller.slug) return { ok: false, error: 'seller has no slug' };
  if (!addr.line1) return { ok: false, error: 'pickup address line 1 missing' };
  if (!addr.city) return { ok: false, error: 'pickup city missing' };
  if (!addr.state) return { ok: false, error: 'pickup state missing' };
  if (!addr.pincode) return { ok: false, error: 'pickup pincode missing' };
  if (!addr.contactPhone) return { ok: false, error: 'pickup contact phone missing' };

  // Shiprocket nickname constraints: ≤36 chars, alphanumerics + hyphens.
  // The seller slug already satisfies the charset; just truncate.
  const nickname = seller.slug.slice(0, 36);

  const recordSynced = (extra) => {
    seller.kyc.shiprocket.pickupLocation = nickname;
    seller.kyc.shiprocket.syncedAt = new Date();
    seller.kyc.shiprocket.lastSyncError = '';
    return { ok: true, nickname, ...extra };
  };

  try {
    await shiprocket.addPickupLocation(pickupPayload(nickname, addr, seller));
    return recordSynced();
  } catch (e) {
    // Shiprocket returns 422 / 400 if a pickup location with the same nickname
    // already exists. Treat that as success — the data is on their side, just
    // record the nickname locally.
    const msg = e.message || String(e);
    const alreadyExists = /already exists|duplicate|same name|same nickname/i.test(msg) || e.status === 422;
    if (alreadyExists) return recordSynced({ existed: true });
    seller.kyc.shiprocket.lastSyncError = msg.slice(0, 500);
    logger.error({ sellerEmail: seller.email, reason: msg }, 'Shiprocket pickup sync failed');
    return { ok: false, error: msg };
  }
}

/**
 * Read one seller's pickup status from Shiprocket — the single source of
 * truth for verification, shared by the seller dashboard and the admin KYC
 * card so the two can never disagree.
 *
 * Returns the response body directly (never throws): `{ ok: false, reason }`
 * on any dead end, `{ ok: true, ... }` with the live flags otherwise.
 */
async function readPickupStatus(seller) {
  if (seller.kyc?.status !== 'approved') return { ok: false, reason: 'kyc-not-approved' };

  const nickname = seller.kyc?.shiprocket?.pickupLocation;
  if (!nickname) return { ok: false, reason: 'not-synced' };

  try {
    const list = await shiprocket.listPickupLocations();
    const entries = list?.data?.shipping_address || [];
    let match = entries.find((e) => String(e.pickup_location || '').toLowerCase() === nickname.toLowerCase());

    // Mock-mode fallback: the mock pickup store is process-local in-memory,
    // so a backend restart wipes it even though the seller's DB record still
    // says they're synced. Re-add the pickup so the dashboard doesn't flash
    // a confusing "Pickup not yet on Shiprocket" banner every restart.
    if (!match && String(env.SHIPROCKET_MOCK_MODE || '').toLowerCase() === 'true') {
      const addr = seller.kyc?.pickupAddress || {};
      const seed = await shiprocket.addPickupLocation(
        pickupPayload(nickname, {
          contactName: addr.contactName || seller.name || 'Seller',
          contactEmail: addr.contactEmail || seller.email || 'seller@throttlein.in',
          contactPhone: addr.contactPhone || '9999999999',
          line1: addr.line1 || 'Mock pickup address',
          line2: addr.line2,
          city: addr.city || 'Mumbai',
          state: addr.state || 'Maharashtra',
          country: addr.country,
          pincode: addr.pincode || '400001',
        }),
      );
      match = seed?.address || null;
    }

    if (!match) return { ok: false, reason: 'not-found-on-shiprocket', nickname };

    // `phone_verified` is the ONLY field that reflects OTP verification.
    // `status` is an address-active toggle, fully orthogonal to it — live
    // data holds both combinations (active+unverified, verified+disabled).
    // A past `status === 1 || phone_verified === 1` reported every active
    // pickup as verified and hid the seller's own confirm button.
    const isVerified = Number(match.phone_verified) === 1;

    // Keep the DB in step with Shiprocket, so the seller dashboard (live
    // API) and the admin KYC card (`pickupVerifiedAt` in Mongo) never answer
    // the same question differently. Best-effort: a failed write must not
    // break the read. This sync is also why admin has no manual "mark
    // verified" override — the next read would stomp it.
    const recorded = !!seller.kyc?.shiprocket?.pickupVerifiedAt;
    if (isVerified !== recorded) {
      try {
        seller.kyc.shiprocket.pickupVerifiedAt = isVerified ? new Date() : undefined;
        await seller.save({ validateBeforeSave: false });
      } catch (saveErr) {
        logger.error({ err: saveErr }, 'shiprocket pickupVerifiedAt sync failed');
      }
    }

    return {
      ok: true,
      nickname,
      pickupId: match.id,
      isVerified,
      // Only status=1 is the toggle ON; a verified address CAN be disabled.
      // Anything else means orders will not be collected — worth a loud
      // banner, so this errs toward reporting inactive.
      isActive: Number(match.status) === 1,
      statusRaw: Number(match.status),
      phone: match.phone,
      city: match.city,
      pincode: match.pin_code,
    };
  } catch (e) {
    return { ok: false, reason: 'shiprocket-error', error: e.message };
  }
}

async function loadSeller(id) {
  const seller = await repo.findById(id);
  if (!seller) throw AppError.notFound('Seller not found');
  return seller;
}

/** Pickup status for the signed-in seller. */
const myPickupStatus = async (sellerId) => readPickupStatus(await loadSeller(sellerId));

/** Pickup status for a seller staff are reviewing (id or slug). Read-only. */
async function adminPickupStatus(idOrSlug) {
  const seller = await repo.findSellerByIdOrSlug(idOrSlug);
  if (!seller) throw AppError.notFound('Seller not found');
  return readPickupStatus(seller);
}

/**
 * Seller triggers (or retries) the pickup sync — when the sync at approval
 * failed, or while troubleshooting a "pickup not synced" error. A pickup
 * already on Shiprocket is a no-op that returns the current nickname.
 */
async function syncMyPickup(sellerId) {
  const seller = await loadSeller(sellerId);
  if (seller.kyc?.status !== 'approved') {
    throw AppError.badRequest('KYC must be approved before syncing pickup with Shiprocket.');
  }
  const result = await syncSellerPickupToShiprocket(seller);
  await seller.save({ validateBeforeSave: false });
  if (!result.ok) throw AppError.badRequest(`Sync failed: ${result.error}`);
  return {
    ok: true,
    nickname: result.nickname,
    existed: !!result.existed,
    message: result.existed
      ? `Already synced as "${result.nickname}".`
      : `Pickup synced as "${result.nickname}". Verify it via OTP to start shipping.`,
  };
}

/**
 * Seller edits the pickup address after approval. Persisted locally AND
 * pushed with updatePickupLocation so future shipments leave from the new
 * address. The nickname stays the same; the address needs re-verifying.
 */
async function editMyPickup(sellerId, body = {}) {
  const seller = await loadSeller(sellerId);
  if (seller.kyc?.status !== 'approved') {
    throw AppError.badRequest('KYC must be approved before editing your pickup address.');
  }
  const nickname = seller.kyc?.shiprocket?.pickupLocation;
  if (!nickname) throw AppError.badRequest('Pickup not synced yet — run sync-pickup first.');

  seller.kyc.pickupAddress = seller.kyc.pickupAddress || /** @type {any} */ ({});
  const current = seller.kyc.pickupAddress;
  const merged = {
    contactName: String(body.contactName || current.contactName || seller.name),
    contactPhone: phone10(body.contactPhone || current.contactPhone || seller.phone || ''),
    contactEmail: String(body.contactEmail || current.contactEmail || seller.email),
    line1: String(body.line1 || current.line1 || ''),
    line2: String(body.line2 || current.line2 || ''),
    city: String(body.city || current.city || ''),
    state: String(body.state || current.state || ''),
    pincode: String(body.pincode || current.pincode || ''),
    country: String(body.country || current.country || 'India'),
  };
  for (const f of ['line1', 'city', 'state', 'pincode', 'contactPhone']) {
    if (!merged[f]) throw AppError.badRequest(`${f} is required`);
  }
  Object.assign(seller.kyc.pickupAddress, merged);

  try {
    await shiprocket.updatePickupLocation(pickupPayload(nickname, merged));
    // Address changed → re-OTP-verify required.
    seller.kyc.shiprocket.pickupVerifiedAt = undefined;
    seller.kyc.shiprocket.lastSyncError = '';
  } catch (e) {
    seller.kyc.shiprocket.lastSyncError = String(e.message).slice(0, 500);
    await seller.save({ validateBeforeSave: false });
    throw AppError.badRequest(`Couldn't update pickup on Shiprocket: ${e.message}`);
  }
  seller.markModified('kyc');
  await seller.save({ validateBeforeSave: false });
  return { ok: true, message: 'Pickup address updated. Re-verify OTP to start shipping from the new address.' };
}

module.exports = {
  syncSellerPickupToShiprocket,
  readPickupStatus,
  pickupPayload,
  myPickupStatus,
  adminPickupStatus,
  syncMyPickup,
  editMyPickup,
};
