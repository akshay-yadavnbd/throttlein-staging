/** The sign-in form handler: staff password check, lockout, scope grant, authorization code. */
'use strict';
const jwt = require('jsonwebtoken');
const { InvalidRequestError } = require('@modelcontextprotocol/sdk/server/auth/errors.js');
const repo = require('./mcp.repository');
const { isStaff, grantScopes } = require('./scopes');
const { isUserAllowed } = require('./settings');
const limits = require('./limits');
const { newToken } = require('./oauth-tokens');
const { sendLoginPage, redirectWithError } = require('./oauth-pages');
const { appName } = require('./oauth-clients');

function createLoginHandler({ config, settings, record, now, hash, clientsStore }) {
  /** POST /mcp/oauth/login — the sign-in form submits here. */
  async function handleLogin(req, res) {
    res.set('Cache-Control', 'no-store');
    const body = req.body || {};
    let request;
    try {
      request = jwt.verify(String(body.request || ''), config.keys.login.toString('hex'), { algorithms: ['HS256'] });
    } catch {
      request = null;
    }
    if (!request)
      return sendLoginPage(
        res,
        400,
        {
          clientName: '',
          scopes: [],
          request: '',
          approvalDays: 7,
          error: 'This sign-in link has expired. Go back to your AI app and start again.',
        },
        null,
      );
    const oauthClient = await clientsStore.getClient(request.cid);
    if (!oauthClient || !oauthClient.redirect_uris.includes(request.ru))
      throw new InvalidRequestError('Unknown client or redirect_uri');
    if (body.deny)
      return redirectWithError(res, request.ru, request.st, 'access_denied', 'The user declined the request');
    const s = await settings.get();
    if (s.mode === 'off' || !s.allowOAuth)
      return redirectWithError(res, request.ru, request.st, 'access_denied', 'The AI connector is switched off');

    const rerender = (error, status = 401) =>
      sendLoginPage(
        res,
        status,
        {
          clientName: appName(oauthClient),
          scopes: request.sc || [],
          request: body.request,
          approvalDays: s.oauthApprovalDays,
          email: String(body.email || '').slice(0, 254),
          error,
        },
        request.ru,
      );
    const ip = req.ip || 'unknown';
    const lockKey = `login:${ip}`;
    if ((await limits.peek(lockKey)) >= config.limits.loginFailures)
      return rerender('Too many failed attempts from this address. Wait 15 minutes and try again.', 429);
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    const password = String(body.password || '');
    const fail = async (message) => {
      await limits.hit(lockKey, config.limits.loginFailures, config.limits.loginLockoutSeconds * 1000);
      await record({
        event: 'oauth.signin',
        outcome: 'denied',
        detail: { client: oauthClient.client_id, email: email ? `${email.slice(0, 1)}***` : '', ip },
      });
      return rerender(message);
    };
    if (!email || !password || email.length > 254 || Buffer.byteLength(password, 'utf8') > 72)
      return fail('Please enter your email and password.');
    const user = await repo.findUserByEmailWithPassword(email);
    if (!user || !user.password || !(await user.matchPassword(password))) return fail('Invalid email or password.');
    if (!isStaff(user))
      return fail('Only Throttlein staff accounts can connect. Sellers and customers cannot use this.');
    if (!isUserAllowed(s, user))
      return fail('Your account is not on the AI connector allow-list yet. Ask a superadmin to add you.');
    const scopes = grantScopes(request.sc, user);
    if (!scopes.length)
      return fail('Your account has none of the permissions this connection needs. Ask a superadmin.');

    const code = newToken('oac');
    const approvalEndsAt = new Date(now() + s.oauthApprovalDays * 86400000);
    await repo.createCode({
      codeHash: hash(code),
      clientId: oauthClient.client_id,
      user: user._id,
      scopes,
      codeChallenge: request.cc,
      redirectUri: request.ru,
      resource: request.rs || '',
      approvalEndsAt,
      expiresAt: new Date(now() + config.oauth.codeTtlMs),
    });
    await record({
      event: 'oauth.signin',
      outcome: 'ok',
      user: user._id,
      userEmail: user.email,
      detail: { client: oauthClient.client_id, name: appName(oauthClient), scopes, approvalEndsAt, ip },
    });
    const url = new URL(request.ru);
    url.searchParams.set('code', code);
    if (request.st) url.searchParams.set('state', request.st);
    res.redirect(302, url.href);
  }
  return handleLogin;
}

module.exports = { createLoginHandler };
