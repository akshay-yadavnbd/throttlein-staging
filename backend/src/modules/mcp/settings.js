/**
 * Effective connector settings = the McpSettings document capped by the env
 * ceiling (config). No document, or a failed read, means mode "off".
 * Cached briefly so a superadmin's change takes effect within seconds without
 * a database read per tool call.
 */
'use strict';
const repo = require('./mcp.repository');
const { MODES } = require('./config');
const { isStaff } = require('./scopes');
const { logger } = require('../../utils/logger');

const LIMIT_KEYS = ['tokenPerMinute', 'userPerMinute', 'dailyRecords', 'concurrent', 'responseBytes', 'pageSize'];
const DEFAULT_APPROVAL_DAYS = 7;

/** AI apps are identified by where they ask to be redirected. */
const REDIRECT_PRESETS = Object.freeze({
  claude: { label: 'Claude (claude.ai, claude.com)', hosts: ['claude.ai', 'claude.com'], https: true },
  local: {
    label: 'Local apps on this computer (Claude Code, Cursor, Codex)',
    hosts: ['localhost', '127.0.0.1', '[::1]'],
    https: false,
  },
});

const rank = (mode) => MODES.indexOf(mode);
const minMode = (a, b) => (rank(a) <= rank(b) ? a : b);

function effectiveSettings(config, doc) {
  const dbMode = doc && MODES.includes(doc.mode) ? doc.mode : 'off';
  const limits = { ...config.limits };
  for (const key of LIMIT_KEYS) {
    const value = doc?.limits?.[key];
    if (Number.isInteger(value) && value > 0 && value < limits[key]) limits[key] = value;
  }
  return Object.freeze({
    mode: minMode(config.maxMode, dbMode),
    ceiling: config.maxMode,
    allowedUsers: Object.freeze((doc?.allowedUsers || []).map(String)),
    disabledTools: Object.freeze([...(doc?.disabledTools || [])]),
    allowContactReveal: doc?.allowContactReveal === true,
    limits: Object.freeze(limits),
    allowOAuth: doc?.allowOAuth !== false,
    oauthApps: Object.freeze(
      Object.fromEntries(Object.keys(REDIRECT_PRESETS).map((k) => [k, doc?.oauthApps?.[k] !== false])),
    ),
    customRedirects: Object.freeze([...(doc?.allowedRedirectOrigins || [])]),
    oauthApprovalDays: Math.min(
      Number.isInteger(doc?.oauthApprovalDays) && doc.oauthApprovalDays > 0
        ? doc.oauthApprovalDays
        : DEFAULT_APPROVAL_DAYS,
      config.oauth.maxApprovalDays,
    ),
    updatedAt: doc?.updatedAt || null,
  });
}

function redirectAllowed(uri, settings) {
  let url;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  for (const [key, preset] of Object.entries(REDIRECT_PRESETS)) {
    if (!settings.oauthApps[key]) continue;
    const hostOk = preset.hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
    const protocolOk = preset.https ? url.protocol === 'https:' : url.protocol === 'https:' || url.protocol === 'http:';
    if (hostOk && protocolOk) return true;
  }
  return settings.customRedirects.includes(url.origin);
}

/** Staff may connect while the mode is on; superadmins implicitly, staff via the allow-list. */
function isUserAllowed(settings, user) {
  if (settings.mode === 'off' || !isStaff(user)) return false;
  return user.role === 'superadmin' || settings.allowedUsers.includes(String(user._id));
}

/** @param {{ config?: any, loadDoc?: () => any, now?: () => number }} [deps] */
function createSettingsProvider({ config, loadDoc = repo.loadSettingsLean, now = Date.now } = {}) {
  let cached = null;
  let cachedAt = 0;
  return {
    async get() {
      if (cached && now() - cachedAt < config.settingsCacheMs) return cached;
      let doc = null;
      try {
        doc = await loadDoc();
      } catch (error) {
        logger.error({ err: error }, '[mcp] settings read failed; connector treated as off:');
      }
      cached = effectiveSettings(config, doc);
      cachedAt = now();
      return cached;
    },
    invalidate() {
      cached = null;
    },
  };
}

module.exports = {
  LIMIT_KEYS,
  DEFAULT_APPROVAL_DAYS,
  REDIRECT_PRESETS,
  effectiveSettings,
  redirectAllowed,
  isUserAllowed,
  createSettingsProvider,
};
