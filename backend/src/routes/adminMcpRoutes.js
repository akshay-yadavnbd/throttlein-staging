/**
 * /api/admin/mcp — managing the AI connector from the admin panel.
 * Behind the normal admin JWT (`protect`); an MCP access token is not a JWT,
 * so an AI connection can never manage the connector. Rules live in
 * src/mcp/manage.js. When the connector is not configured on the server,
 * every call answers 503.
 */
const express = require('express');
const asyncHandler = require('express-async-handler');
const { protect, requireRole } = require('../middleware/auth');
const { AppError } = require('../errors/AppError');
const { sendData } = require('../utils/apiResponse');
const { validate } = require('../middleware/validate');
const G = require('../validation/generic');

module.exports = function createAdminMcpRoutes(mcp) {
  const router = express.Router();
  router.use(protect, requireRole('superadmin', 'staff'));
  if (!mcp) {
    router.use((_req, _res, next) =>
      next(
        new AppError(
          'MCP_NOT_CONFIGURED',
          'The AI connector is not configured on this server (MCP_ISSUER_URL / MCP_MASTER_KEY).',
          undefined,
          { status: 503 },
        ),
      ),
    );
    return router;
  }
  const { manage } = mcp;
  const wrap = (fn) =>
    asyncHandler(async (req, res) => {
      try {
        // `{ data }` envelope; every manage.* call returns an object.
        sendData(res, (await fn(req)) ?? {});
      } catch (error) {
        // A ManageError carries its own code and status; the error layer writes the envelope.
        if (error instanceof manage.ManageError)
          throw new AppError(error.code, error.message, undefined, { status: error.status });
        throw error;
      }
    });

  router.get(
    '/me',
    validate({ query: G.listQuery }),
    wrap((req) => manage.me(req)),
  );
  router.get(
    '/me/activity',
    validate({ query: G.listQuery }),
    wrap(async (req) => ({ rows: await manage.myActivity(req, req.query) })),
  );
  router.delete(
    '/me/connections/:id',
    validate({ params: G.params({ id: 'text' }) }),
    wrap(async (req) => {
      await manage.revokeOwn(req, req.params.id);
      return { revoked: req.params.id };
    }),
  );

  router.get(
    '/settings',
    validate({ query: G.listQuery }),
    wrap((req) => manage.getSettings(req)),
  );
  router.patch(
    '/settings',
    validate({ body: G.objectBody }),
    wrap((req) => manage.changeSettings(req, req.body)),
  );
  router.get(
    '/connections',
    validate({ query: G.listQuery }),
    wrap(async (req) => ({ connections: await manage.listConnections(req, req.query) })),
  );
  router.post(
    '/connections/:id/revoke',
    validate({ params: G.params({ id: 'text' }), body: G.objectBody }),
    wrap(async (req) => {
      await manage.revokeConnection(req, req.params.id);
      return { revoked: req.params.id };
    }),
  );
  router.post(
    '/revoke-all',
    validate({ body: G.objectBody }),
    wrap((req) => manage.revokeAll(req, req.body || {})),
  );
  router.get(
    '/activity',
    validate({ query: G.listQuery }),
    wrap((req) => manage.activity(req, req.query)),
  );
  router.get(
    '/activity/verify',
    validate({ query: G.listQuery }),
    wrap((req) => manage.verifyAudit(req, req.query.rows)),
  );
  return router;
};
