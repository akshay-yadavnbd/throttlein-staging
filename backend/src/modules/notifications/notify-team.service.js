/**
 * One way to send an internal notification.
 *
 * Every "tell our team about this" email goes through here rather than
 * calling sendMail directly. The same event is otherwise emailed from
 * several places, and duplicated send logic drifts — this codebase has
 * already produced two bugs of exactly that shape. One helper, one
 * resolver, one set of rules.
 *
 * Contract:
 *   - Never throws. A notification failure must not roll back the order
 *     that triggered it, so callers can `await` or fire-and-forget
 *     without a try/catch.
 *   - Returns { sent, recipients } so a caller can log what happened.
 *   - Sends to BCC, not To. These are internal watchers; five ops
 *     addresses in a visible To header would leak the team's inbox list
 *     into every forwarded mail.
 */
const { sendMail } = require('../../config/mail');
const { env } = require('../../config/env');
const { logger } = require('../../utils/logger');
const settings = require('./notifications.repository');
const { sendTeamsNotification } = require('./teams-transport');

/**
 * @param {object}  opts
 * @param {string|string[]} opts.event  one or more EVENT_KEYS; several means
 *        "anyone subscribed to any of these", deduplicated, so a person on
 *        two of them still gets a single email
 * @param {string}  opts.subject
 * @param {string}  opts.html
 * @param {string} [opts.text]
 * @param {object} [opts.notice] safe display fields for the optional Teams transport
 * @returns {Promise<{sent: boolean, recipients: string[], error?: string}>}
 */
async function notifyTeam({ event, subject, html, text, notice }) {
  // Optional transport: never waits on SMTP, blocks the caller, or changes the email result.
  sendTeamsNotification({ event, notice }).catch(() => {
    logger.warn('[notify] Optional notification transport failed.');
  });
  try {
    const recipients = await settings.recipientsFor(event);
    if (!recipients.length) return { sent: false, recipients: [] };
    await sendMail({
      // `to` is the platform itself so the message is well-formed while every real recipient is bcc'd.
      to: env.MAIL_FROM || env.SMTP_USER || recipients[0],
      bcc: recipients.join(', '),
      subject,
      html,
      text,
    });
    // Best-effort bookkeeping so the admin page can show a dead address.
    settings.stampSent({ 'r.email': { $in: recipients } }).catch(() => {
      /* metadata only */
    });
    return { sent: true, recipients };
  } catch (e) {
    logger.error({ err: e }, `[notify] ${[].concat(event).join('+')} failed:`);
    return { sent: false, recipients: [], error: e.message };
  }
}

module.exports = { notifyTeam };
