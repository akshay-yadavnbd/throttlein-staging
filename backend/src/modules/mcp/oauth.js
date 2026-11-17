/**
 * OAuth 2.1 authorization server for the MCP endpoint.
 *
 * AI apps (claude.ai, Claude Code, Claude Desktop) discover this server
 * through /.well-known metadata, register themselves, send the staff member
 * to /authorize to sign in with their Throttlein credentials, and exchange
 * the resulting code for tokens at /token (PKCE enforced by the SDK). Every
 * later tool call carries an access token that resolves back to that person,
 * so the connection sees exactly what they may see in the admin panel and
 * every audit row names them.
 *
 * The SDK supplies the endpoints (mcpAuthRouter) and the bearer middleware;
 * this file supplies the provider behind them, backed by mcp-oauth.model.js.
 * Credentials are opaque random strings (`tin_oat_` access, `tin_ort_`
 * refresh, `tin_oac_` code) stored as keyed HMACs. A sign-in is an
 * *approval* that lasts `oauthApprovalDays` (default 7); refreshing never
 * extends it. Refresh tokens rotate on every use and presenting an old one
 * ends the whole connection (theft detection), with a short grace for a
 * genuine retry. A replayed authorization code revokes what it issued.
 */
'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const {
  AccessDeniedError,
  InvalidGrantError,
  InvalidTargetError,
  InvalidTokenError,
} = require('@modelcontextprotocol/sdk/server/auth/errors.js');
const repo = require('./mcp.repository');
const { isStaff, allowedScopes, grantScopes } = require('./scopes');
const { redirectAllowed, isUserAllowed } = require('./settings');
const { newToken, parseToken } = require('./oauth-tokens');
const { sendLoginPage, renderLoginPage } = require('./oauth-pages');
const { appName, createClientsStore } = require('./oauth-clients');
const { createLoginHandler } = require('./oauth-login');

function createOAuthProvider({ config, settings, audit, now = Date.now }) {
  const hash = (value) => crypto.createHmac('sha256', config.keys.token).update(String(value)).digest('hex');
  const record = (entry) => audit.tryRecord(entry);

  async function available() {
    const s = await settings.get();
    if (s.mode === 'off') throw new AccessDeniedError('The Throttlein AI connector is switched off.');
    if (!s.allowOAuth) throw new AccessDeniedError('Signing in with an AI app is switched off by a superadmin.');
    return s;
  }
  function checkResource(resource) {
    if (resource && resource.href.replace(/\/$/, '') !== config.resource.href.replace(/\/$/, ''))
      throw new InvalidTargetError(`This server only issues tokens for ${config.resource.href}`);
  }
  /** The person must still be an active, allowed staff member with an unchanged password for any token to be issued or honoured. */
  async function liveOwner(record_, s) {
    const user = await repo.findUserLean(record_.user, 'name email role status permissions tokenVersion');
    if (!isStaff(user)) throw new InvalidGrantError('The account can no longer use the AI connector.');
    if ((Number(user.tokenVersion) || 0) !== (Number(record_.tokenVersion ?? user.tokenVersion) || 0))
      throw new InvalidGrantError('The account password changed; sign in again.');
    if (!isUserAllowed(s, user))
      throw new InvalidGrantError('The account is not allowed to use the AI connector; ask a superadmin.');
    return user;
  }
  const revokeFamily = (family, revokedBy, revokeReason) =>
    repo.revokeTokens({ family }, new Date(now()), revokedBy, revokeReason);

  async function issueTokens({ oauthClient, user, scopes, resource, approvalEndsAt, family = crypto.randomUUID() }) {
    const access = newToken('oat');
    const refresh = newToken('ort');
    const at = now();
    const accessExpiresAt = new Date(Math.min(at + config.oauth.accessTtlSeconds * 1000, approvalEndsAt.getTime()));
    const base = {
      clientId: oauthClient.client_id,
      clientName: appName(oauthClient),
      user: user._id,
      scopes,
      tokenVersion: Number(user.tokenVersion) || 0,
      family,
      resource: resource || '',
      approvalEndsAt,
    };
    await repo.insertTokens([
      { ...base, tokenHash: hash(access), kind: 'access', expiresAt: accessExpiresAt },
      { ...base, tokenHash: hash(refresh), kind: 'refresh', expiresAt: approvalEndsAt },
    ]);
    await repo.touchClient(oauthClient.client_id, new Date(at));
    return {
      tokens: {
        access_token: access,
        token_type: 'bearer',
        expires_in: Math.max(1, Math.floor((accessExpiresAt.getTime() - at) / 1000)),
        refresh_token: refresh,
        scope: scopes.join(' '),
      },
      family,
      accessExpiresAt,
    };
  }

  const clientsStore = createClientsStore({ settings, record, now });

  const provider = {
    clientsStore,

    async authorize(oauthClient, params, res) {
      const s = await available();
      if (!redirectAllowed(params.redirectUri, s))
        throw new AccessDeniedError('This app is not allowed to connect to Throttlein.');
      checkResource(params.resource);
      const request = jwt.sign(
        {
          cid: oauthClient.client_id,
          ru: params.redirectUri,
          cc: params.codeChallenge,
          sc: params.scopes || [],
          st: params.state || '',
          rs: params.resource ? params.resource.href : '',
        },
        config.keys.login.toString('hex'),
        { expiresIn: config.oauth.loginFormTtl },
      );
      await record({
        event: 'oauth.authorize',
        outcome: 'ok',
        detail: { client: oauthClient.client_id, name: appName(oauthClient) },
      });
      sendLoginPage(
        res,
        200,
        { clientName: appName(oauthClient), scopes: params.scopes || [], request, approvalDays: s.oauthApprovalDays },
        params.redirectUri,
      );
    },

    async challengeForAuthorizationCode(oauthClient, code) {
      if (parseToken(code)?.kind !== 'code') throw new InvalidGrantError('Invalid authorization code.');
      const row = await repo.findCode({ codeHash: hash(code), clientId: oauthClient.client_id });
      if (!row) throw new InvalidGrantError('Invalid authorization code.');
      if (row.usedAt) {
        // A code used twice: revoke what the first use issued (RFC 6749 §4.1.2).
        if (row.family) await revokeFamily(row.family, 'oauth', 'authorization code reused');
        await record({
          event: 'oauth.code_reuse',
          outcome: 'denied',
          user: row.user,
          token: row.family || undefined,
          detail: { client: oauthClient.client_id },
        });
        throw new InvalidGrantError('This authorization code was already used.');
      }
      if (row.expiresAt < new Date(now())) throw new InvalidGrantError('The authorization code has expired.');
      return row.codeChallenge;
    },

    async exchangeAuthorizationCode(oauthClient, code, _verifier, redirectUri, resource) {
      checkResource(resource);
      const s = await available();
      const row = await repo.consumeCode({ codeHash: hash(code), clientId: oauthClient.client_id }, new Date(now()));
      if (!row) throw new InvalidGrantError('The authorization code is invalid, expired or already used.');
      if (redirectUri && redirectUri !== row.redirectUri)
        throw new InvalidGrantError('redirect_uri does not match the authorization request.');
      if (!redirectAllowed(row.redirectUri, s))
        throw new InvalidGrantError('This app is no longer allowed to connect.');
      const user = await liveOwner({ user: row.user }, s);
      const scopes = grantScopes(row.scopes, user);
      if (!scopes.length) throw new InvalidGrantError('The account has no permissions this connection can use.');
      if (!(row.approvalEndsAt > new Date(now())))
        throw new InvalidGrantError('The approval has ended. Connect the app again.');
      const issued = await issueTokens({
        oauthClient,
        user,
        scopes,
        resource: row.resource,
        approvalEndsAt: row.approvalEndsAt,
      });
      await repo.setCodeFamily(row._id, issued.family);
      await record({
        event: 'oauth.token',
        outcome: 'ok',
        user: user._id,
        userEmail: user.email,
        token: issued.family,
        detail: {
          client: oauthClient.client_id,
          name: appName(oauthClient),
          scopes,
          approvalEndsAt: row.approvalEndsAt,
        },
      });
      return issued.tokens;
    },

    async exchangeRefreshToken(oauthClient, refreshToken, requestedScopes, resource) {
      checkResource(resource);
      if (parseToken(refreshToken)?.kind !== 'refresh') throw new InvalidGrantError('Invalid refresh token.');
      const at = now();
      const row = await repo.rotateRefreshToken(
        {
          tokenHash: hash(refreshToken),
          kind: 'refresh',
          clientId: oauthClient.client_id,
          revokedAt: null,
          expiresAt: { $gt: new Date(at) },
        },
        new Date(at),
      );
      if (!row) {
        const old = await repo.findToken({ tokenHash: hash(refreshToken), kind: 'refresh' });
        if (old && old.clientId === oauthClient.client_id && old.revokedBy === 'rotation') {
          if (old.rotatedAt && at - new Date(old.rotatedAt).getTime() < config.oauth.refreshGraceMs)
            throw new InvalidGrantError('This refresh token was just used; use the newest one.');
          // An old refresh token came back: someone else may hold it. End the connection.
          await revokeFamily(old.family, 'oauth', 'refresh token reused');
          await record({
            event: 'oauth.refresh_reuse',
            outcome: 'denied',
            user: old.user,
            token: old.family,
            detail: { client: oauthClient.client_id },
          });
        }
        throw new InvalidGrantError('Invalid refresh token.');
      }
      if (resource && row.resource && resource.href !== row.resource)
        throw new InvalidGrantError('resource does not match the original grant.');
      if (!(row.approvalEndsAt > new Date(at))) {
        await revokeFamily(row.family, 'oauth', 'approval ended');
        throw new InvalidGrantError('The approval has ended. Connect the app again.');
      }
      const s = await available();
      if (!redirectAllowed((await repo.findClient(row.clientId))?.redirectUris?.[0] || '', s))
        throw new InvalidGrantError('This app is no longer allowed to connect.');
      let user;
      try {
        user = await liveOwner(row, s);
      } catch (error) {
        await revokeFamily(row.family, 'oauth', 'owner no longer eligible');
        throw error;
      }
      // Retire the previous access token too, then narrow to what is still allowed (and requested).
      await repo.revokeTokens({ family: row.family, kind: 'access' }, new Date(at), 'rotation', 'rotated');
      const scopes = grantScopes(requestedScopes && requestedScopes.length ? requestedScopes : row.scopes, user).filter(
        (scope) => row.scopes.includes(scope),
      );
      if (!scopes.length) throw new InvalidGrantError('The account has no permissions this connection can use.');
      const issued = await issueTokens({
        oauthClient,
        user,
        scopes,
        resource: row.resource,
        approvalEndsAt: row.approvalEndsAt,
        family: row.family,
      });
      await record({
        event: 'oauth.refresh',
        outcome: 'ok',
        user: user._id,
        userEmail: user.email,
        token: row.family,
        detail: { client: oauthClient.client_id },
      });
      return issued.tokens;
    },

    async verifyAccessToken(token) {
      if (parseToken(token)?.kind !== 'access') throw new InvalidTokenError('Invalid token.');
      const row = await repo.findToken({ tokenHash: hash(token), kind: 'access', revokedAt: null });
      if (!row) throw new InvalidTokenError('Access token is invalid or revoked.');
      const at = new Date(now());
      if (row.expiresAt < at) throw new InvalidTokenError('Access token has expired.');
      if (row.approvalEndsAt < at) throw new InvalidTokenError('The approval has ended; sign in again.');
      const s = await settings.get();
      if (s.mode === 'off') throw new InvalidTokenError('The AI connector is switched off.');
      let user;
      try {
        user = await liveOwner(row, s);
      } catch (error) {
        throw new InvalidTokenError(error.message);
      }
      const live = new Set(allowedScopes(user));
      repo.touchToken(row._id, at).catch(() => {});
      return {
        token,
        clientId: row.clientId,
        scopes: row.scopes.filter((scope) => live.has(scope)),
        expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
        resource: row.resource ? new URL(row.resource) : undefined,
        extra: {
          user: {
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            permissions: user.permissions || [],
          },
          family: row.family,
          connection: {
            clientName: row.clientName,
            approvalEndsAt: row.approvalEndsAt,
            accessExpiresAt: row.expiresAt,
          },
        },
      };
    },

    // RFC 7009: the answer is the same whether or not the token existed.
    async revokeToken(oauthClient, { token }) {
      const kind = parseToken(token)?.kind;
      if (kind !== 'access' && kind !== 'refresh') return;
      const row = await repo.findToken({ tokenHash: hash(token), clientId: oauthClient.client_id });
      if (!row || row.revokedAt) return;
      await revokeFamily(row.family, `oauth:${oauthClient.client_id}`, 'revoked by the app');
      await record({
        event: 'token.revoke',
        outcome: 'ok',
        user: row.user,
        token: row.family,
        detail: { client: oauthClient.client_id, by: 'app' },
      });
    },
  };

  const handleLogin = createLoginHandler({ config, settings, record, now, hash, clientsStore });

  return { provider, handleLogin, hash, revokeFamily };
}

module.exports = { createOAuthProvider, renderLoginPage, parseToken, appName };
