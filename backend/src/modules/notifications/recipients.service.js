/**
 * Super-admin management of internal notification recipients. These
 * addresses are additive (see notification-settings.model.js): each one
 * receives a copy of the events it is subscribed to. Every change is
 * written to the admin audit log — an address added here sees a copy of
 * every order, which is worth being able to trace.
 */
const mail = require('../../config/mail');
const { AppError } = require('../../errors/AppError');
const settings = require('./notifications.repository');
const { teamEmailHtml } = require('./team-email');

const { EVENTS, EVENT_KEYS } = settings;

/** Loose check — real validation is the mail server's job. */
const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Only known event keys, as booleans. */
function cleanEvents(input) {
  const out = {};
  for (const k of EVENT_KEYS) out[k] = Boolean(input?.[k]);
  return out;
}

const audit = (actor, action, meta) => settings.audit({ action, ...actor, meta });

async function recipientOf(id) {
  const doc = await settings.load();
  const r = (doc.recipients || []).id(id);
  if (!r) throw AppError.notFound('Recipient not found.');
  return { doc, r };
}

/**
 * The events, the recipients, and the env / default list shown read-only:
 * without it the page cannot explain why signup and KYC mail reaches
 * addresses that are not in the table.
 */
async function list() {
  const doc = await settings.load();
  let alwaysNotified = [];
  try {
    const { teamNotifyRecipients } = require('../../config/notifyRecipients');
    alwaysNotified = teamNotifyRecipients();
  } catch (_) {
    /* optional */
  }
  return { events: EVENTS, recipients: doc.recipients || [], alwaysNotified };
}

async function add(actor, body = {}) {
  const email = String(body.email || '')
    .trim()
    .toLowerCase();
  if (!looksLikeEmail(email)) throw AppError.badRequest('Enter a valid email address.');
  const doc = await settings.load();
  if ((doc.recipients || []).some((r) => r.email === email))
    throw AppError.conflict('That address is already on the list.');
  const events = cleanEvents(body.events);
  if (!EVENT_KEYS.some((k) => events[k]))
    throw AppError.badRequest('Choose at least one notification for this address.');
  doc.recipients.push({
    email,
    label: String(body.label || '')
      .trim()
      .slice(0, 80),
    events,
    active: true,
    addedBy: actor.actor,
    addedByEmail: actor.actorEmail,
  });
  await doc.save();
  await audit(actor, 'notifications.recipient.added', { email, events });
  return { recipients: doc.recipients };
}

async function update(actor, id, body = {}) {
  const { doc, r } = await recipientOf(id);
  if (body.events !== undefined) {
    const events = cleanEvents(body.events);
    if (!EVENT_KEYS.some((k) => events[k]))
      throw AppError.badRequest('Choose at least one notification, or turn the address off instead.');
    r.events = events;
  }
  if (body.label !== undefined) r.label = String(body.label).trim().slice(0, 80);
  if (body.active !== undefined) r.active = Boolean(body.active);
  await doc.save();
  await audit(actor, 'notifications.recipient.updated', { email: r.email, events: r.events, active: r.active });
  return { recipients: doc.recipients };
}

async function remove(actor, id) {
  const { doc, r } = await recipientOf(id);
  const { email } = r;
  r.deleteOne();
  await doc.save();
  await audit(actor, 'notifications.recipient.removed', { email });
  return { recipients: doc.recipients };
}

/**
 * One real email to exactly this address (not through notifyTeam, which
 * would reach everyone on the event). A typo'd address otherwise fails
 * silently forever. The SMTP error is surfaced so the admin need not dig in logs.
 */
async function sendTest(actor, id) {
  const { r } = await recipientOf(id);
  const subscribed = EVENTS.filter((e) => r.events?.[e.key]).map((e) => e.label);
  try {
    await mail.sendMail({
      to: r.email,
      subject: '[THROTTLEIN] Test notification',
      html: teamEmailHtml({
        heading: 'Test notification',
        intro:
          'If you are reading this, this address is set up correctly and will receive the notifications listed below.',
        rows: [
          { label: 'Address', value: r.email },
          { label: 'Subscribed to', value: subscribed.join(', ') || 'nothing yet' },
          { label: 'Sent by', value: actor.actorEmail },
        ],
      }),
      text: `Test notification for ${r.email}. Subscribed to: ${subscribed.join(', ') || 'nothing'}.`,
    });
  } catch (e) {
    throw AppError.upstream(`Could not send: ${e.message}`);
  }
  await settings.stampSent({ 'r._id': r._id });
  await audit(actor, 'notifications.recipient.tested', { email: r.email });
  return { message: `Test email sent to ${r.email}.` };
}

module.exports = { list, add, update, remove, sendTest };
