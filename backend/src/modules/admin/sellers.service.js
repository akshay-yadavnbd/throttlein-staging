/**
 * Sellers as staff see them: the pipeline queues, the list with its stage
 * filters, one seller's page, manual status changes and identity edits.
 */
const escapeRegExp = require('../../utils/escapeRegExp');
const { sendMail } = require('../../config/mail');
const { env } = require('../../config/env');
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const { onboardingStage, STAGE_LABELS, SELLER_QUEUE_FILTERS } = require('../../utils/sellerOnboarding');
const { accountActivatedHtml } = require('../sellers');
const users = require('./users.repository');
const products = require('./products.repository');
const orders = require('./order-feed.repository');

const pageOf = (query) => {
  const page = Number(query.page || 1);
  const limit = Number(query.limit || 25);
  return { page, limit, skip: (page - 1) * limit };
};

/** The named pipeline counts (UX audit A1): dashboard card, list tabs and the bell read these. */
async function queueCounts() {
  const keys = Object.keys(SELLER_QUEUE_FILTERS);
  const counts = await Promise.all(
    keys.map((k) => {
      const { role: _role, ...rest } = SELLER_QUEUE_FILTERS[k];
      return users.countSellers(rest);
    }),
  );
  return Object.fromEntries(keys.map((k, i) => [k, counts[i]]));
}

async function loadSeller(idOrSlug) {
  const seller = await users.findSellerByIdOrSlug(idOrSlug);
  if (!seller) throw AppError.notFound('Seller not found.');
  return seller;
}

/**
 * ?status=, ?stage=signups|kycWaiting|live|suspended (the same definitions
 * the dashboard counts), ?q= and ?stalled=true. Stage and stalled clauses go
 * into $and because the search owns the top-level $or.
 */
async function list(query) {
  const { status, q, stalled, stage } = query;
  const filter = { role: 'seller' };
  if (status) filter.status = status;
  if (stage && SELLER_QUEUE_FILTERS[stage]) {
    const { role: _r, $or, ...rest } = SELLER_QUEUE_FILTERS[stage];
    Object.assign(filter, rest);
    if ($or) filter.$and = [...(filter.$and || []), { $or }];
  }
  if (q) {
    const re = new RegExp(escapeRegExp(q), 'i');
    filter.$or = [{ name: re }, { email: re }, { storeName: re }];
  }
  // Stalled = registered and then stopped. Mirrors onboardingStage(): not
  // verified, or verified with KYC never submitted / rejected / predating
  // the kyc subdocument. KYC 'pending' is excluded — they wait on US.
  if (String(stalled) === 'true') {
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { emailVerified: { $ne: true } },
          { 'kyc.status': { $in: ['not_started', 'rejected'] } },
          { 'kyc.status': { $exists: false } },
        ],
      },
    ];
  }

  const { page, limit, skip } = pageOf(query);
  const [docs, total] = await users.sellerPage(filter, { skip, limit });
  // The stall stage is attached server-side so "Send reminder" appears
  // under exactly the rule the remind endpoint enforces.
  const items = docs.map((d) => {
    const stage = onboardingStage(d);
    return { ...d.toObject(), onboardingStage: stage, onboardingStageLabel: stage ? STAGE_LABELS[stage] : '' };
  });
  return { items, total, page, limit };
}

/** Seller + catalogue stats + products + sales. */
async function detail(idOrSlug) {
  const seller = await loadSeller(idOrSlug);
  const [counts, catalogue, salesAgg] = await Promise.all([
    products.sellerCounts(seller._id),
    products.forSeller(seller._id),
    orders.sellerSales(seller._id),
  ]);
  const { revenue = 0, orders: orderCount = 0 } = salesAgg[0] || {};
  return {
    seller: { ...seller.toSafeJSON(), onboardingStage: onboardingStage(seller) },
    products: catalogue,
    stats: { ...counts, orders: orderCount, revenue },
  };
}

/**
 * Manual approve / suspend / reactivate. Since single-step KYC approval the
 * normal onboarding path never calls this with 'approved'; it remains the
 * override for suspending, reactivating, or activating an account whose
 * KYC predates auto-activation. Activation still requires verified KYC.
 */
async function setStatus(idOrSlug, status) {
  if (!['pending', 'approved', 'suspended'].includes(status)) throw AppError.badRequest('Invalid status.');
  const seller = await loadSeller(idOrSlug);
  if (status === 'approved' && seller.kyc?.status !== 'approved') {
    throw AppError.badRequest('Approve KYC first — the account can only be activated once documents are verified.');
  }
  const wasApproved = seller.status === 'approved';
  seller.status = status;
  await seller.save({ validateBeforeSave: false });

  // "Store is live" only on the activation transition.
  if (status === 'approved' && !wasApproved) {
    const base = (env.FRONTEND_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
    sendMail({
      to: seller.email,
      subject: 'Your THROTTLEIN store is live',
      html: accountActivatedHtml({ name: seller.name, dashboardUrl: `${base}/dashboard` }),
      text: `Hi ${seller.name}, your store is now active on THROTTLEIN. Visit ${base}/dashboard to start listing.`,
    }).catch((e) => logger.error({ err: e }, 'account-activated email failed'));
  }
  return { seller: seller.toSafeJSON() };
}

/** Identity edits (name, storeName, phone, alternatePhone, email); email is unique across roles. */
async function update(idOrSlug, body) {
  const updates = {};
  for (const k of ['name', 'storeName', 'phone', 'alternatePhone', 'email']) {
    if (body[k] !== undefined) updates[k] = body[k];
  }
  // Resolve first so the clash check uses the real _id (a slug in `$ne` would CastError).
  const seller = await loadSeller(idOrSlug);
  if (updates.email) {
    updates.email = String(updates.email).toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) throw AppError.badRequest('Enter a valid email.');
    if (await users.emailTakenByOther(updates.email, seller._id)) {
      throw AppError.conflict('That email is already used by another account.');
    }
  }
  if (updates.name !== undefined && !String(updates.name).trim())
    throw AppError.badRequest("Seller's name can't be blank.");
  // save() so the User pre-save hook re-derives `slug` when storeName / name change.
  Object.assign(seller, updates);
  await seller.save({ validateBeforeSave: false });
  return { seller: seller.toSafeJSON() };
}

module.exports = { queueCounts, list, detail, setStatus, update, loadSeller, pageOf };
