/**
 * Append-only record of sensitive admin actions.
 *
 * Created for seller impersonation ("sign in as this seller"), which is
 * the one feature where an admin acts *as somebody else*. Without a log,
 * an action taken during impersonation is indistinguishable from the
 * seller's own — so if a product were deleted or a price changed, there
 * would be no way to tell who actually did it. That ambiguity is the
 * reason a shared "master password" is unacceptable: it produces exactly
 * this gap by construction.
 *
 * Deliberately not tied to impersonation alone — `action` is free-form
 * so other sensitive operations (role changes, forced refunds, account
 * deletion) can be recorded here later without a schema change.
 *
 * Nothing in the app updates or deletes these rows.
 */
const mongoose = require('mongoose');
const { logger } = require('../../utils/logger');

const adminAuditLogSchema = new mongoose.Schema(
  {
    /** e.g. 'seller.impersonate.start', 'seller.delete'. */
    action: { type: String, required: true, index: true },

    /** WHO acted. Snapshotted alongside the ref so the log stays
     *  readable after the account is renamed or removed. */
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    actorEmail: { type: String, default: '' },
    actorRole: { type: String, default: '' },

    /** WHO/WHAT was acted upon — same snapshot reasoning. */
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    targetEmail: { type: String, default: '' },
    targetLabel: { type: String, default: '' },

    /** Request context — useful when reconstructing an incident. */
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },

    /** Anything action-specific (token lifetime, reason, counts…). */
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, statics: { record } },
);

// Newest-first reads, and "everything done to this seller".
adminAuditLogSchema.index({ createdAt: -1 });
adminAuditLogSchema.index({ target: 1, createdAt: -1 });

/**
 * Fire-and-forget writer. An audit write must never break the action it
 * is recording, so failures are logged rather than thrown — but they ARE
 * logged loudly, because silent audit loss is its own incident.
 */
function record(entry) {
  return this.create(entry).catch((e) => {
    logger.error({ err: e }, '[audit] FAILED to record %s %s', entry?.action, '-');
    return null;
  });
}

module.exports = mongoose.model('AdminAuditLog', adminAuditLogSchema);
