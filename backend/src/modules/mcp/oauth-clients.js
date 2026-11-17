/** Registered AI apps (OAuth clients): names, the SDK client shape, and the client store. */
'use strict';
const crypto = require('crypto');
const { InvalidClientMetadataError } = require('@modelcontextprotocol/sdk/server/auth/errors.js');
const repo = require('./mcp.repository');
const { ALL_SCOPES } = require('./scopes');
const { redirectAllowed } = require('./settings');
const { sanitizeText } = require('./output');

const MAX_REDIRECTS = 10;

/** The app's own name is untrusted text shown to staff. */
function appName(client) {
  const n = sanitizeText(client?.client_name || client?.clientName || '', 60)
    .replace(/[<>"'`]/g, '')
    .trim();
  if (n) return n;
  try {
    return new URL((client?.redirect_uris || client?.redirectUris || [])[0]).host || 'AI app';
  } catch {
    return 'AI app';
  }
}

/** Every app is a public client: PKCE and the exact redirect prove it; no secret exists. */
const sdkClient = (doc) => ({
  client_id: doc.clientId,
  client_id_issued_at: doc.clientIdIssuedAt,
  client_name: doc.clientName || undefined,
  client_uri: doc.clientUri || undefined,
  redirect_uris: doc.redirectUris,
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  scope: ALL_SCOPES.join(' '),
});

/** The SDK's client store over our collection; an app whose redirects are no longer allowed is invisible. */
function createClientsStore({ settings, record, now }) {
  const clientsStore = {
    async getClient(clientId) {
      if (typeof clientId !== 'string' || clientId.length > 100) return undefined;
      const doc = await repo.findClient(clientId);
      if (!doc) return undefined;
      // An app whose addresses are no longer allowed cannot sign in or refresh.
      const s = await settings.get();
      if (!doc.redirectUris.every((u) => redirectAllowed(u, s))) return undefined;
      return sdkClient(doc);
    },
    async registerClient(metadata) {
      const s = await settings.get();
      if (s.mode === 'off' || !s.allowOAuth)
        throw new InvalidClientMetadataError('Signing in with an AI app is switched off.');
      const redirectUris = [...new Set(metadata.redirect_uris || [])];
      if (!redirectUris.length || redirectUris.length > MAX_REDIRECTS)
        throw new InvalidClientMetadataError(`Register 1..${MAX_REDIRECTS} redirect addresses.`);
      const refused = redirectUris.filter((u) => !redirectAllowed(u, s));
      if (refused.length) {
        await record({
          event: 'oauth.register',
          outcome: 'denied',
          code: 'APP_NOT_ALLOWED',
          detail: { name: appName(metadata), redirects: refused.slice(0, 3) },
        });
        throw new InvalidClientMetadataError(
          `This app is not allowed to connect to Throttlein (redirect ${refused[0]}). Ask a superadmin to allow it.`,
        );
      }
      const doc = await repo.createClient({
        clientId: crypto.randomUUID(),
        clientIdIssuedAt: Math.floor(now() / 1000),
        clientName: appName(metadata),
        clientUri:
          typeof metadata.client_uri === 'string' && /^https?:\/\//.test(metadata.client_uri)
            ? metadata.client_uri.slice(0, 200)
            : '',
        redirectUris,
        softwareId: typeof metadata.software_id === 'string' ? metadata.software_id.slice(0, 100) : undefined,
        softwareVersion:
          typeof metadata.software_version === 'string' ? metadata.software_version.slice(0, 40) : undefined,
      });
      await record({
        event: 'oauth.register',
        outcome: 'ok',
        detail: { client: doc.clientId, name: doc.clientName, redirects: redirectUris.slice(0, 3) },
      });
      return sdkClient(doc.toObject());
    },
  };
  return clientsStore;
}

module.exports = { appName, sdkClient, createClientsStore };
