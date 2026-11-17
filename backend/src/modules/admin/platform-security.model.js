/**
 * Single-document store for platform-level security settings.
 *
 * Currently holds the MASTER ACCESS KEY — the passphrase a super admin
 * enters to open a seller's dashboard as that seller.
 *
 * WHAT THIS KEY IS, AND WHAT IT IS NOT
 * It is a step-up ("sudo") credential, not a skeleton key. It is only
 * ever accepted on the admin-initiated impersonation endpoint, which
 * already requires an authenticated **superadmin** session. So entering
 * a seller account needs BOTH:
 *     1. a logged-in superadmin session, and
 *     2. this key.
 *
 * It is deliberately NEVER accepted on the seller or customer login
 * forms. A password that logged into any seller account straight from
 * the public login page would be a single standing secret whose leak
 * exposes every seller at once, and would put a brute-force target on
 * every account. Keep it off those paths.
 *
 * Stored as a bcrypt hash and `select: false`, so the plaintext exists
 * only in the request that sets it — it can't be read back, echoed in
 * an API response, or recovered from a database dump. Rotating it
 * requires the admin's own account password, which is what proves a
 * person (not just a hijacked session) is at the keyboard.
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const platformSecuritySchema = new mongoose.Schema(
  {
    /** Fixed id — there is exactly one of these documents. */
    _id: { type: String, default: 'master' },

    /** bcrypt hash of the master access key. Empty = not configured. */
    masterKeyHash: { type: String, default: '', select: false },

    /** Audit metadata — safe to expose; none of it reveals the key. */
    masterKeySetAt: { type: Date },
    masterKeySetBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    masterKeySetByEmail: { type: String, default: '' },
    masterKeyLastUsedAt: { type: Date },
    masterKeyLastUsedFor: { type: String, default: '' },
    /** Times it has been rotated since first being set. */
    masterKeyRotations: { type: Number, default: 0 },

    /**
     * Allow the master key to be typed into the PUBLIC seller login form
     * (POST /api/auth/login) in place of a seller's own password.
     *
     * The platform owner asked for this explicitly. It is a real
     * trade-off and worth stating plainly: the key becomes usable by
     * anyone who learns it, from anywhere, with no admin session — so
     * phishing, keylogging, shoulder-surfing or a browser password
     * manager sync now all lead to every seller account, and the login
     * endpoint can be attacked from the open internet. Mitigations that
     * are actually in place (see authController.login):
     *   - a dedicated, much tighter rate limit on master-key attempts;
     *   - the session it mints is an IMPERSONATION session, so password,
     *     email, KYC and bank-detail changes stay blocked and the seller
     *     dashboard shows the "signed in as" banner;
     *   - every successful use is written to the admin audit log.
     * Turn this off to go back to admin-panel-only access, without
     * having to discard the key itself.
     */
    masterKeyLoginEnabled: { type: Boolean, default: false },
    /** Successful public logins made with the key. */
    masterKeyLoginUses: { type: Number, default: 0 },
    masterKeyLoginLastAt: { type: Date },
    masterKeyLoginLastEmail: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false, statics: { loadWithHash, setMasterKey, verifyMasterKey, publicLoginEnabled } },
);

/** Load (or lazily create) the singleton, including the hidden hash. */
async function loadWithHash() {
  let doc = await this.findById('master').select('+masterKeyHash');
  if (!doc) {
    await this.create({ _id: 'master' });
    doc = await this.findById('master').select('+masterKeyHash');
  }
  return doc;
}

/** Hash + store a new key. Caller is responsible for authorising this. */
async function setMasterKey(plain, admin) {
  const doc = await this.loadWithHash();
  const rotating = Boolean(doc.masterKeyHash);
  const salt = await bcrypt.genSalt(12);
  doc.masterKeyHash = await bcrypt.hash(plain, salt);
  doc.masterKeySetAt = new Date();
  doc.masterKeySetBy = admin?._id;
  doc.masterKeySetByEmail = admin?.email || '';
  if (rotating) doc.masterKeyRotations = (doc.masterKeyRotations || 0) + 1;
  await doc.save();
  return { rotating };
}

/** Constant-time-ish compare via bcrypt. False when unset. */
async function verifyMasterKey(plain) {
  if (!plain) return false;
  const doc = await this.loadWithHash();
  if (!doc.masterKeyHash) return false;
  return bcrypt.compare(String(plain), doc.masterKeyHash);
}

/**
 * Is public (seller-login-form) master-key sign-in switched on?
 *
 * `undefined` counts as ON: schema defaults only apply to documents
 * created after the field existed, and the live singleton predates it.
 * Reading `undefined` as OFF would silently disable the behaviour the
 * owner asked for until they toggled it, so the coercion is explicit
 * here and used by every caller rather than re-derived per site.
 */
function publicLoginEnabled(_doc) {
  return false; // Public shared-key login is retired; support requires admin authentication.
}

module.exports = mongoose.model('PlatformSecurity', platformSecuritySchema);
