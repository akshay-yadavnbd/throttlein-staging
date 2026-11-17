/**
 * Master access key and seller impersonation.
 *
 * The key is a STEP-UP for entering a seller's dashboard. It is never
 * accepted on the public login forms (see models/PlatformSecurity.js), and
 * every write here re-checks the caller's OWN password: a live admin
 * session isn't enough, or an unattended laptop could replace the key and
 * take over every seller account. Refusals answer 403, not 401 — the
 * session is valid, only the step-up credential was wrong, and the admin
 * app force-logs-out on 401.
 */
const { signImpersonationToken } = require('../../middleware/auth');
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const users = require('./users.repository');
const security = require('./security.repository');

/** Basic strength floor. A weak key unlocks every seller account. */
function weakness(key) {
  const k = String(key || '');
  if (k.length < 12) return 'Use at least 12 characters.';
  if (!/[a-z]/.test(k) || !/[A-Z]/.test(k)) return 'Include both lower and upper case letters.';
  if (!/[0-9]/.test(k)) return 'Include at least one number.';
  if (!/[^A-Za-z0-9]/.test(k)) return 'Include at least one symbol.';
  if (/^(password|admin|master|throttlein)/i.test(k))
    return 'Too predictable — pick something unrelated to the product name.';
  return null;
}

/** The caller's record when `password` is their own; null otherwise. */
async function adminIfPasswordMatches(adminId, password) {
  const admin = await users.findAdminWithPassword(adminId);
  if (!admin || !(await admin.matchPassword(String(password || '')))) return null;
  return admin;
}

/** Status only — the key itself can never be read back. */
async function status() {
  const doc = await security.loadSecurity();
  return {
    configured: Boolean(doc.masterKeyHash),
    setAt: doc.masterKeySetAt || null,
    setByEmail: doc.masterKeySetByEmail || '',
    lastUsedAt: doc.masterKeyLastUsedAt || null,
    lastUsedFor: doc.masterKeyLastUsedFor || '',
    rotations: doc.masterKeyRotations || 0,
    loginEnabled: security.publicLoginEnabled(doc),
    loginUses: doc.masterKeyLoginUses || 0,
    loginLastAt: doc.masterKeyLoginLastAt || null,
    loginLastEmail: doc.masterKeyLoginLastEmail || '',
  };
}

/** Public shared-key login is retired; the switch only ever turns it off. */
async function setPublicLogin(enabled, ctx) {
  if (enabled)
    throw AppError.badRequest('Public shared-key login is disabled. Use authenticated seller impersonation.');
  await security.setPublicLogin(false);
  await security.audit({ action: 'security.masterKey.publicLoginDisabled', ...ctx });
  return {
    loginEnabled: false,
    message: 'The master key no longer works on the seller login form. The eye icon on Sellers still does.',
  };
}

/** Set or rotate the key. The OLD key is deliberately not required — forgetting it must not lock you out. */
async function setKey({ adminPassword, newKey }, ctx) {
  if (!adminPassword) throw AppError.badRequest('Confirm your own admin password to change the master key.');
  const admin = await adminIfPasswordMatches(ctx.actor, adminPassword);
  if (!admin) {
    await security.audit({ action: 'security.masterKey.denied', ...ctx, meta: { reason: 'bad-admin-password' } });
    throw AppError.forbidden('That admin password is incorrect.');
  }
  const weak = weakness(newKey);
  if (weak) throw AppError.badRequest(weak);
  // Two credentials that are the same string provide one factor, not two.
  if (await admin.matchPassword(String(newKey))) {
    throw AppError.badRequest('The master key must be different from your admin login password.');
  }
  const { rotating } = await security.setMasterKey(String(newKey), admin);
  await security.audit({ action: rotating ? 'security.masterKey.rotated' : 'security.masterKey.created', ...ctx });
  logger.warn({ adminEmail: admin.email, rotating }, 'security: master access key changed');
  return { message: rotating ? 'Master key rotated. The previous key no longer works.' : 'Master key set.' };
}

async function disableKey(adminPassword, ctx) {
  const admin = await adminIfPasswordMatches(ctx.actor, adminPassword);
  if (!admin) throw AppError.forbidden('That admin password is incorrect.');
  const doc = await security.loadSecurity();
  doc.masterKeyHash = '';
  doc.masterKeySetAt = undefined;
  doc.masterKeySetBy = undefined;
  doc.masterKeySetByEmail = '';
  await doc.save();
  await security.audit({ action: 'security.masterKey.disabled', ...ctx });
  logger.warn({ adminEmail: admin.email }, 'security: master access key disabled');
  return { message: 'Master key removed. Signing in as a seller now falls back to your admin password.' };
}

/**
 * A short-lived seller token so a super admin can operate the dashboard
 * exactly as that seller does. No shared master password exists: the
 * step-up is the configured key, or the admin's own password before one is
 * set up. The token expires in 30 minutes, names its operator, is audited
 * before it is handed out, and cannot change the seller's password, email
 * or payout details (`blockImpersonated`).
 */
async function impersonate(idOrSlug, password, ctx) {
  const masterConfigured = Boolean((await security.loadSecurity()).masterKeyHash);
  if (!password) {
    throw AppError.badRequest(
      masterConfigured ? 'Enter the master access key to continue.' : 'Confirm your own password to continue.',
    );
  }
  const admin = await users.findAdminWithPassword(ctx.actor);
  const ok = masterConfigured
    ? await security.verifyMasterKey(password)
    : Boolean(admin && (await admin.matchPassword(password)));
  if (!ok) {
    await security.audit({
      action: 'seller.impersonate.denied',
      ...ctx,
      meta: { reason: masterConfigured ? 'bad-master-key' : 'bad-admin-password', sellerParam: String(idOrSlug) },
    });
    throw AppError.forbidden(masterConfigured ? 'That master access key is incorrect.' : 'That password is incorrect.');
  }

  const seller = await users.findSellerByIdOrSlug(idOrSlug);
  if (!seller) throw AppError.notFound('Seller not found.');
  if (seller.role !== 'seller') throw AppError.badRequest('That account is not a seller.');

  const ttlMinutes = 30;
  const token = signImpersonationToken(seller, admin, `${ttlMinutes}m`);
  await security.audit({
    action: 'seller.impersonate.start',
    ...ctx,
    target: seller._id,
    targetEmail: seller.email,
    targetLabel: seller.storeName || seller.name || '',
    meta: { ttlMinutes, stepUp: masterConfigured ? 'master-key' : 'admin-password' },
  });
  if (masterConfigured) {
    const doc = await security.loadSecurity();
    doc.masterKeyLastUsedAt = new Date();
    doc.masterKeyLastUsedFor = `signed in as ${seller.email}`;
    await doc.save();
  }
  logger.warn(
    { adminEmail: admin.email, sellerEmail: seller.email, ttlMinutes },
    'impersonate: admin signed in as seller',
  );
  return {
    token,
    expiresInMinutes: ttlMinutes,
    seller: { _id: seller._id, name: seller.name, email: seller.email, storeName: seller.storeName, slug: seller.slug },
  };
}

module.exports = { status, setPublicLogin, setKey, disableKey, impersonate, weakness };
