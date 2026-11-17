/**
 * Deleting a seller: what it would remove, what blocks it, and the delete
 * itself. The preview and the delete share one impact function so the
 * dialog can never promise something different from what happens.
 *
 * Deleting a seller mid-fulfilment would orphan a live parcel: the order
 * keeps pointing at a user that no longer exists, the Shiprocket push can't
 * resolve the pickup, and a refund obligation loses its payee. In-flight
 * shipments and unsettled money are hard blockers regardless of onboarding
 * stage. Orders themselves are NEVER deleted — they are the customer's
 * receipt and the platform's financial record.
 */
const shiprocket = require('../../infrastructure/shipping/shiprocket');
const upload = require('../../middleware/upload');
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const users = require('./users.repository');
const products = require('./products.repository');
const orders = require('./order-feed.repository');
const cleanup = require('./cleanup.repository');
const { loadSeller } = require('./sellers.service');

async function impact(seller) {
  const sid = seller._id;
  const [productCount, owned, exposure] = await Promise.all([
    products.count({ seller: sid }),
    cleanup.sellerOwnershipCounts(sid),
    orders.sellerExposure(sid),
  ]);
  const blockers = [];
  if (exposure.inFlight > 0) {
    blockers.push(
      `${exposure.inFlight} shipment(s) are still with the courier. Wait for delivery or cancel them first.`,
    );
  }
  if (exposure.openReturns > 0) blockers.push(`${exposure.openReturns} return/exchange request(s) are still open.`);
  if (exposure.openRefunds > 0) blockers.push(`${exposure.openRefunds} refund(s) are awaiting processing.`);
  return {
    seller: {
      _id: seller._id,
      name: seller.name,
      email: seller.email,
      storeName: seller.storeName,
      slug: seller.slug,
      status: seller.status,
      kycStatus: seller.kyc?.status || 'not-started',
    },
    counts: { products: productCount, ...owned, orders: exposure.total },
    ordersPreserved: exposure.total,
    blockers,
    canDelete: blockers.length === 0,
  };
}

/** The preview behind the confirm dialog. */
async function preview(idOrSlug) {
  return impact(await loadSeller(idOrSlug));
}

/** Best effort: remove the seller's pickup address from Shiprocket. Returns a warning or null. */
async function removePickup(seller) {
  try {
    const nickname = seller.kyc?.shiprocket?.pickupLocation || seller.slug;
    if (!nickname) return null;
    const list = await shiprocket.listPickupLocations();
    const entries = list?.data?.shipping_address || [];
    const match = entries.find((e) => String(e.pickup_location || '').toLowerCase() === nickname.toLowerCase());
    if (match) await shiprocket.removePickupLocation({ pickup_id: match.id });
    return null;
  } catch (e) {
    const warning =
      e.code === 'PICKUP_DELETE_UNSUPPORTED'
        ? "Shiprocket couldn't auto-remove the pickup address — delete it manually from Shiprocket → Settings → Pickup Address."
        : `Shiprocket cleanup failed: ${e.message}`;
    logger.warn({ sellerEmail: seller.email, warning }, 'deleteSeller: Shiprocket cleanup');
    return warning;
  }
}

/** Wipe the seller's S3 folders (slug layout and legacy id layout). */
async function removeStorage(seller) {
  let deleted = 0;
  try {
    const prefixes = [seller.slug ? `sellers/${seller.slug}/` : null, `sellers/${seller._id}/`].filter(Boolean);
    for (const prefix of prefixes) {
      const result = await upload.deletePrefix(prefix);
      deleted += result?.deleted || 0;
    }
    return { deleted, warning: null };
  } catch (e) {
    const warning = `S3 cleanup failed: ${e.message}`;
    logger.warn({ sellerEmail: seller.email, warning }, 'deleteSeller: storage cleanup');
    return { deleted, warning };
  }
}

async function remove(idOrSlug) {
  const seller = await loadSeller(idOrSlug);
  // Re-check at delete time — the preview the admin saw may be stale.
  const impactNow = await impact(seller);
  if (!impactNow.canDelete) throw AppError.conflict(`Can't delete this seller yet. ${impactNow.blockers.join(' ')}`);

  const shiprocketWarning = await removePickup(seller);
  await users.deleteUser(seller._id);

  // Everything the seller OWNED. A failed sweep must not 500 a delete that
  // already happened; it is logged so leftovers can be cleaned deliberately.
  const removed = {};
  const sweep = async (label, fn) => {
    try {
      const r = await fn();
      removed[label] = r?.deletedCount ?? r?.modifiedCount ?? 0;
    } catch (e) {
      logger.warn({ sellerEmail: seller.email, label, err: e }, 'deleteSeller: cleanup failed');
      removed[label] = `failed: ${e.message}`;
    }
  };
  await sweep('products', () => products.deleteBySeller(seller._id));
  await sweep('offers', () => cleanup.deleteOffers(seller._id));
  await sweep('sellerMedia', () => cleanup.deleteSellerMedia(seller._id));
  await sweep('offlineSales', () => cleanup.deleteOfflineSales(seller._id));
  await sweep('brandRequests', () => cleanup.deleteBrandRequests(seller._id));
  await sweep('mediaUploaderCleared', () => cleanup.clearMediaUploader(seller._id));

  const storage = await removeStorage(seller);
  return {
    message: `Seller deleted. ${impactNow.ordersPreserved} order(s) kept for customer and accounting history.`,
    removed,
    ordersPreserved: impactNow.ordersPreserved,
    shiprocketWarning,
    storageWarning: storage.warning,
    storageDeleted: storage.deleted,
  };
}

module.exports = { impact, preview, remove };
