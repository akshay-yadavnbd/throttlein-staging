const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const ROLES = ['superadmin', 'staff', 'seller', 'customer'];

/**
 * Permission keys are intentionally NOT enum-restricted at the schema
 * level. The set of valid modules lives in the admin frontend's
 * `lib/modules.ts` (single source of truth for the sidebar + the
 * staff permission grid). Adding a new module → add one entry there
 * → it shows up in the assignment UI automatically.
 *
 * The backend enforces access via the `requirePermission('foo')`
 * middleware on each route, so an unknown / typo key stored on a User
 * is harmless — it just won't unlock anything. This keeps the system
 * extensible without forcing a backend deploy whenever marketing
 * decides they need a new admin section.
 */

const { KYC_STATES, kycSchema } = require('./user-kyc.schema-part');

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, default: 'Home' }, // Home / Work / etc.
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, default: '', trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    pincode: { type: String, required: true, trim: true },
    country: { type: String, default: 'India', trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true, timestamps: true },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // Password is set during signup OR after email verification (email-first flow).
    // Required at the controller layer once the account is "active".
    password: { type: String, minlength: 6, select: false },
    /**
     * Session generation. Every issued JWT embeds the value current at
     * sign-in (`tv`); `middleware/auth.protect` refuses any token whose
     * `tv` is older. The pre-save hook below bumps it on every password
     * change, so a reset/change revokes tokens held by anyone else —
     * previously a leaked token stayed usable for its full 7-day life
     * even after the victim changed their password.
     */
    tokenVersion: { type: Number, default: 0 },
    role: { type: String, enum: ROLES, default: 'seller' },

    // ─── Staff permissions ───────────────────────────────────────────
    // Module keys a `role:'staff'` user can access. Empty for non-staff
    // roles (the superadmin has implicit access to everything; sellers
    // + customers don't see the admin panel).
    //
    // No enum — the canonical key set lives in the admin frontend's
    // modules registry. The middleware does the actual enforcement at
    // route time, so any key that isn't gated by a route is a no-op.
    permissions: {
      type: [{ type: String, trim: true, lowercase: true }],
      default: [],
    },

    // Email verification (email-first seller onboarding)
    emailVerified: { type: Boolean, default: false },
    emailVerifyToken: { type: String, select: false },
    emailVerifyExpires: { type: Date, select: false },

    // Seller-specific fields
    // Renamed from `shopName` → `storeName` (May 2026). Run
    //   npm run migrate:store-name
    // once on existing DBs to copy the field. Until then there may be a brief
    // window where some legacy docs still hold the old key; reads default to
    // `storeName`, writes go to `storeName`. Backwards-compat input mapping
    // (req.body.shopName → storeName) is handled in authController.
    storeName: { type: String, trim: true },
    // URL slug derived from storeName (or name as fallback). Used so admin
    // seller pages can live at /sellers/nbd-bikes instead of /sellers/<ObjectId>.
    // Sparse + unique: customers/admins don't have one, sellers must each have
    // a distinct slug. The pre-save hook keeps it in sync with storeName.
    slug: { type: String, trim: true, lowercase: true, index: true, sparse: true, unique: true },
    phone: { type: String, trim: true },
    // Optional fallback number — couriers / support call this if the primary
    // phone goes unanswered. Seller manages it from their profile page;
    // admin can also override it from the seller detail page.
    alternatePhone: { type: String, trim: true, default: '' },
    address: { type: String, trim: true },

    /**
     * Seller-controlled return / exchange policy (sellers only; ignored for
     * customers + admins). Customers see this on the order detail page; the
     * backend uses it to gate the customer's "Return / Exchange" request.
     * 0 = returns disabled. Default 7 days matches Indian e-commerce norms.
     */
    returnPolicyDays: { type: Number, default: 7, min: 0, max: 365 },
    exchangePolicyDays: { type: Number, default: 7, min: 0, max: 365 },
    /**
     * Seller-controlled COD settings. `codEnabled=false` removes COD as a
     * payment option for this seller's products everywhere on the storefront
     * (product page badge, cart payment selector, order creation). When a
     * cart spans multiple sellers, COD is only offered if EVERY seller in
     * the cart has codEnabled=true. `codCharge` is the convenience fee
     * added to a COD order's total (₹) — for multi-seller carts, the
     * highest seller's fee is used (charged once, not stacked). Default
     * codEnabled=true keeps existing sellers unchanged.
     */
    codEnabled: { type: Boolean, default: true },
    codCharge: { type: Number, default: 0, min: 0, max: 999 },

    /**
     * Who pays the courier for this seller's parcels.
     *
     *  false (default) — the SELLER absorbs it: the customer sees "Free
     *    delivery" and the courier's bill is deducted from the seller's
     *    weekly settlement, which is how every existing order works.
     *  true — the CUSTOMER pays it: at checkout they pick a courier for
     *    this seller's parcel from live Shiprocket rates and pay that
     *    exact amount on top of the items. The collected amount is added
     *    back in the settlement, so it cancels the courier's bill and the
     *    seller nets the same as an unshipped item.
     *
     * Default false keeps every seller on file behaving as before.
     */
    deliveryPaidByCustomer: { type: Boolean, default: false },

    /**
     * Delivery exclusions — places this seller does NOT ship to.
     * Managed from the seller Profile tab; enforced on the PDP
     * "Check delivery" widget and (hard) at checkout for every
     * seller in the cart.
     *  - excludedStates: state names, compared case-insensitively
     *    against the shipping address state.
     *  - excludedPincodes: 6-digit exact pincodes OR shorter numeric
     *    prefixes ("19" blocks every 19xxxx pincode).
     * Empty arrays (default) = ships everywhere the courier reaches.
     */
    excludedStates: { type: [String], default: [] },
    excludedPincodes: { type: [String], default: [] },

    // Approval flow controlled by super admin
    status: {
      type: String,
      enum: ['pending', 'approved', 'suspended'],
      default: 'approved', // sellers are auto-approved by default; flip to 'pending' for manual review
    },
    avatar: { type: String, default: '' },

    // Customer-only — saved shipping addresses
    addresses: { type: [addressSchema], default: [] },

    // Seller-only — KYC documents (GST, PAN, pickup address) + review status
    kyc: { type: kycSchema, default: () => ({}) },
    // Proposed changes are isolated from the approved operational details.
    kycRevision: { type: kycSchema, default: undefined },

    /**
     * Seller-only — audit trail for admin-sent onboarding reminders.
     *
     * Stored rather than derived because there is nowhere else to read it
     * from: the mail goes out through SendGrid and we keep no local log,
     * so without this the admin panel cannot tell you whether someone was
     * already nudged yesterday. `count` and `lastStage` also make it
     * obvious when a seller has been reminded repeatedly and still hasn't
     * moved — that's a phone call, not a fourth email.
     */
    onboardingReminder: {
      lastSentAt: { type: Date },
      count: { type: Number, default: 0 },
      // Which stall stage the last reminder addressed (see
      // utils/sellerOnboarding.js STAGES). Kept so a seller who moved
      // from 'unverified' to 'no_kyc' can be reminded again immediately
      // if you want, without the count reading as spam.
      lastStage: { type: String, default: '' },
    },

    // Abandoned-cart reminder emails — set by the unsubscribe link in the
    // email itself (modules/customers/email-preferences.routes.js).
    cartRemindersOptOut: { type: Boolean, default: false },
    cartRemindersOptOutAt: { type: Date },

    // Password reset
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    methods: { matchPassword, toSafeJSON, generateEmailVerifyToken, generateResetToken, generateInviteToken },
  },
);

// Hash password before save
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  // Revoke every previously-issued token (see `tokenVersion` above).
  // Skipped on creation — a brand-new account has no sessions to kill,
  // and starting at 0 keeps the first token's `tv` consistent.
  if (!this.isNew) {
    this.tokenVersion = (Number(this.tokenVersion) || 0) + 1;
  }
});

/**
 * Slugify a string: lowercase, ASCII-only, hyphen-separated.
 *  "NBD Bikes & Co." → "nbd-bikes-co"
 */
function slugifyBase(input) {
  return (
    String(input || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip diacritics
      .replace(/[^a-z0-9]+/g, '-') // non-alnum → hyphen
      .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
      .slice(0, 60) || 'seller'
  );
}

/**
 * Auto-maintain `slug` for sellers AND customers. Runs on create + whenever
 * the source name/storeName changes. Resolves collisions by appending
 * -2, -3, … until the slug is free. Skipped for admins (no detail page needs
 * a slug; sparse-unique on the index handles that).
 *
 * Source field per role:
 *   seller   → storeName || name
 *   customer → name
 */
userSchema.pre('save', async function () {
  if (this.role !== 'seller' && this.role !== 'customer') return;
  const sourceChanged = this.isModified('storeName') || this.isModified('name');
  if (this.slug && !sourceChanged) return;

  const source = this.role === 'seller' ? this.storeName || this.name : this.name;
  const base = slugifyBase(source);
  let candidate = base;
  let n = 1;
  // Walk forward until we find a slug nobody else owns.
  // Self is excluded so re-saving without changes is a no-op.
  while (await this.$model().exists({ slug: candidate, _id: { $ne: this._id } })) {
    n += 1;
    candidate = `${base}-${n}`;
    if (n > 50) {
      candidate = `${base}-${Date.now().toString(36)}`;
      break;
    }
  }
  this.slug = candidate;
});

// Compare password
function matchPassword(entered) {
  return bcrypt.compare(entered, this.password);
}

function toSafeJSON() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpires;
  delete obj.emailVerifyToken;
  delete obj.emailVerifyExpires;
  // Pending pickup-confirmation OTP. The stored value is a SHA-256 of a SIX
  // DIGIT code — a one-million-entry keyspace, so the hash is brute-forceable
  // in milliseconds and is effectively the code itself. Stripping it here (the
  // canonical safe serialiser) covers every caller rather than relying on each
  // endpoint to remember. Controllers using .lean() bypass this method and
  // call sanitizeKyc() in the sellers module instead.
  if (obj.kyc?.pickupSelfVerification) {
    delete obj.kyc.pickupSelfVerification.otpHash;
    delete obj.kyc.pickupSelfVerification.sentToday;
    delete obj.kyc.pickupSelfVerification.sentTodayDate;
  }
  if (obj.kycRevision?.pickupSelfVerification) {
    delete obj.kycRevision.pickupSelfVerification;
  }
  return obj;
}

/**
 * Generate a one-time email-verification token.
 * Plain token is returned to be emailed; hash is stored in DB.
 * Valid for 48 hours so sellers have a window to click the link.
 */
function generateEmailVerifyToken() {
  const token = crypto.randomBytes(32).toString('hex');
  this.emailVerifyToken = crypto.createHash('sha256').update(token).digest('hex');
  this.emailVerifyExpires = Date.now() + 48 * 60 * 60 * 1000; // 48h
  return token;
}

/**
 * Generate a one-time password reset token.
 * - Plain token is returned to be emailed to the user.
 * - SHA-256 hash is stored in DB so a DB leak doesn't expose live tokens.
 * - Token expires after 1 hour.
 */
function generateResetToken() {
  const token = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto.createHash('sha256').update(token).digest('hex');
  this.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1h
  return token;
}

/**
 * Like `generateResetToken` but with a longer TTL — used for the
 * staff-invitation flow where the superadmin creates an account
 * without a password and the invitee follows an emailed link to set
 * one. Reuses the `passwordResetToken` field so the existing
 * `/auth/reset-password/:token` endpoint handles the actual
 * password-set step with no new code.
 *
 * Default 7-day window gives the invitee a comfortable buffer to
 * notice the email + click the link without expiry anxiety.
 */
function generateInviteToken(ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const token = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto.createHash('sha256').update(token).digest('hex');
  this.passwordResetExpires = Date.now() + ttlMs;
  return token;
}

// Auto-cleanup S3 objects when image fields are replaced or the doc
// is deleted. See utils/imageCleanup.js for the diff-and-delete logic.
const { attachImageCleanup } = require('../utils/imageCleanup');
attachImageCleanup(userSchema, [
  { path: 'avatar' },
  { path: 'kyc.gstCertificate' },
  { path: 'kyc.panCard' },
  { path: 'kyc.bankDetails.cancelledCheque' },
  { path: 'kycRevision.gstCertificate' },
  { path: 'kycRevision.panCard' },
  { path: 'kycRevision.bankDetails.cancelledCheque' },
]);

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
module.exports.KYC_STATES = KYC_STATES;
