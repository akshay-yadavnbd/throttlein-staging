/**
 * Superadmin observability: the Shiprocket account (all sellers ship under
 * the one THROTTLEIN account) and the Redis cache inspector.
 */
const shiprocket = require('../../infrastructure/shipping/shiprocket');
const { inspectRedisKeys, deleteByPattern, deleteByPrefixes } = require('../../utils/redisInspector');
const { AppError } = require('../../errors/AppError');

/** Credentials sanity check: a `shipping_address` array in the answer means the token cache works. */
const shiprocketPing = async () => ({ shiprocket: await shiprocket.listPickupLocations() });

/** Account-wide wallet: balance, hold and available-to-spend. */
async function wallet() {
  const data = await shiprocket.walletBalance();
  return { ...data?.data, raw: data };
}

const walletStatement = async ({ from, to, page }) => ({
  statement: await shiprocket.walletStatement({ from, to, page: Number(page) || 1 }),
});

/** COD orders Shiprocket has remitted (or is about to) — a COD order isn't closed until the money lands. */
const codRemittance = async () => ({ remittance: await shiprocket.codRemittance() });

/** Key groups and sizes under a prefix (or a raw pattern). */
async function redisInspect(query) {
  const prefix = query.prefix?.trim();
  const pattern = prefix ? `${prefix.replace(/:?$/, ':')}*` : query.pattern || '*';
  const { summary, groups } = await inspectRedisKeys(pattern, {
    topN: Number(query.topN || 10),
    includeGroupItems: (query.includeGroupItems ?? 'true') !== 'false',
    oversizeThresholdBytes: Math.max(1, Number(query.oversizeKB || 512)) * 1024,
  });
  return { summary, groups };
}

/** Delete `prefix:*` for each prefix AND the bare prefix keys themselves. Needs ?confirm=true. */
async function redisDeleteByPrefix(query) {
  if (query.confirm !== 'true') throw AppError.badRequest('Add ?confirm=true to proceed.');
  let prefixes = query.prefix;
  if (!prefixes) throw AppError.badRequest('Provide ?prefix=...');
  if (!Array.isArray(prefixes))
    prefixes = String(prefixes)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const prefixResult = await deleteByPrefixes(prefixes);
  const directResult = await deleteByPattern(prefixes);
  return {
    totalDeleted: (prefixResult?.totalDeleted || 0) + (directResult?.totalDeleted || 0),
    details: [...(prefixResult?.details || []), ...(directResult?.details || [])],
  };
}

module.exports = { shiprocketPing, wallet, walletStatement, codRemittance, redisInspect, redisDeleteByPrefix };
