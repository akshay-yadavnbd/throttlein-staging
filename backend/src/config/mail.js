const nodemailer = require('nodemailer');
const { env } = require('./env');

let cached;

/**
 * Read SMTP env. Supports two naming conventions so existing setups
 * keep working:
 *
 *   Standard      Alternative
 *   ─────────     ───────────
 *   SMTP_HOST     HOST
 *   SMTP_PORT     EMAIL_PORT
 *   SMTP_SECURE   SECURE
 *   SMTP_USER     EMAIL
 *   SMTP_PASS     PASS
 *   SMTP_FROM     FROM
 */
function readConfig() {
  const host = env.SMTP_HOST || env.HOST;
  const port = Number(env.SMTP_PORT || env.EMAIL_PORT) || 587;
  const user = env.SMTP_USER || env.EMAIL;
  const pass = env.SMTP_PASS || env.PASS;
  const secureFlag = env.SMTP_SECURE || env.SECURE;
  const secure = port === 465 || secureFlag === 'true';
  const from = env.SMTP_FROM || env.FROM || (user ? `"THROTTLEIN" <${user}>` : '');
  return { host, port, user, pass, secure, from };
}

function getTransporter() {
  if (cached) return cached;
  const { host, port, user, pass, secure } = readConfig();
  if (!host || !user || !pass) {
    throw new Error('SMTP not configured. Set SMTP_HOST/SMTP_USER/SMTP_PASS (or HOST/EMAIL/PASS) in backend/.env');
  }
  cached = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return cached;
}

/**
 * `bcc` and `replyTo` are passed through for internal team notifications
 * (modules/notifications notifyTeam), which bcc a list of ops addresses rather than
 * exposing every watcher's inbox in a visible To header. Fields are
 * forwarded explicitly rather than spreading the argument so a typo'd
 * key fails loudly here instead of being silently dropped by nodemailer.
 *
 * @param {{ to: string | string[], subject: string, html?: string, text?: string, bcc?: string | string[], cc?: string | string[], replyTo?: string, headers?: Record<string, string> }} mail
 */
async function sendMail({ to, subject, html, text, bcc, cc, replyTo, headers }) {
  const transporter = getTransporter();
  const { from } = readConfig();
  return transporter.sendMail({ from, to, subject, html, text, bcc, cc, replyTo, headers });
}

module.exports = { sendMail, readConfig };
