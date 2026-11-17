/**
 * The cart-reminder unsubscribe pages (/api/email/unsubscribe/cart-reminders),
 * reached from the List-Unsubscribe header. These answer small HTML pages,
 * not JSON: a shopper opens them in a browser.
 *
 *   GET   confirms only — link scanners and prefetchers must not unsubscribe anyone
 *   POST  opts out and cancels pending reminders (also the one-click POST mail clients send)
 */
const asyncHandler = require('express-async-handler');
const { env } = require('../../config/env');
const reminders = require('./cart-reminders.service');

function page(res, status, title, bodyHtml) {
  res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    .send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title} · THROTTLEIN</title></head>
<body style="margin:0;background:#EFF1EA;font-family:Segoe UI,Roboto,sans-serif;color:#141414">
<div style="max-width:440px;margin:64px auto;padding:32px;background:#fff;border-radius:12px">
<h1 style="font-size:20px;margin:0 0 12px">${title}</h1>${bodyHtml}</div></body></html>`);
}

const shop = () => (env.FRONTEND_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
const backLink = () =>
  `<p style="margin:20px 0 0"><a href="${shop()}" style="color:#141414">Back to THROTTLEIN</a></p>`;
const invalid = (res) =>
  page(res, 400, 'Link not valid', '<p>This unsubscribe link is invalid or incomplete.</p>' + backLink());

function readParams(req) {
  const u = typeof req.query.u === 'string' ? req.query.u : '';
  const t = typeof req.query.t === 'string' ? req.query.t : '';
  return { u, t };
}

exports.confirmUnsubscribe = (req, res) => {
  const { u, t } = readParams(req);
  if (!reminders.verifyUnsubscribeToken(u, t)) return invalid(res);
  page(
    res,
    200,
    'Stop cart reminders?',
    `
<p style="line-height:1.5;color:#3f3f44">You'll stop getting emails about items left in your THROTTLEIN bag. Order updates are not affected.</p>
<form method="post" action="?u=${encodeURIComponent(u)}&amp;t=${encodeURIComponent(t)}">
<button type="submit" style="background:#141414;color:#fff;border:0;padding:12px 22px;border-radius:8px;font-weight:bold;cursor:pointer">Unsubscribe</button>
</form>` + backLink(),
  );
};

exports.unsubscribe = asyncHandler(async (req, res) => {
  const { u, t } = readParams(req);
  if (!(await reminders.unsubscribe(u, t))) return invalid(res);
  page(
    res,
    200,
    'You’re unsubscribed',
    '<p style="line-height:1.5;color:#3f3f44">You won’t get cart reminder emails any more.</p>' + backLink(),
  );
});
