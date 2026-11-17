/** Notification recipient HTTP handlers (/api/admin/notifications, superadmin only). No rules live here. */
const asyncHandler = require('express-async-handler');
const { sendData, sendCreated } = require('../../utils/apiResponse');
const recipients = require('./recipients.service');

/** Who did it, for the admin audit log. */
const actorOf = (req) => ({
  actor: req.user._id,
  actorEmail: req.user.email,
  actorRole: req.user.role,
  ip: req.ip,
  userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
});

const respond = (fn) => asyncHandler(async (req, res) => sendData(res, await fn(req)));

exports.list = respond(() => recipients.list());
exports.add = asyncHandler(async (req, res) => sendCreated(res, await recipients.add(actorOf(req), req.body)));
exports.update = respond((req) => recipients.update(actorOf(req), req.params.id, req.body));
exports.remove = respond((req) => recipients.remove(actorOf(req), req.params.id));
exports.test = respond((req) => recipients.sendTest(actorOf(req), req.params.id));
