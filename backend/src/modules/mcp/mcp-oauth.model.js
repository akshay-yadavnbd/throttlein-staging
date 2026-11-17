/**
 * Storage for the MCP OAuth authorization server (src/mcp/oauth.js).
 *
 * Three collections: dynamically registered AI apps (claude.ai, Claude Code,
 * …), short-lived authorization codes, and access/refresh tokens. Codes and
 * tokens are stored as keyed HMACs (MCP_MASTER_KEY → token sub-key), so a
 * database read never yields a usable credential, and they expire via TTL
 * indexes so nothing accumulates.
 *
 * Every app is a public client (PKCE + exact redirect prove it), so no client
 * secret is issued or stored.
 */
const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true },
    clientIdIssuedAt: { type: Number, required: true },
    clientName: { type: String, default: '' },
    clientUri: { type: String, default: '' },
    redirectUris: { type: [String], required: true },
    softwareId: String,
    softwareVersion: String,
    lastUsedAt: Date,
  },
  { timestamps: true, collection: 'mcp_oauth_clients' },
);

const codeSchema = new mongoose.Schema(
  {
    codeHash: { type: String, required: true, unique: true },
    clientId: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    scopes: { type: [String], required: true },
    codeChallenge: { type: String, required: true },
    redirectUri: { type: String, required: true },
    resource: { type: String, default: '' },
    /** When the person must sign in again; copied onto the tokens this code issues. */
    approvalEndsAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    /** The token family the first use issued, so a replayed code can revoke it. */
    family: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'mcp_oauth_codes' },
);
codeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });

const tokenSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    kind: { type: String, enum: ['access', 'refresh'], required: true },
    clientId: { type: String, required: true, index: true },
    clientName: { type: String, default: '' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    scopes: { type: [String], required: true },
    /** User.tokenVersion at issue time — a password change invalidates the connection. */
    tokenVersion: { type: Number, default: 0 },
    /** One connection = one family (a sign-in and every rotation after it). */
    family: { type: String, required: true, index: true },
    resource: { type: String, default: '' },
    approvalEndsAt: { type: Date, required: true },
    rotatedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: String, default: '' },
    revokeReason: { type: String, default: '' },
    lastUsedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'mcp_oauth_tokens' },
);
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86400 });

module.exports = {
  McpOAuthClient: /** @type {mongoose.Model<any>} */ (
    mongoose.models.McpOAuthClient || mongoose.model('McpOAuthClient', clientSchema)
  ),
  McpOAuthCode: /** @type {mongoose.Model<any>} */ (
    mongoose.models.McpOAuthCode || mongoose.model('McpOAuthCode', codeSchema)
  ),
  McpOAuthToken: /** @type {mongoose.Model<any>} */ (
    mongoose.models.McpOAuthToken || mongoose.model('McpOAuthToken', tokenSchema)
  ),
};
