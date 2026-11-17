/**
 * Extra internal recipients for platform notifications, managed from the
 * super-admin dashboard (Notifications tab) instead of an env var.
 *
 * THE PROBLEM THIS SOLVES
 * Order emails went to the seller who owns the items and to the customer,
 * and nobody else. Watching the business meant either logging in or
 * owning a seller account. `config/notifyRecipients.js` already existed
 * for signup / KYC alerts, but it reads env vars — changing who gets
 * notified needed a redeploy.
 *
 * Addresses here are ADDITIVE. They never replace the seller's own copy
 * or the customer's, and for signup/KYC they merge with the env list
 * rather than overriding it, so nobody who is notified today can be
 * silently dropped by editing this from the dashboard.
 *
 * Per-recipient event subscriptions rather than one global list: an ops
 * inbox that wants every order is a different audience from a finance
 * address that only cares about refunds, and forcing them together means
 * one of them starts filtering mail — which is how alerts get ignored.
 */
const mongoose = require('mongoose');
const { logger } = require('../../utils/logger');

/**
 * The event keys. Adding one means: a key here, a checkbox in the admin
 * page, and a `notifyTeam({ event })` call at the site that sends it.
 * `label` and `description` are served to the admin UI so the copy lives
 * next to the definition instead of drifting in a separate file.
 */
const EVENTS = [
  {
    key: 'orderPlaced',
    label: 'New orders',
    description: 'Every order placed, across all sellers. One summary email per order.',
  },
  {
    key: 'orderLifecycle',
    label: 'Order status changes',
    description: 'Confirmed, shipped, delivered and cancelled updates on existing orders.',
  },
  {
    key: 'returnsRefunds',
    label: 'Returns, refunds & cancellations',
    description: 'A customer asks for a return, or a seller sends a refund to you to process.',
  },
  {
    key: 'sellerSignupKyc',
    label: 'Seller sign-ups & KYC',
    description: 'A new seller registers, or sends KYC documents for you to review.',
  },
];

const EVENT_KEYS = EVENTS.map((e) => e.key);

const recipientSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    /** Free-text note — "ops inbox", "finance", a person's name. */
    label: { type: String, default: '', trim: true },
    /** Which events this address wants. Absent key = not subscribed. */
    events: {
      orderPlaced: { type: Boolean, default: false },
      orderLifecycle: { type: Boolean, default: false },
      returnsRefunds: { type: Boolean, default: false },
      sellerSignupKyc: { type: Boolean, default: false },
    },
    /** Pause an address without losing its settings. */
    active: { type: Boolean, default: true },
    addedAt: { type: Date, default: Date.now },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    addedByEmail: { type: String, default: '' },
    /** Updated opportunistically so a dead address is visible in the UI. */
    lastSentAt: { type: Date },
  },
  { _id: true },
);

const notificationSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'notifications' },
    recipients: { type: [recipientSchema], default: [] },
  },
  { timestamps: true, versionKey: false, statics: { load, recipientsFor, EVENTS, EVENT_KEYS } },
);

/** Load (or lazily create) the singleton. */
async function load() {
  let doc = await this.findById('notifications');
  if (!doc) doc = await this.create({ _id: 'notifications' });
  return doc;
}

/**
 * Addresses to notify for one event.
 *
 * @param {string|string[]} event one or more EVENT_KEYS
 * @returns {Promise<string[]>} de-duplicated, lower-cased
 *
 * Accepts several events and returns their UNION, deduplicated. Some
 * things belong to more than one audience — a cancellation is both an
 * order-lifecycle change and a money event — and a subscriber to both
 * must still receive exactly one email, so the union happens here rather
 * than by sending twice.
 *
 * For `sellerSignupKyc` the env-configured team list is merged in, because
 * those alerts already go there and this feature must only ever ADD
 * recipients. Other events have no legacy list to preserve.
 *
 * Never throws: a notification lookup must not be able to break the
 * request that triggered it (placing an order, submitting KYC). On a DB
 * error it degrades to the env list, which is better than silence.
 */
async function recipientsFor(event) {
  const events = (Array.isArray(event) ? event : [event]).filter(Boolean);
  const out = new Set();

  if (events.includes('sellerSignupKyc')) {
    try {
      const { teamNotifyRecipients } = require('../../config/notifyRecipients');
      for (const a of teamNotifyRecipients()) out.add(a);
    } catch (_) {
      /* fall through to the DB list */
    }
  }

  try {
    const doc = await this.findById('notifications').lean();
    for (const r of doc?.recipients || []) {
      if (r.active === false) continue;
      if (!events.some((k) => r.events?.[k])) continue;
      const addr = String(r.email || '')
        .trim()
        .toLowerCase();
      if (addr) out.add(addr);
    }
  } catch (e) {
    logger.error({ err: e }, '[notify] recipient lookup failed:');
  }

  return [...out];
}

module.exports = mongoose.model('NotificationSettings', notificationSettingsSchema);
