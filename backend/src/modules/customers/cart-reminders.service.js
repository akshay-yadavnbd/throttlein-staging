/**
 * Abandoned-cart reminder emails.
 *
 * How it works
 *   1. Every real shopper edit (add / change quantity / remove / clear —
 *      see cart.service) calls `markCartActivity(cart)`. That stamps
 *      `lastActivityAt`, resets `reminderStage` to 0 and schedules
 *      `reminderNextAt = lastActivityAt + first delay`. Merely VIEWING the
 *      bag does not count (GET /api/cart re-saves snapshots, which bumps
 *      `updatedAt` — that is why this uses its own field).
 *   2. A background worker (same lease pattern as shipmentWorker) claims
 *      carts whose `reminderNextAt` has passed, checks they still deserve
 *      an email, sends it, and schedules the next stage.
 *   3. After the last stage `reminderNextAt` becomes null and the cart is
 *      left alone until the shopper touches it again.
 *
 * A reminder is NOT sent (and the sequence stops) when the shopper:
 *   - has opted out (User.cartRemindersOptOut — set by the email's
 *     unsubscribe link), is suspended, or is staff/admin;
 *   - placed any order after their last cart edit;
 *   - has nothing buyable left in the bag (that stage is skipped).
 *
 * Config (backend/.env)
 *   CART_REMINDER_ENABLED=true            worker is OFF unless this is set
 *   CART_REMINDER_DELAYS_MINUTES=1440,4320,10080
 *                                         minutes after the last cart edit
 *                                         (default: 24 h, 3 days, 7 days)
 *   CART_REMINDER_INTERVAL_MS=60000       how often the worker polls
 *   PUBLIC_API_URL=https://api.throttlein.com   (required in production —
 *                                         hosts the unsubscribe link)
 *   CART_REMINDER_SECRET=                 optional; falls back to JWT_SECRET
 */
const { env } = require('../../config/env');
const { logger } = require('../../utils/logger');
const reminders = require('./cart-reminders.repository');
const { lineAvailability } = require('./cart-availability');
const email = require('./cart-reminder-email');

const DEFAULT_DELAYS_MIN = [1440, 4320, 10080]; // 24 h, 3 days, 7 days
const LEASE_MS = 10 * 60 * 1000; // a claimed cart is invisible to other workers this long
const RETRY_MS = 30 * 60 * 1000; // SMTP failure → try again in 30 min
const STALE_GRACE_MS = 24 * 3600000; // never send a reminder this late past its slot
const BATCH = 20;
const ELIGIBLE_ROLES = new Set(['customer', 'seller']);
const SENDABLE = new Set(['ok', 'limited']);

/* ── schedule ─────────────────────────────────────────────────────────── */

function minutesList(envName, fallback) {
  const raw = String(env[envName] || '').trim();
  const parsed = raw
    ? raw
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const minutes = (parsed.length ? parsed : fallback).slice(0, 5).sort((a, b) => a - b);
  return minutes.map((m) => Math.round(m * 60000));
}
const reminderDelaysMs = () => minutesList('CART_REMINDER_DELAYS_MINUTES', DEFAULT_DELAYS_MIN);

function nextReminderAt(lastActivityAt, stage, delays = reminderDelaysMs()) {
  if (!lastActivityAt || stage >= delays.length) return null;
  return new Date(new Date(lastActivityAt).getTime() + delays[stage]);
}

/** Call on every shopper-initiated cart change, before cart.save(). */
function markCartActivity(cart, now = new Date()) {
  cart.lastActivityAt = now;
  cart.reminderStage = 0;
  cart.reminderNextAt = cart.items && cart.items.length ? nextReminderAt(now, 0) : null;
  // The worker writes these with updateOne, so an already-loaded document
  // can hold stale values; force the write even when they look unchanged.
  if (typeof cart.markModified === 'function') {
    for (const f of ['lastActivityAt', 'reminderStage', 'reminderNextAt']) cart.markModified(f);
  }
}

/* ── worker ───────────────────────────────────────────────────────────── */

async function processCart(cart, { now, sendMail, imageUrl }) {
  const stage = cart.reminderStage || 0;
  const delays = reminderDelaysMs();
  const base = cart.lastActivityAt;
  const stop = async (reason) => {
    await reminders.finish(cart, { $set: { reminderNextAt: null } });
    return { cart: cart._id, result: 'stopped', reason };
  };

  if (!base || stage >= delays.length) return stop('sequence_complete');
  const slot = nextReminderAt(base, stage, delays);
  if (Number(now) - Number(slot) > STALE_GRACE_MS) return stop('stale');

  const user = await reminders.recipient(cart.user);
  if (!user || !user.email) return stop('no_user');
  if (user.cartRemindersOptOut) return stop('opted_out');
  if (!ELIGIBLE_ROLES.has(user.role) || user.status === 'suspended') return stop('ineligible_user');
  if (await reminders.orderedSince(cart.user, cart.lastActivityAt)) return stop('ordered');

  await reminders.populateForEmail(cart);
  const lines = cart.items
    .filter((it) => SENDABLE.has(lineAvailability(it).state))
    .map((it) => email.emailLine(it, imageUrl));

  const advance = { reminderStage: stage + 1, reminderNextAt: nextReminderAt(base, stage + 1, delays) };
  if (!lines.length) {
    await reminders.finish(cart, { $set: advance });
    return { cart: cart._id, result: 'skipped', reason: 'nothing_buyable' };
  }

  const unsubUrl = email.unsubscribeUrl(user._id);
  const mail = email.buildReminderEmail({
    name: user.name,
    lines,
    stage,
    isLast: stage === delays.length - 1,
    cartUrl: `${email.frontendOrigin()}/cart`,
  });
  try {
    await sendMail({
      to: user.email,
      ...mail,
      headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
  } catch (err) {
    logger.error({ err }, '[cart-reminders] send failed for cart %s', String(cart._id));
    await reminders.finish(cart, { $set: { reminderNextAt: new Date(now.getTime() + RETRY_MS) } });
    return { cart: cart._id, result: 'failed', reason: err.message };
  }
  await reminders.finish(cart, { $set: { ...advance, reminderLastSentAt: now }, $inc: { reminderSentCount: 1 } });
  return { cart: cart._id, result: 'sent', stage: stage + 1, to: user.email, subject: mail.subject };
}

/** One pass: handle up to `limit` due carts. Returns what happened to each. */
async function runCartReminderCycle({
  now = new Date(),
  sendMail = require('../../config/mail').sendMail,
  imageUrl = email.defaultImageUrl,
  limit = BATCH,
} = {}) {
  const results = [];
  for (let i = 0; i < limit; i++) {
    const cart = await reminders.claimNextDue(now, LEASE_MS);
    if (!cart) break;
    try {
      results.push(await processCart(cart, { now, sendMail, imageUrl }));
    } catch (err) {
      logger.error({ err }, '[cart-reminders] cart %s %s', String(cart._id), 'failed:');
      results.push({ cart: cart._id, result: 'error', reason: err.message });
    }
  }
  return results;
}

function startCartReminderWorker() {
  if (!env.CART_REMINDER_ENABLED) return () => {};
  if (!email.apiOrigin()) {
    logger.error(
      '[cart-reminders] PUBLIC_API_URL is not set — refusing to send reminders without a working unsubscribe link',
    );
    return () => {};
  }
  try {
    email.tokenSecret();
  } catch (err) {
    logger.error({ err }, '[cart-reminders]');
    return () => {};
  }

  const interval = Math.max(10000, Number(env.CART_REMINDER_INTERVAL_MS) || 60000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const results = await runCartReminderCycle();
      const sent = results.filter((r) => r.result === 'sent').length;
      if (sent) logger.info(`[cart-reminders] sent ${sent} reminder(s)`);
    } catch (err) {
      logger.error({ err }, '[cart-reminders] cycle failed:');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, interval);
  timer.unref();
  void tick();
  logger.info(
    `[cart-reminders] worker on — reminders at ${reminderDelaysMs()
      .map((ms) => `${ms / 60000}m`)
      .join(', ')} after last cart edit`,
  );
  return () => clearInterval(timer);
}

/** The email's one-click unsubscribe: a valid signed link opts the user out and cancels pending reminders. */
async function unsubscribe(userId, token) {
  if (!email.verifyUnsubscribeToken(userId, token)) return false;
  await reminders.optOut(userId);
  return true;
}

module.exports = {
  markCartActivity,
  runCartReminderCycle,
  startCartReminderWorker,
  unsubscribe,
  verifyUnsubscribeToken: email.verifyUnsubscribeToken,
  _internals: {
    reminderDelaysMs,
    nextReminderAt,
    unsubscribeToken: email.unsubscribeToken,
    unsubscribeUrl: email.unsubscribeUrl,
    buildReminderEmail: email.buildReminderEmail,
    emailLine: email.emailLine,
    apiOrigin: email.apiOrigin,
    brandLogoUrl: email.brandLogoUrl,
  },
};
