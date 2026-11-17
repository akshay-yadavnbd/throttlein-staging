/**
 * The superadmin MCP settings screen: read the effective settings, and change them — a change
 * that widens access (more users, tools, apps or contact reveal) needs the password again.
 */
const mongoose = require('mongoose');
const repo = require('./mcp.repository');
const { LIMIT_KEYS, REDIRECT_PRESETS, DEFAULT_APPROVAL_DAYS } = require('./settings');
const { allowedScopes, isStaff } = require('./scopes');
const { tools } = require('./tools');
const limits = require('./limits');
const { ManageError } = require('./manage-errors');

const MAX_LOGS = 200;

function createSettingsAdmin({ config, settings, record, requireSuperadmin }) {
  async function getSettings(req) {
    await requireSuperadmin(req);
    const doc = await repo.loadSettingsLean();
    const s = await settings.get();
    const people = await repo.adminsAndStaff();
    const named = (ids) =>
      (ids || []).map(String).map((id) => {
        const u = people.find((p) => String(p._id) === id);
        return u ? { id, name: u.name, email: u.email } : { id, name: '(removed)', email: '' };
      });
    const apps = await repo.recentClients();
    return {
      effective: s,
      stored: doc
        ? {
            mode: doc.mode,
            allowedUsers: named(doc.allowedUsers),
            disabledTools: doc.disabledTools,
            allowContactReveal: doc.allowContactReveal,
            limits: doc.limits || {},
            allowOAuth: doc.allowOAuth !== false,
            oauthApps: doc.oauthApps || {},
            allowedRedirectOrigins: doc.allowedRedirectOrigins || [],
            oauthApprovalDays: doc.oauthApprovalDays || DEFAULT_APPROVAL_DAYS,
            updatedAt: doc.updatedAt,
            logs: (doc.logs || []).slice(-50),
          }
        : null,
      ceilings: { maxMode: config.maxMode, limits: config.limits, maxApprovalDays: config.oauth.maxApprovalDays },
      staff: people
        .filter((p) => p.status !== 'suspended')
        .map((p) => ({ id: String(p._id), name: p.name, email: p.email, role: p.role, scopes: allowedScopes(p) })),
      tools: tools.map((t) => ({
        name: t.name,
        title: t.title,
        scope: t.scope,
        disabled: s.disabledTools.includes(t.name),
      })),
      redirectPresets: Object.fromEntries(
        Object.entries(REDIRECT_PRESETS).map(([k, p]) => [k, { label: p.label, enabled: s.oauthApps[k] }]),
      ),
      apps: apps.map((a) => ({
        clientId: a.clientId,
        name: a.clientName,
        redirects: a.redirectUris,
        registeredAt: a.createdAt,
        lastUsedAt: a.lastUsedAt || null,
      })),
    };
  }

  /** Changes that widen access need the caller's own password. */
  function widens(doc, change) {
    switch (change.action) {
      case 'mode':
        return change.value === 'read' && (doc?.mode || 'off') === 'off';
      case 'allow':
      case 'allowContactReveal':
      case 'enableTool':
      case 'allowOAuth':
      case 'allowApp':
      case 'addRedirectOrigin':
        return change.value !== false;
      case 'limits':
        return Object.entries(change.value || {}).some(
          ([k, v]) => Number.isInteger(v) && (!doc?.limits?.[k] || v > doc.limits[k]),
        );
      case 'approvalDays':
        return change.value > (doc?.oauthApprovalDays || DEFAULT_APPROVAL_DAYS);
      default:
        return false;
    }
  }

  async function confirmPassword(req, password) {
    const lockKey = `confirm:${req.user._id}`;
    if ((await limits.peek(lockKey)) >= 5)
      throw new ManageError(422, 'PASSWORD_LOCKED', 'Too many wrong passwords; wait 15 minutes.');
    if (typeof password !== 'string' || !password)
      throw new ManageError(400, 'PASSWORD_REQUIRED', 'This change widens access; confirm it with your password.');
    const user = await repo.findUserWithPassword(req.user._id);
    if (!user?.password || !(await user.matchPassword(password))) {
      await limits.hit(lockKey, 5, 900000);
      await record(req, 'settings.confirm', { reason: 'wrong password' }, 'denied');
      throw new ManageError(422, 'PASSWORD_WRONG', 'That password is not correct.');
    }
  }

  const describe = (req, change) =>
    `${new Date().toISOString()} ${req.user.email}: ${change.action} ${JSON.stringify(change.value)}`;

  async function changeSettings(req, change) {
    await requireSuperadmin(req);
    if (!change || typeof change.action !== 'string') throw new ManageError(400, 'INVALID', 'Send {action, value}.');
    const doc = await repo.loadSettingsDoc();
    if (widens(doc.toObject(), change)) await confirmPassword(req, change.password);
    const userId = (v) => {
      if (!mongoose.isValidObjectId(v)) throw new ManageError(400, 'INVALID', 'Not a user id.');
      return new mongoose.Types.ObjectId(v);
    };
    switch (change.action) {
      case 'mode':
        if (!['off', 'read'].includes(change.value)) throw new ManageError(400, 'INVALID', 'mode must be off or read.');
        doc.mode = change.value;
        break;
      case 'allow': {
        const target = await repo.findUserLean(userId(change.user), 'role status');
        if (!isStaff(target)) throw new ManageError(400, 'INVALID', 'Only active staff accounts can be allowed.');
        const id = String(target._id);
        doc.allowedUsers =
          change.value === false
            ? doc.allowedUsers.filter((u) => String(u) !== id)
            : [...new Set([...doc.allowedUsers.map(String), id])];
        if (change.value === false)
          await repo.revokeTokens(
            { user: target._id },
            new Date(),
            `superadmin:${req.user.email}`,
            'removed from allow-list',
          );
        break;
      }
      case 'allowContactReveal':
        doc.allowContactReveal = change.value === true;
        break;
      case 'allowOAuth':
        doc.allowOAuth = change.value !== false;
        break;
      case 'enableTool': {
        if (!tools.some((t) => t.name === change.tool)) throw new ManageError(400, 'INVALID', 'Unknown tool.');
        doc.disabledTools =
          change.value === false
            ? [...new Set([...doc.disabledTools, change.tool])]
            : doc.disabledTools.filter((t) => t !== change.tool);
        break;
      }
      case 'limits': {
        for (const [k, v] of Object.entries(change.value || {})) {
          if (!LIMIT_KEYS.includes(k)) throw new ManageError(400, 'INVALID', `Unknown limit ${k}.`);
          if (v === null) {
            doc.limits[k] = undefined;
            continue;
          }
          if (!Number.isInteger(v) || v < 1 || v > config.limits[k])
            throw new ManageError(400, 'INVALID', `${k} must be 1..${config.limits[k]}.`);
          doc.limits[k] = v;
        }
        break;
      }
      case 'allowApp': {
        if (!REDIRECT_PRESETS[change.app]) throw new ManageError(400, 'INVALID', 'Unknown app preset.');
        doc.oauthApps = {
          ...(doc.oauthApps?.toObject?.() || doc.oauthApps || {}),
          [change.app]: change.value !== false,
        };
        break;
      }
      case 'addRedirectOrigin': {
        let origin;
        try {
          origin = new URL(change.origin).origin;
        } catch {
          throw new ManageError(400, 'INVALID', 'Not a valid origin.');
        }
        if (!/^https:/.test(origin)) throw new ManageError(400, 'INVALID', 'Custom redirect origins must be https.');
        doc.allowedRedirectOrigins =
          change.value === false
            ? doc.allowedRedirectOrigins.filter((o) => o !== origin)
            : [...new Set([...doc.allowedRedirectOrigins, origin])];
        break;
      }
      case 'approvalDays':
        if (!Number.isInteger(change.value) || change.value < 1 || change.value > config.oauth.maxApprovalDays)
          throw new ManageError(400, 'INVALID', `approvalDays must be 1..${config.oauth.maxApprovalDays}.`);
        doc.oauthApprovalDays = change.value;
        break;
      default:
        throw new ManageError(400, 'INVALID', `Unknown action ${change.action}.`);
    }
    doc.modifiedBy = req.user._id;
    doc.logs = [
      ...doc.logs,
      describe(req, {
        action: change.action,
        value: change.value ?? change.user ?? change.tool ?? change.app ?? change.origin,
      }),
    ].slice(-MAX_LOGS);
    await doc.save();
    settings.invalidate();
    await record(req, 'settings.change', {
      action: change.action,
      value: change.value,
      user: change.user,
      tool: change.tool,
      app: change.app,
      origin: change.origin,
    });
    return getSettings(req);
  }

  return { getSettings, changeSettings, confirmPassword };
}

module.exports = { createSettingsAdmin };
