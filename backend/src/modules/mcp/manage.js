/**
 * Management of the connector from the admin panel (routes/adminMcpRoutes.js).
 *
 * Any active staff member sees their own standing (`me`): whether they may
 * connect, the scopes they would get, their live connections, how to connect.
 * Superadmins see and change the settings, every connection and the audit
 * trail. A change that WIDENS access (switching on, allowing a person,
 * allowing contact reveal, re-enabling a tool, raising a limit, allowing an
 * app, lengthening approvals) needs the superadmin's own password; narrowing
 * changes do not. The API decides: it answers 400 {code: "PASSWORD_REQUIRED"}
 * when the password is missing and 422 when it is wrong (the admin app treats
 * 403 as "no access"). Five wrong passwords lock confirmation for 15 minutes.
 * Every change is recorded in the audit trail with the person's name, and
 * takes effect within the settings cache window.
 */
'use strict';
const mongoose = require('mongoose');
const repo = require('./mcp.repository');
const { isUserAllowed } = require('./settings');
const { allowedScopes, SCOPE_LABELS } = require('./scopes');
const { tools } = require('./tools');

const { ManageError } = require('./manage-errors');
const { createSettingsAdmin } = require('./manage-settings');

function createManage({ config, settings, audit, revokeFamily }) {
  const record = (req, event, detail, outcome = 'ok') =>
    audit.tryRecord({
      event,
      outcome,
      user: req.user._id,
      userEmail: req.user.email,
      detail: { ...detail, via: 'admin-app' },
      ip: req.ip,
      client: String(req.headers['user-agent'] || '').slice(0, 120),
    });

  async function connectionsFor(filter) {
    const rows = await repo.connections(filter);
    const users = await repo.usersByIds(rows.map((r) => r.user));
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return rows.map((r) => {
      const u = byId.get(String(r.user));
      const ended = !r.active || new Date(r.approvalEndsAt) < new Date();
      return {
        id: r._id,
        user: u ? { id: String(u._id), name: u.name, email: u.email, role: u.role } : { id: String(r.user) },
        app: r.clientName || r.clientId,
        scopes: r.scopes,
        startedAt: r.createdAt,
        approvalEndsAt: r.approvalEndsAt,
        lastUsedAt: r.lastUsedAt || null,
        status: ended ? 'ended' : 'active',
        endedReason: !r.active ? r.revokeReason || 'revoked' : ended ? 'approval ended' : null,
      };
    });
  }

  async function me(req) {
    const s = await settings.get();
    const scopes = allowedScopes(req.user);
    return {
      connector: {
        mode: s.mode,
        ceiling: s.ceiling,
        endpoint: config.resource.href,
        oauthEnabled: s.allowOAuth,
        approvalDays: s.oauthApprovalDays,
      },
      allowed: isUserAllowed(s, req.user),
      reason:
        s.mode === 'off'
          ? 'The connector is switched off.'
          : isUserAllowed(s, req.user)
            ? null
            : 'You are not on the allow-list; ask a superadmin.',
      scopes: scopes.map((scope) => ({ scope, allows: SCOPE_LABELS[scope] })),
      tools: tools
        .filter((t) => scopes.includes(t.scope) && !s.disabledTools.includes(t.name))
        .map((t) => ({ name: t.name, title: t.title })),
      howToConnect: {
        claudeAi: `Settings → Connectors → Add custom connector → ${config.resource.href}`,
        claudeCode: `claude mcp add --transport http throttlein ${config.resource.href} --scope user   (then /mcp → Authenticate)`,
      },
      connections: await connectionsFor({ user: req.user._id }),
    };
  }

  async function revokeOwn(req, family) {
    const row = await repo.findToken({ family, user: req.user._id });
    if (!row) throw new ManageError(404, 'NOT_FOUND', 'No such connection.');
    await revokeFamily(family, `user:${req.user.email}`, 'revoked by the owner');
    await record(req, 'token.revoke', { connection: family, by: 'owner' });
  }

  async function myActivity(req, { limit = 50 } = {}) {
    const rows = await repo.auditRows({ user: req.user._id }, { limit: Math.min(Number(limit) || 50, 200) });
    return rows.map(activityRow);
  }

  const activityRow = (r) => ({
    seq: r.seq,
    at: r.at,
    event: r.event,
    outcome: r.outcome,
    code: r.code || null,
    user: r.userEmail || (r.user ? String(r.user) : null),
    tool: r.tool || null,
    args: r.argsSummary || null,
    detail: r.detail || null,
    records: r.records ?? null,
    durationMs: r.durationMs ?? null,
    client: r.client || null,
  });

  async function requireSuperadmin(req) {
    if (req.user.role !== 'superadmin') throw new ManageError(403, 'FORBIDDEN', 'Superadmin only.');
  }

  const { getSettings, changeSettings, confirmPassword } = createSettingsAdmin({
    config,
    settings,
    record,
    requireSuperadmin,
  });

  /**
   * @param {import('express').Request} req
   * @param {{ user?: string, status?: string }} [query]
   */
  async function listConnections(req, { user, status } = {}) {
    await requireSuperadmin(req);
    const filter = {};
    if (user) filter.user = userIdOrEmail(user);
    const rows = await connectionsFor(filter);
    return status ? rows.filter((r) => r.status === status) : rows;
  }
  const userIdOrEmail = (v) => (mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(v) : null);

  async function revokeConnection(req, family) {
    await requireSuperadmin(req);
    const row = await repo.findToken({ family });
    if (!row) throw new ManageError(404, 'NOT_FOUND', 'No such connection.');
    await revokeFamily(family, `superadmin:${req.user.email}`, 'revoked by a superadmin');
    await record(req, 'token.revoke', { connection: family, owner: String(row.user), by: 'superadmin' });
  }

  /**
   * @param {import('express').Request} req
   * @param {{ confirm?: string, password?: string, user?: string }} [body]
   */
  async function revokeAll(req, { confirm, password, user } = {}) {
    await requireSuperadmin(req);
    if (user) {
      const id = userIdOrEmail(user);
      if (!id) throw new ManageError(400, 'INVALID', 'Not a user id.');
      const r = await repo.revokeTokens(
        { user: id },
        new Date(),
        `superadmin:${req.user.email}`,
        'revoked by a superadmin',
      );
      await record(req, 'token.revoke', { owner: String(id), all: true, count: r.modifiedCount });
      return { revoked: r.modifiedCount };
    }
    if (confirm !== 'ALL')
      throw new ManageError(400, 'CONFIRM_REQUIRED', 'Send confirm: "ALL" to revoke every connection.');
    await confirmPassword(req, password);
    const r = await repo.revokeTokens({}, new Date(), `superadmin:${req.user.email}`, 'all connections revoked');
    await record(req, 'token.revoke', { all: true, count: r.modifiedCount });
    return { revoked: r.modifiedCount };
  }

  /**
   * @param {import('express').Request} req
   * @param {{ user?: string, tool?: string, event?: string, outcome?: string, limit?: number | string, before?: number | string }} [query]
   */
  async function activity(req, { user, tool, event, outcome, limit = 100, before } = {}) {
    await requireSuperadmin(req);
    const filter = {};
    if (user) {
      const id = userIdOrEmail(user);
      if (id) filter.user = id;
      else {
        const u = await repo.findUserByEmailLean(String(user).toLowerCase());
        filter.user = u?._id || new mongoose.Types.ObjectId();
      }
    }
    if (tool) filter.tool = String(tool);
    if (event) filter.event = String(event);
    if (outcome) filter.outcome = String(outcome);
    if (before) filter.seq = { $lt: Number(before) };
    const rows = await repo.auditRows(filter, { limit: Math.min(Number(limit) || 100, 500) });
    return { rows: rows.map(activityRow), nextBefore: rows.length ? rows[rows.length - 1].seq : null };
  }

  async function verifyAudit(req, rows = 1000) {
    await requireSuperadmin(req);
    const recent = await repo.recentAuditRows(Math.min(Number(rows) || 1000, 5000));
    return audit.verify(recent.reverse());
  }

  return {
    ManageError,
    me,
    revokeOwn,
    myActivity,
    getSettings,
    changeSettings,
    listConnections,
    revokeConnection,
    revokeAll,
    activity,
    verifyAudit,
  };
}

module.exports = { createManage, ManageError };
