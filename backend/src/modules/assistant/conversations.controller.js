/** Assistant chat history HTTP handlers (/api/assistant/conversations). No rules live here. */
const asyncHandler = require('express-async-handler');
const { sendData, sendCreated, sendNoContent } = require('../../utils/apiResponse');
const conversations = require('./conversations.service');

const respond = (fn) => asyncHandler(async (req, res) => sendData(res, await fn(req)));

exports.list = respond((req) => conversations.list(req.user._id, req.query));
exports.create = asyncHandler(async (req, res) => sendCreated(res, await conversations.create(req.user._id, req.body)));
exports.getOne = respond((req) => conversations.get(req.user._id, req.params.id));
exports.append = respond((req) => conversations.append(req.user._id, req.params.id, req.body));
exports.rename = respond((req) => conversations.rename(req.user._id, req.params.id, req.body));
exports.remove = asyncHandler(async (req, res) => {
  await conversations.remove(req.user._id, req.params.id);
  sendNoContent(res);
});
