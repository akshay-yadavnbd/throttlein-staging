const { env } = require('./env');
/**
 * Who receives internal "this needs a human" notifications — new seller
 * signups and KYC submitted for review.
 *
 * Why this lives in one module
 *   These alerts fire from two different controllers (authController for
 *   signup, kycController for KYC). Before this, signup mailed a single
 *   SUPER_ADMIN_EMAIL and KYC mailed nobody. Centralising the list means
 *   adding or removing a reviewer is one env change, not a code edit in
 *   two places that can drift apart.
 *
 * Resolution order
 *   TEAM_NOTIFY_EMAILS (comma-separated) overrides the built-in default.
 *   SUPER_ADMIN_EMAIL is then merged in, so an existing deployment that
 *   only ever set that variable keeps receiving what it received before —
 *   this change is purely additive and cannot silently drop a recipient.
 *
 * The default is hard-coded rather than required-from-env on purpose: the
 * addresses below are the operations team, and a missing env var in
 * production must not mean nobody hears about a new seller.
 */

const DEFAULT_RECIPIENTS = ['yuvraj.srivastav@noseberry.com', 'info@noseberry.com'];

/** Loose sanity check — enough to keep a stray comma or empty slot out of
 *  the `to` header. Real validation is the mail server's job. */
function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * @returns {string[]} de-duplicated, lower-cased recipient addresses.
 *          Empty only if someone sets TEAM_NOTIFY_EMAILS to junk AND
 *          SUPER_ADMIN_EMAIL is unset — callers must handle that.
 */
function teamNotifyRecipients() {
  const configured = String(env.TEAM_NOTIFY_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const base = configured.length ? configured : DEFAULT_RECIPIENTS;

  // Merge the legacy single-address var so nothing that used to be
  // notified stops being notified.
  const all = [...base, env.SUPER_ADMIN_EMAIL || ''];

  const seen = new Set();
  const out = [];
  for (const raw of all) {
    const addr = String(raw || '')
      .trim()
      .toLowerCase();
    if (!addr || !looksLikeEmail(addr) || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

/** Comma-joined form for nodemailer's `to` field, or '' when none. */
function teamNotifyTo() {
  return teamNotifyRecipients().join(', ');
}

module.exports = { teamNotifyRecipients, teamNotifyTo, DEFAULT_RECIPIENTS };
