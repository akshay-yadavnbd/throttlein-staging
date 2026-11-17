/**
 * The public contact form (POST /api/contact): a notification to the support
 * inbox (CONTACT_INBOX, else the SMTP user) and a confirmation to the visitor.
 * Delivery is best-effort: with no SMTP configured the submission is logged
 * and still accepted, so a public form never breaks in dev.
 */
const mail = require('../../config/mail');
const { env } = require('../../config/env');
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function submit(body = {}) {
  const fullName = String(body.fullName || '').trim();
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim();
  const message = String(body.message || '').trim();

  // Basic validation — matches the client-side required check.
  // Message is optional; only name + email are required.
  if (!fullName || !email) {
    throw AppError.badRequest('Full name and email are required.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw AppError.badRequest('Please enter a valid email address.');
  }
  if (fullName.length > 200 || email.length > 200 || phone.length > 40 || message.length > 5000) {
    throw AppError.badRequest('One of the fields is too long.');
  }

  const { user: smtpUser, from } = mail.readConfig();
  const inbox = env.CONTACT_INBOX || smtpUser;

  // Internal notification — to the support inbox
  const internalSubject = `Contact form: ${fullName}`;
  const internalText = [`From: ${fullName} <${email}>`, phone ? `Phone: ${phone}` : '', '', 'Message:', message]
    .filter(Boolean)
    .join('\n');
  const internalHtml = `
    <div style="font-family: sans-serif; line-height: 1.5">
      <h2 style="margin: 0 0 12px">New contact-form submission</h2>
      <p style="margin: 0 0 4px"><strong>Name:</strong> ${escapeHtml(fullName)}</p>
      <p style="margin: 0 0 4px"><strong>Email:</strong> ${escapeHtml(email)}</p>
      ${phone ? `<p style="margin: 0 0 4px"><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : ''}
      <hr style="border: 0; border-top: 1px solid #eee; margin: 16px 0" />
      <p style="white-space: pre-wrap; margin: 0">${escapeHtml(message)}</p>
    </div>
  `;

  // Confirmation reply — to the visitor
  const confirmSubject = "Thanks — we've received your message";
  const confirmText = [
    `Hi ${fullName.split(' ')[0]},`,
    '',
    "Thanks for reaching out to Throttlein. We've received your message and our team typically responds within 24 business hours.",
    '',
    'Your message:',
    message,
    '',
    'In the meantime, feel free to browse our help center at https://throttlein.com/faqs.',
    '',
    '— THROTTLEIN Support',
  ].join('\n');
  const confirmHtml = `
    <div style="font-family: sans-serif; line-height: 1.55; color: #141414">
      <p style="margin: 0 0 12px">Hi ${escapeHtml(fullName.split(' ')[0] || fullName)},</p>
      <p style="margin: 0 0 12px">Thanks for reaching out to Throttlein. We&rsquo;ve received your message and our team typically responds within 24 business hours.</p>
      <p style="margin: 16px 0 4px"><strong>Your message</strong></p>
      <blockquote style="border-left: 3px solid #eaeaea; padding: 8px 12px; margin: 0; color: #424242; white-space: pre-wrap">${escapeHtml(message)}</blockquote>
      <p style="margin: 24px 0 12px">In the meantime, feel free to browse our help center at <a href="https://throttlein.com/faqs" style="color: #141414">throttlein.com/faqs</a>.</p>
      <p style="margin: 24px 0 0; color: #6b6b6b">— THROTTLEIN Support</p>
    </div>
  `;

  // Best-effort send. If SMTP isn't configured we still accept (202) — the
  // form should never break in dev environments.
  let sent = 0;
  try {
    if (inbox) {
      await mail.sendMail({
        to: inbox,
        subject: internalSubject,
        text: internalText,
        html: internalHtml,
      });
      sent += 1;
    }
  } catch (err) {
    logger.warn({ err }, '[contact] internal mail failed:');
  }
  try {
    if (from) {
      await mail.sendMail({
        to: email,
        subject: confirmSubject,
        text: confirmText,
        html: confirmHtml,
      });
      sent += 1;
    }
  } catch (err) {
    logger.warn({ err }, '[contact] confirmation mail failed:');
  }

  if (sent === 0) {
    logger.info('[contact] submission (no SMTP): %s', { fullName, email, phone, message });
  }
  return { received: true };
}

module.exports = { submit };
