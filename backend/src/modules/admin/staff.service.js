/**
 * Staff (internal users): role 'staff' with a `permissions[]` that maps to
 * admin sidebar modules. Provisioned by invitation — no password in the
 * request; a 7-day token is emailed and the invitee sets their own.
 * Sellers and customers are never returned here even though they share
 * the User collection.
 */
const { sendMail } = require('../../config/mail');
const { env } = require('../../config/env');
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const { brandHeaderHtml } = require('../auth');
const users = require('./users.repository');
const { staffInviteHtml } = require('./admin-emails');

/**
 * Trim, lowercase, dedupe, drop empties. Not validated against a backend
 * list on purpose: the canonical key set lives in the admin frontend's
 * module registry, and the middleware enforces access at route time.
 */
function normalisePermissions(arr) {
  if (!Array.isArray(arr)) return [];
  const cleaned = [];
  for (const p of arr) {
    const k = String(p).trim().toLowerCase();
    if (k && !cleaned.includes(k)) cleaned.push(k);
  }
  return cleaned;
}

/** Where the invitee lands: the admin panel's /staff/set-password/<token>. */
function setPasswordUrl(token) {
  const adminBase = (env.ADMIN_URL || env.ADMIN_ORIGIN || 'http://localhost:3001').replace(/\/$/, '');
  return `${adminBase}/staff/set-password/${token}`;
}

async function sendInvite(user, inviter, { intro }) {
  const url = setPasswordUrl(user.generateInviteToken());
  await user.save({ validateBeforeSave: false });
  const inviterName = (inviter && inviter.name) || 'A super-admin';
  await sendMail({
    to: user.email,
    subject: 'THROTTLEIN admin — set your password',
    html: staffInviteHtml({
      userName: user.name,
      inviterName,
      setPasswordUrl: url,
      brandHeaderHtml: brandHeaderHtml(),
    }),
    text: `${intro}\n\nHi ${user.name},\n\nSet your password (valid 7 days):\n${url}\n`,
  });
}

async function list() {
  const items = await users.listStaff();
  return { items, count: items.length };
}

/** Create the record without a password and email the invite. A failed email keeps the row so "Resend invite" can follow. */
async function create({ name, email, permissions }, inviter) {
  if (!name || !String(name).trim()) throw AppError.badRequest('Name is required');
  if (!email || !String(email).trim()) throw AppError.badRequest('Email is required');
  const normalised = String(email).trim().toLowerCase();
  if (await users.findByEmail(normalised)) throw AppError.conflict('A user with this email already exists');
  const user = await users.createUser({
    name: String(name).trim(),
    email: normalised,
    role: 'staff',
    permissions: normalisePermissions(permissions),
    status: 'approved',
    emailVerified: true, // admin-provisioned account, skip the verify flow
  });
  try {
    await sendInvite(user, inviter, { intro: "THROTTLEIN — You're invited to the admin panel" });
  } catch (err) {
    logger.error({ err }, 'createStaff: invite email failed');
  }
  return { user: user.toSafeJSON() };
}

async function loadStaff(id) {
  const user = await users.findStaff(id);
  if (!user) throw AppError.notFound('Staff user not found');
  return user;
}

/** Name, permissions, status, and an optional direct password reset. */
async function update(id, body) {
  const user = await loadStaff(id);
  if (body.name !== undefined) user.name = body.name;
  if (body.permissions !== undefined) user.permissions = normalisePermissions(body.permissions);
  if (body.status !== undefined && ['approved', 'suspended'].includes(body.status)) user.status = body.status;
  if (body.password) {
    if (
      typeof body.password !== 'string' ||
      body.password.length < 12 ||
      Buffer.byteLength(body.password, 'utf8') > 72
    ) {
      throw AppError.badRequest('Password must be at least 12 characters and at most 72 UTF-8 bytes');
    }
    user.password = body.password;
  }
  await user.save();
  return { user: user.toSafeJSON() };
}

/** A fresh token (the previous one stops working) and a new email. */
async function resendInvite(id, inviter) {
  const user = await loadStaff(id);
  try {
    await sendInvite(user, inviter, { intro: 'THROTTLEIN — Your admin invite' });
  } catch (err) {
    logger.error({ err }, 'resendStaffInvite: email failed');
    throw AppError.internal('Failed to send invite email. Check SMTP settings.');
  }
  return { message: 'Invite re-sent' };
}

async function remove(id) {
  const user = await loadStaff(id);
  await user.deleteOne();
  return { message: 'Staff user deleted' };
}

module.exports = { list, create, update, resendInvite, remove, normalisePermissions };
