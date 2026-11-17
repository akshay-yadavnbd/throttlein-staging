/**
 * MCP (Model Context Protocol) connector — lets claude.ai, Claude Code and
 * Claude Desktop query production operations data with the tools in
 * ./tools.js, signed in as a staff member (./oauth.js), within the limits a
 * superadmin sets (./settings.js), with every call recorded (./audit.js).
 *
 * Two routers, created by `createMcp()`:
 *   authRouter — OAuth discovery + endpoints at the API root
 *     (/.well-known/…, /authorize, /token, /register, /revoke), from the SDK.
 *   mcpRouter  — mounted at /mcp: the sign-in form target (/mcp/oauth/login)
 *     and the bearer-protected MCP endpoint itself.
 * Plus `manage` (./manage.js) for the admin API under /api/admin/mcp.
 *
 * Transport is Streamable HTTP in stateless mode with JSON responses: every
 * POST gets its own McpServer built for the token's person and scopes. Host
 * and Origin are checked against the issuer (DNS-rebinding defence). Both
 * routers are mounted in src/app.js BEFORE the global JSON parser and
 * validateRequest: the handlers parse their own bodies, and JSON-RPC `_meta`
 * keys use reverse-DNS names with dots, which validateRequest rejects.
 */
'use strict';
const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} = require('@modelcontextprotocol/sdk/server/auth/router.js');
const { requireBearerAuth } = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
const rateLimit = require('../../middleware/rateLimit');
const { getConfig } = require('./config');
const { createSettingsProvider } = require('./settings');
const { createAudit } = require('./audit');
const { createOAuthProvider } = require('./oauth');
const { buildServer, newRequestId } = require('./runtime');
const { createManage } = require('./manage');
const { ALL_SCOPES } = require('./scopes');
const { tools } = require('./tools');
const { logger } = require('../../utils/logger');

const rpcError = (code, message) => ({ jsonrpc: '2.0', error: { code, message }, id: null });
const pass = (_req, _res, next) => next();

function createMcp({ config = getConfig(), limiters = {} } = {}) {
  if (!config.enabled) throw new Error(`MCP connector is not configured: ${config.problems.join('; ')}`);
  const settings = createSettingsProvider({ config });
  const audit = createAudit({ keys: config.keys });
  const { provider, handleLogin, revokeFamily } = createOAuthProvider({ config, settings, audit });
  const manage = createManage({ config, settings, audit, revokeFamily });
  const limiter = (name, max, window) =>
    limiters[name] === false ? pass : limiters[name] || rateLimit({ name, max, window });
  const allowedHosts = [config.issuer.host, `localhost:${config.port}`, `127.0.0.1:${config.port}`];
  const allowedOrigins = [config.issuer.origin, config.adminOrigin];

  const authRouter = express.Router();
  authRouter.use(['/authorize', '/token', '/register', '/revoke'], limiter('mcp-oauth', 60, 900));
  authRouter.use(
    mcpAuthRouter({
      provider,
      issuerUrl: config.issuer,
      resourceServerUrl: config.resource,
      resourceName: 'Throttlein',
      scopesSupported: [...ALL_SCOPES],
      authorizationOptions: { rateLimit: false },
      tokenOptions: { rateLimit: false },
      revocationOptions: { rateLimit: false },
      clientRegistrationOptions: { rateLimit: false, clientSecretExpirySeconds: 0 },
    }),
  );

  async function handleMcpPost(req, res) {
    const auth = req.auth;
    const s = await settings.get();
    const principal = {
      user: auth.extra.user,
      scopes: auth.scopes,
      family: auth.extra.family,
      connection: auth.extra.connection,
    };
    const request = {
      id: newRequestId(),
      ip: req.ip || '',
      client: String(req.headers['user-agent'] || '').slice(0, 120),
    };
    const server = buildServer({ principal, settings: s, config, audit, request });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts,
      allowedOrigins,
    });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error({ err: error }, `[mcp] request failed (${request.id}):`);
      if (!res.headersSent) res.status(500).json(rpcError(-32603, `Internal server error. Reference: ${request.id}`));
    }
  }
  const methodNotAllowed = (_req, res) => {
    res.set('Allow', 'POST');
    res.status(405).json(rpcError(-32000, 'Method not allowed. This MCP endpoint is stateless and accepts POST only.'));
  };

  // Access lines come from the global requestLogger (src/app.js) — one format for every route.
  const mcpRouter = express.Router();
  mcpRouter.post(
    '/oauth/login',
    limiter('mcp-login', 20, 900),
    express.urlencoded({ extended: false, limit: '16kb' }),
    (req, res, next) => handleLogin(req, res).catch(next),
  );
  mcpRouter.use(
    limiter('mcp', config.limits.userPerMinute, 60),
    // The resource indicator is checked at issue time when a client sends one; not every client does, so it is not required here.
    requireBearerAuth({
      verifier: provider,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(config.resource),
    }),
    express.json({ limit: '1mb' }),
  );
  mcpRouter.post('/', handleMcpPost);
  mcpRouter.get('/', methodNotAllowed);
  mcpRouter.delete('/', methodNotAllowed);

  return { config, settings, audit, provider, authRouter, mcpRouter, manage, tools };
}

module.exports = { createMcp, getConfig };
