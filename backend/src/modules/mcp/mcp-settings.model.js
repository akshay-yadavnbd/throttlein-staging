/**
 * Superadmin-controlled settings for the MCP connector — one document, key
 * "global". Its absence means mode "off": nothing connects until a superadmin
 * turns the connector on (fail closed). Env (MCP_MAX_MODE, MCP_* limits) is
 * the ceiling; values here can only lower it. See src/mcp/settings.js.
 */
const mongoose = require('mongoose');

const mcpSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global', immutable: true },
    mode: { type: String, enum: ['off', 'read'], default: 'off' },
    /** Staff who may connect. Superadmins are always allowed while the mode is on. */
    allowedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    disabledTools: { type: [String], default: [] },
    /** Lets connections holding contact:read ask for unmasked contact details. */
    allowContactReveal: { type: Boolean, default: false },
    limits: {
      tokenPerMinute: Number,
      userPerMinute: Number,
      dailyRecords: Number,
      concurrent: Number,
      responseBytes: Number,
      pageSize: Number,
    },
    /** Absent means on (the mode still decides). */
    allowOAuth: Boolean,
    /** AI apps by redirect address: presets (absent means on) and custom origins. */
    oauthApps: { claude: Boolean, local: Boolean },
    allowedRedirectOrigins: { type: [String], default: [] },
    /** Days an approval lasts before the person signs in again (default 7, capped by env). */
    oauthApprovalDays: Number,
    modifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    /** Human-readable history of changes, newest last (capped). */
    logs: { type: [String], default: [] },
  },
  { timestamps: true, collection: 'mcp_settings' },
);

module.exports = /** @type {mongoose.Model<any>} */ (
  mongoose.models.McpSettings || mongoose.model('McpSettings', mcpSettingsSchema)
);
