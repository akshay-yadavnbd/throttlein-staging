/** POST /api/contact. No rules live here. */
const asyncHandler = require('express-async-handler');
const { sendData } = require('../../utils/apiResponse');
const contact = require('./contact.service');

/** 202: accepted; delivery is best-effort. The contact page reads only the status. */
exports.submit = asyncHandler(async (req, res) => sendData(res, await contact.submit(req.body), 202));
