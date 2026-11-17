/**
 * App assembly — middleware order, CORS, parsers, the MCP connector and the
 * /api router. No listening here: src/index.js owns the process lifecycle
 * and tests build the app directly (`createApp()`).
 *
 * Order: request id → access log → security headers → CORS → raw-body
 * webhook → MCP (own parsers) → JSON / urlencoded → input validation →
 * static uploads → presigning → routes → 404 → global error layer.
 */
const path = require('path');
const express = require('express');
const cors = require('cors');

const { env } = require('./config/env');
const { logger } = require('./utils/logger');
const { requestId } = require('./middleware/requestId');
const { requestLogger } = require('./middleware/requestLogger');
const { validateRequest, securityHeaders } = require('./middleware/requestSecurity');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { createApiRouter } = require('./routes/api');

const BACKEND_ROOT = path.resolve(__dirname, '..');

/**
 * In development, accept any localhost/127.0.0.1 port.
 *
 * `next dev` walks to the next free port when its default is taken, so the
 * frontend routinely comes up on 3002, 4002, … while the allow-list only
 * names 3000/3001. A blocked preflight fails before any route runs — the
 * client sees status 0 with no body — so pinning one extra port just moves
 * the problem. Production stays strict: exact matches from env only.
 */
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// OAuth protocol endpoints for MCP clients are called cross-origin by design
// (no cookies); the MCP SDK applies its own permissive CORS to them, so the
// app's allow-list must not reject them first.
const MCP_OAUTH_PATH = /^\/(\.well-known\/oauth-|authorize\/?$|token\/?$|register\/?$|revoke\/?$)/;

function allowedOrigins() {
  return [
    env.ADMIN_ORIGIN || 'http://localhost:3001',
    env.FRONTEND_ORIGIN || 'http://localhost:3000',
    // Seller subdomain (e.g. https://seller.throttlein.com) — same Next app
    // as the storefront, but the browser sends it as its own origin.
    ...(env.SELLER_ORIGIN ? [env.SELLER_ORIGIN] : []),
    // The API's own origin: the MCP sign-in page is served here and its form
    // posts back here, and browsers attach Origin to that same-origin POST.
    ...(() => {
      try {
        return env.MCP_ISSUER_URL ? [new URL(env.MCP_ISSUER_URL).origin] : [];
      } catch {
        return [];
      }
    })(),
  ];
}

function buildCors() {
  const allowed = allowedOrigins();
  const isAllowed = (origin) => allowed.includes(origin) || (!env.isProduction && LOCALHOST_ORIGIN.test(origin));
  return cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // Postman / curl / server-to-server
      if (isAllowed(origin)) return cb(null, true);
      // Log it — a blocked preflight is otherwise invisible on both sides.
      logger.warn({ origin }, 'cors: blocked origin');
      return cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    // Listed explicitly rather than reflecting Access-Control-Request-Headers.
    // The two X-*Site headers carry the multi-site scope (middleware/
    // resolveSite.js); if a proxy strips either, the admin panel silently
    // falls back to the main site — so the dependency is visible here.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Admin-Site',
      'X-Site',
      'Idempotency-Key',
      // Browser-based MCP clients (e.g. MCP Inspector) send these on /mcp.
      'Mcp-Session-Id',
      'Mcp-Protocol-Version',
      'Last-Event-ID',
    ],
    // Content-Disposition carries the invoice PDF's filename to the storefront.
    exposedHeaders: ['Mcp-Session-Id', 'Content-Disposition'],
  });
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Trust only explicitly configured reverse proxies, never arbitrary forwarded headers.
  if (env.TRUST_PROXY)
    app.set(
      'trust proxy',
      env.TRUST_PROXY.split(',').map((s) => s.trim()),
    );

  // One id per request: on the X-Request-Id header, every error envelope and
  // every log line. The access line is written when the response finishes.
  app.use(requestId);
  app.use(requestLogger);
  app.use(securityHeaders);

  const appCors = buildCors();
  app.use((req, res, next) => (MCP_OAUTH_PATH.test(req.path) ? next() : appCors(req, res, next)));

  // Shipment webhook: authenticate and parse under its own small cap BEFORE
  // the global parser, so an unauthenticated caller never gets 10 MB parsed.
  const { authenticateShipmentWebhook, shipmentWebhookLimit } = require('./middleware/shipmentWebhookSecurity');
  app.post(
    '/api/hooks/tin-shipment',
    shipmentWebhookLimit,
    authenticateShipmentWebhook,
    express.json({ limit: '256kb' }),
  );

  // MCP endpoint for claude.ai / Claude Code / Claude Desktop (docs/mcp-server.md):
  // OAuth discovery + endpoints at the root, the MCP server at /mcp. Mounted
  // before the global JSON parser (the handlers parse their own bodies and
  // check the bearer token first) and before validateRequest, which would
  // reject JSON-RPC `_meta` keys (reverse-DNS names containing dots).
  const { createMcp, getConfig: getMcpConfig } = require('./modules/mcp');
  let mcp = null;
  if (getMcpConfig().enabled) {
    mcp = createMcp();
    app.use(mcp.authRouter);
    app.use('/mcp', mcp.mcpRouter);
  } else {
    logger.warn({ problems: getMcpConfig().problems }, 'mcp: disabled');
  }
  app.locals.mcp = mcp;

  app.use(
    express.json({
      limit: '10mb',
      // Keep the raw request bytes for webhook signature verification (the
      // Razorpay signature is an HMAC of the exact body — a re-serialized
      // JSON.parse() output would not match). See orderController.razorpayWebhook.
      verify: (req, _res, buf) => {
        /** @type {import('express').Request} */ (req).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '1mb', parameterLimit: 1000 }));
  app.use(validateRequest);

  // Static — uploaded product images (disk mode only; in S3 mode the presign
  // middleware below rewrites image fields to presigned S3 URLs). Disk mode
  // stores every upload flat in one folder, private documents (KYC PDFs)
  // included, so the public mount refuses everything that is not image/video.
  const { guardPublicDisk } = require('./utils/privateFiles');
  app.use(
    '/uploads',
    guardPublicDisk,
    express.static(path.join(BACKEND_ROOT, env.UPLOAD_DIR || 'uploads'), { dotfiles: 'deny' }),
  );

  // Walk every res.json payload and replace S3 keys with presigned URLs, so
  // no controller needs its own serializer. Private disk references also
  // receive expiring links.
  app.use(require('./middleware/presignResponseImages'));

  app.use('/api', createApiRouter({ mcp }));

  // 404 + error handler (must be last)
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
