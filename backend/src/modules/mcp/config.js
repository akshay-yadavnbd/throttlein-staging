/**
 * Environment for the MCP connector. Parsed once, validated, frozen.
 *
 * Env only sets ceilings and addresses; anything a superadmin may change at
 * runtime lives in McpSettings (./settings.js). A bad or missing value does
 * not stop the API — the connector reports itself disabled with the reasons
 * (src/app.js logs them) and every MCP route answers 503.
 *
 * One secret, MCP_MASTER_KEY (≥ 32 random bytes, hex or base64). HKDF derives
 * independent sub-keys per purpose so a token hash can never be confused with
 * an audit MAC or a cursor signature. Rotating it revokes every connection.
 */
'use strict';
const { hkdfSync } = require('crypto');

const MODES = Object.freeze(['off', 'read']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function intIn(raw, fallback, min, max, name) {
  const n = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  return n;
}

function decodeMasterKey(raw) {
  if (!raw)
    throw new Error(
      "MCP_MASTER_KEY is not set (node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")",
    );
  const value = String(raw).trim();
  const buf =
    /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0 ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (buf.length < 32) throw new Error('MCP_MASTER_KEY must decode to at least 32 bytes');
  if (new Set(buf).size < 8) throw new Error('MCP_MASTER_KEY looks non-random');
  return buf;
}

function deriveKeys(master) {
  const derive = (label) => Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `throttlein-mcp:${label}`, 32));
  return Object.freeze({
    token: derive('token'),
    audit: derive('audit'),
    cursor: derive('cursor'),
    args: derive('args'),
    login: derive('login'),
  });
}

function parseIssuer(raw, isProd, port) {
  if (!raw) {
    if (isProd) throw new Error('MCP_ISSUER_URL is not set (the public https origin, e.g. https://api.throttlein.com)');
    return new URL(`http://localhost:${port}/`);
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('MCP_ISSUER_URL is not a valid URL');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname)))
    throw new Error('MCP_ISSUER_URL must be https (http only on localhost)');
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== ''))
    throw new Error('MCP_ISSUER_URL must be an origin only, without path, query or credentials');
  return new URL(`${url.origin}/`);
}

// Defaults to the validated configuration; tests pass their own object.
function loadConfig(env = require('../../config/env').env) {
  const problems = [];
  const attempt = (fn) => {
    try {
      return fn();
    } catch (error) {
      problems.push(error.message);
      return null;
    }
  };
  const isProd = env.NODE_ENV === 'production';
  const port = Number(env.PORT) || 5000;
  const issuer = attempt(() => parseIssuer(env.MCP_ISSUER_URL, isProd, port));
  const keys = attempt(() => deriveKeys(decodeMasterKey(env.MCP_MASTER_KEY)));
  const maxMode = String(env.MCP_MAX_MODE || 'read').trim();
  if (!MODES.includes(maxMode)) problems.push(`MCP_MAX_MODE must be one of ${MODES.join('|')}`);
  const limits = attempt(() =>
    Object.freeze({
      tokenPerMinute: intIn(env.MCP_RATE_PER_MIN, 60, 1, 1000, 'MCP_RATE_PER_MIN'),
      userPerMinute: intIn(env.MCP_USER_RATE_PER_MIN, 120, 1, 2000, 'MCP_USER_RATE_PER_MIN'),
      dailyRecords: intIn(env.MCP_DAILY_RECORDS, 5000, 1, 1000000, 'MCP_DAILY_RECORDS'),
      concurrent: intIn(env.MCP_MAX_CONCURRENT, 4, 1, 32, 'MCP_MAX_CONCURRENT'),
      responseBytes: intIn(env.MCP_MAX_RESPONSE_BYTES, 65536, 4096, 1048576, 'MCP_MAX_RESPONSE_BYTES'),
      pageSize: intIn(env.MCP_MAX_PAGE_SIZE, 50, 1, 200, 'MCP_MAX_PAGE_SIZE'),
      toolTimeoutMs: intIn(env.MCP_TOOL_TIMEOUT_MS, 15000, 1000, 60000, 'MCP_TOOL_TIMEOUT_MS'),
      loginFailures: intIn(env.MCP_LOGIN_FAILURES, 5, 3, 100, 'MCP_LOGIN_FAILURES'),
      loginLockoutSeconds: intIn(env.MCP_LOGIN_LOCKOUT_SECONDS, 900, 60, 86400, 'MCP_LOGIN_LOCKOUT_SECONDS'),
    }),
  );
  const oauth = attempt(() =>
    Object.freeze({
      accessTtlSeconds: intIn(env.MCP_OAUTH_ACCESS_SECONDS, 3600, 300, 86400, 'MCP_OAUTH_ACCESS_SECONDS'),
      maxApprovalDays: intIn(env.MCP_OAUTH_MAX_DAYS, 30, 1, 90, 'MCP_OAUTH_MAX_DAYS'),
      codeTtlMs: 10 * 60 * 1000,
      loginFormTtl: '10m',
      refreshGraceMs: 10 * 1000,
    }),
  );
  const settingsCacheMs = intIn(env.MCP_SETTINGS_CACHE_MS, 15000, 0, 300000, 'MCP_SETTINGS_CACHE_MS');

  return Object.freeze({
    enabled: problems.length === 0,
    problems: Object.freeze(problems),
    isProd,
    port,
    issuer,
    resource: issuer ? new URL('mcp', issuer) : null,
    maxMode: MODES.includes(maxMode) ? maxMode : 'off',
    keys,
    limits,
    oauth,
    settingsCacheMs,
    adminOrigin: env.ADMIN_ORIGIN || 'http://localhost:3001',
  });
}

let cached = null;
const getConfig = () => {
  if (!cached) cached = loadConfig();
  return cached;
};
const resetConfig = () => {
  cached = null;
};

module.exports = { MODES, loadConfig, getConfig, resetConfig };
