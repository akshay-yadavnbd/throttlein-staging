/**
 * Where a seller is stuck in onboarding — and whether a reminder is
 * appropriate.
 *
 * The funnel has three places a seller can stall, and each needs a
 * different email. Lumping them together would send "finish your KYC" to
 * someone who cannot even log in yet.
 *
 *   unverified    Registered, never clicked the verification link. No
 *                 password yet, so they have no account to log into.
 *                 Reminder must carry a FRESH token — the original has
 *                 almost certainly expired by the time anyone notices.
 *
 *   kyc_rejected  We reviewed and rejected. The ball is in their court
 *                 but they've done nothing since, so the reminder repeats
 *                 the reason so they know what to fix.
 *
 *   no_kyc        Verified and able to log in, but never submitted
 *                 documents at all.
 *
 * Two states are deliberately NOT stalled:
 *
 *   kyc.status === 'pending'   They submitted and are waiting on US.
 *                              Nagging them here would be actively wrong.
 *   kyc.status === 'approved'  Onboarding is finished.
 *
 * Order matters. `unverified` is checked first because nothing downstream
 * is actionable until they have an account, and `kyc_rejected` before
 * `no_kyc` because a rejected record is more specific than an absent one.
 */

const STAGES = {
  UNVERIFIED: 'unverified',
  KYC_REJECTED: 'kyc_rejected',
  NO_KYC: 'no_kyc',
};

/** Human-facing labels — reused by the admin UI chip and the audit log. */
const STAGE_LABELS = {
  [STAGES.UNVERIFIED]: 'Email not verified',
  [STAGES.KYC_REJECTED]: 'KYC rejected',
  [STAGES.NO_KYC]: 'KYC not started',
};

/**
 * @param {object} user a seller User document or lean object
 * @returns {string|null} one of STAGES, or null when not stalled
 */
function onboardingStage(user) {
  if (!user || user.role !== 'seller') return null;

  if (!user.emailVerified) return STAGES.UNVERIFIED;

  const kycStatus = user.kyc?.status || 'not_started';
  if (kycStatus === 'rejected') return STAGES.KYC_REJECTED;
  if (kycStatus === 'not_started') return STAGES.NO_KYC;

  // 'pending' (awaiting our review) and 'approved' (done) are not stalls.
  return null;
}

/** True when a reminder email makes sense for this seller. */
function isStalled(user) {
  return onboardingStage(user) !== null;
}

/**
 * Minimum gap between reminders to the same seller.
 *
 * The admin button is manual, but manual is not the same as safe: a
 * double-click, an impatient retry, or two staff working the same list
 * would all land as repeat emails to a seller who has done nothing wrong.
 * A day is long enough that a second send is a deliberate choice.
 */
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * @returns {{allowed: boolean, msRemaining: number}} whether another
 *          reminder may be sent right now.
 */
function reminderCooldown(user, now = Date.now()) {
  const last = user?.onboardingReminder?.lastSentAt;
  if (!last) return { allowed: true, msRemaining: 0 };
  const elapsed = now - new Date(last).getTime();
  // A clock skew or a bad stored date must not permanently lock the
  // button — treat anything nonsensical as "no recent reminder".
  if (!Number.isFinite(elapsed) || elapsed < 0) return { allowed: true, msRemaining: 0 };
  const remaining = REMINDER_COOLDOWN_MS - elapsed;
  return remaining > 0 ? { allowed: false, msRemaining: remaining } : { allowed: true, msRemaining: 0 };
}

/** "in about 5 hours" style text for the admin-facing error. */
function humanizeMs(ms) {
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  if (hours <= 1) return 'under an hour';
  return `about ${hours} hours`;
}

/* ── Seller queues (UX audit A1) ──────────────────────────────────────
 * Three places in the admin used the words "pending" / "awaiting review"
 * for DIFFERENT sets: the dashboard counted `status: 'pending'` accounts
 * (which includes people who never verified their email), the KYC tab
 * counted `kyc.status: 'pending'` submissions, and the bell did a third
 * thing. One vocabulary, one set of filters, used by the overview, the
 * seller list and the bell:
 *
 *   signups      Registered but nothing for us to do yet — email not
 *                verified, or KYC not submitted / sent back. Waiting on
 *                the SELLER. (`unverified` is the subset with no email.)
 *   kycWaiting   KYC submitted and waiting for OUR review. Actionable.
 *   live         Approved and selling.
 *   suspended    Switched off by an admin.
 */
const SELLER_QUEUE_FILTERS = {
  signups: {
    role: 'seller',
    status: 'pending',
    $or: [{ 'kyc.status': { $in: ['not_started', 'rejected'] } }, { 'kyc.status': { $exists: false } }],
  },
  unverified: { role: 'seller', status: 'pending', emailVerified: { $ne: true } },
  kycWaiting: { role: 'seller', $or: [{ 'kyc.status': 'pending' }, { 'kycRevision.status': 'pending' }] },
  live: { role: 'seller', status: 'approved' },
  suspended: { role: 'seller', status: 'suspended' },
};

const SELLER_QUEUE_LABELS = {
  signups: 'Sign-ups in progress',
  kycWaiting: 'KYC waiting for you',
  live: 'Live sellers',
  suspended: 'Suspended',
};

/** @param {import('mongoose').Model} User */
async function sellerQueueCounts(User) {
  const keys = Object.keys(SELLER_QUEUE_FILTERS);
  const counts = await Promise.all(keys.map((k) => User.countDocuments(SELLER_QUEUE_FILTERS[k])));
  return Object.fromEntries(keys.map((k, i) => [k, counts[i]]));
}

module.exports = {
  SELLER_QUEUE_FILTERS,
  SELLER_QUEUE_LABELS,
  sellerQueueCounts,
  STAGES,
  STAGE_LABELS,
  onboardingStage,
  isStalled,
  reminderCooldown,
  humanizeMs,
  REMINDER_COOLDOWN_MS,
};
