/** The OAuth sign-in page (staff approve an AI app) and error redirects back to the app. */
'use strict';
const { ALL_SCOPES, SCOPE_LABELS } = require('./scopes');

const escapeHtml = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/**
 * Sends the sign-in page with its security policy as a header (frame-ancestors
 * is ignored in a <meta> tag). Browsers apply form-action to the redirect that
 * follows the form submit, so the AI app's callback origin must be allowed
 * alongside 'self' — it has already been checked against the allowed apps.
 */
function sendLoginPage(res, status, page, redirectUri) {
  let callback = '';
  try {
    const u = new URL(redirectUri);
    if (u.protocol === 'https:' || u.protocol === 'http:') callback = ` ${u.origin}`;
  } catch {
    /* no callback known */
  }
  res.set('Cache-Control', 'no-store');
  res.set(
    'Content-Security-Policy',
    `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'${callback}; frame-ancestors 'none'; base-uri 'none'`,
  );
  res.status(status).type('html').send(renderLoginPage(page));
}

function renderLoginPage({ clientName, scopes, request, approvalDays, email = '', error = '' }) {
  const requested = scopes.length ? scopes : ALL_SCOPES;
  const items = requested
    .filter((s) => SCOPE_LABELS[s])
    .map((s) => `<li>${escapeHtml(SCOPE_LABELS[s])}</li>`)
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Throttlein MCP</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f4f2;color:#111;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{background:#fff;border-radius:16px;padding:32px;width:min(440px,calc(100vw - 32px));box-shadow:0 8px 32px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#555;font-size:14px}ul{margin:0 0 16px 18px;padding:0;color:#333;font-size:14px}
label{display:block;font-size:13px;font-weight:600;margin:12px 0 4px}input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ccc;border-radius:8px;font-size:15px}
button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:8px;background:#111;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
.err{background:#fde8e8;color:#8a1c1c;border-radius:8px;padding:10px 12px;font-size:14px;margin-bottom:8px}.note{font-size:12px;color:#777;margin-top:14px}
.cancel{background:none;color:#666;margin-top:6px;padding:8px}
</style></head><body><main>
<h1>Sign in to Throttlein</h1>
<p><strong>${escapeHtml(clientName || 'An AI app')}</strong> is asking for read-only access as you, for ${approvalDays} day${approvalDays === 1 ? '' : 's'}. It will only see what your admin permissions allow, and every request is recorded under your name.</p>
<ul>${items}</ul>
${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
<form method="post" action="/mcp/oauth/login" autocomplete="on">
<input type="hidden" name="request" value="${escapeHtml(request)}">
<label for="email">Work email</label><input id="email" name="email" type="email" required maxlength="254" value="${escapeHtml(email)}" autocomplete="username">
<label for="password">Password</label><input id="password" name="password" type="password" required maxlength="72" autocomplete="current-password">
<button type="submit">Allow access</button>
<button type="submit" name="deny" value="1" class="cancel">Cancel</button>
</form>
<p class="note">Only Throttlein staff accounts can connect. You can end this connection any time from the admin panel.</p>
</main></body></html>`;
}

function redirectWithError(res, redirectUri, state, error, description) {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (description) url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  res.redirect(302, url.href);
}

module.exports = { sendLoginPage, renderLoginPage, redirectWithError };
