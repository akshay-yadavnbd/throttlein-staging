/**
 * Persistence for the connector itself: the settings document, OAuth
 * clients / codes / tokens, the audit trail, and the staff reads the OAuth
 * and management flows make. Statements only.
 */
const mongoose = require('mongoose');
const User = require('../../models/User');
const McpSettings = require('./mcp-settings.model');
const { McpOAuthClient, McpOAuthCode, McpOAuthToken } = require('./mcp-oauth.model');
const McpAuditLog = require('./mcp-audit-log.model');
const Counter = require('../../models/Counter');

const toId = (v) => new mongoose.Types.ObjectId(v);

/* ── staff ──────────────────────────────────────────────────────────── */
const findUserLean = (id, fields) => User.findById(id).select(fields).lean();
const findUserByEmailLean = (email, fields = '_id') => User.findOne({ email }).select(fields).lean();
const findUserWithPassword = (id) => User.findById(id).select('+password');
const findUserByEmailWithPassword = (email) =>
  User.findOne({ email }).select('+password name email role status permissions tokenVersion');
const usersByIds = (ids, fields = 'name email role') =>
  User.find({ _id: { $in: ids } })
    .select(fields)
    .lean();
const adminsAndStaff = () =>
  User.find({ role: { $in: ['superadmin', 'staff'] } })
    .select('name email role status permissions')
    .lean();

/* ── settings ───────────────────────────────────────────────────────── */
const loadSettingsLean = () => McpSettings.findOne({ key: 'global' }).lean();
const loadSettingsDoc = async () =>
  (await McpSettings.findOne({ key: 'global' })) || new McpSettings({ key: 'global' });

/* ── OAuth clients ──────────────────────────────────────────────────── */
const findClient = (clientId) => McpOAuthClient.findOne({ clientId }).lean();
const createClient = (fields) => McpOAuthClient.create(fields);
const touchClient = (clientId, at) => McpOAuthClient.updateOne({ clientId }, { $set: { lastUsedAt: at } });
const recentClients = () => McpOAuthClient.find({}).sort({ lastUsedAt: -1 }).limit(100).lean();

/* ── OAuth codes ────────────────────────────────────────────────────── */
const findCode = (filter) => McpOAuthCode.findOne(filter).lean();
/** Marks the code used atomically; null when it was invalid, expired or already used. */
const consumeCode = (filter, usedAt) =>
  McpOAuthCode.findOneAndUpdate(
    { ...filter, usedAt: null, expiresAt: { $gt: usedAt } },
    { $set: { usedAt } },
    { returnDocument: 'after' },
  ).lean();
const createCode = (fields) => McpOAuthCode.create(fields);
const setCodeFamily = (id, family) => McpOAuthCode.updateOne({ _id: id }, { $set: { family } });

/* ── OAuth tokens ───────────────────────────────────────────────────── */
const findToken = (filter) => McpOAuthToken.findOne(filter).lean();
const insertTokens = (rows) => McpOAuthToken.insertMany(rows);
/** Rotates a live refresh token in place; null when none matched. */
const rotateRefreshToken = (filter, at) =>
  McpOAuthToken.findOneAndUpdate(
    filter,
    { $set: { revokedAt: at, revokedBy: 'rotation', revokeReason: 'rotated', rotatedAt: at } },
    { returnDocument: 'after' },
  ).lean();
const revokeTokens = (filter, revokedAt, revokedBy, revokeReason) =>
  McpOAuthToken.updateMany({ ...filter, revokedAt: null }, { $set: { revokedAt, revokedBy, revokeReason } });
const touchToken = (id, at) => McpOAuthToken.updateOne({ _id: id }, { $set: { lastUsedAt: at } });
/** One row per connection (token family), newest first. */
const connections = (filter) =>
  McpOAuthToken.aggregate([
    { $match: { kind: 'refresh', ...filter } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$family',
        user: { $first: '$user' },
        clientId: { $first: '$clientId' },
        clientName: { $first: '$clientName' },
        scopes: { $first: '$scopes' },
        approvalEndsAt: { $first: '$approvalEndsAt' },
        createdAt: { $last: '$createdAt' },
        lastUsedAt: { $max: '$lastUsedAt' },
        revokedAt: { $max: '$revokedAt' },
        revokeReason: { $last: '$revokeReason' },
        active: { $max: { $cond: [{ $eq: ['$revokedAt', null] }, 1, 0] } },
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: 500 },
  ]);

/* ── audit ──────────────────────────────────────────────────────────── */
const createAuditRow = (row) => McpAuditLog.create(row);
const nextAuditSeq = (name) => Counter.next(name);
const auditRows = (filter, { skip = 0, limit }) =>
  McpAuditLog.find(filter).select('-mac -argsMac').sort({ seq: -1 }).skip(skip).limit(limit).lean();
const recentAuditRows = (limit) => McpAuditLog.find({}).sort({ seq: -1 }).limit(limit).lean();

module.exports = {
  toId,
  findUserLean,
  findUserByEmailLean,
  findUserWithPassword,
  findUserByEmailWithPassword,
  usersByIds,
  adminsAndStaff,
  loadSettingsLean,
  loadSettingsDoc,
  findClient,
  createClient,
  touchClient,
  recentClients,
  findCode,
  consumeCode,
  createCode,
  setCodeFamily,
  findToken,
  insertTokens,
  rotateRefreshToken,
  revokeTokens,
  touchToken,
  connections,
  createAuditRow,
  nextAuditSeq,
  auditRows,
  recentAuditRows,
};
