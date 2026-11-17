/**
 * The MCP connector's own audit trail (collection mcp_audit).
 *
 * Every tool call, sign-in, token issue/refresh/revoke and settings change
 * becomes one row with a monotonic `seq` (from the shared Counter) and an HMAC
 * over its canonical form, so edits and deletions are detectable
 * (`tin_ops_audit_verify`). Arguments are stored as a keyed MAC plus a summary
 * of values a tool declared safe — never the raw values, which may be customer
 * emails. Nothing in the app updates or deletes these rows; there is no TTL.
 */
const mongoose = require('mongoose');

const mcpAuditLogSchema = new mongoose.Schema(
  {
    seq: { type: Number, required: true, unique: true },
    at: { type: Date, required: true },
    /** e.g. tool.call, oauth.signin, oauth.token, oauth.refresh_reuse, settings.change, token.revoke */
    event: { type: String, required: true, index: true },
    outcome: { type: String, required: true },
    code: String,
    requestId: String,
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    userEmail: String,
    token: String,
    tool: { type: String, index: true },
    argsMac: String,
    argsSummary: mongoose.Schema.Types.Mixed,
    detail: mongoose.Schema.Types.Mixed,
    records: Number,
    bytes: Number,
    durationMs: Number,
    ip: String,
    client: String,
    mac: { type: String, required: true },
    // minimize:false — an empty argsSummary {} must survive the round trip or the row's MAC no longer verifies.
  },
  { collection: 'mcp_audit', versionKey: false, minimize: false },
);

mcpAuditLogSchema.index({ at: -1 });
mcpAuditLogSchema.index({ user: 1, at: -1 });

module.exports = /** @type {mongoose.Model<any>} */ (
  mongoose.models.McpAuditLog || mongoose.model('McpAuditLog', mcpAuditLogSchema)
);
