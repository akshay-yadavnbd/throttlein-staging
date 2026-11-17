/**
 * /api/auth handlers. HTTP ⇄ service only. Every success answers the
 * `{ data }` envelope (storefront, admin and the assistant read it); the
 * login refusal codes (MISSING_FIELDS, INVALID_CREDENTIALS, ACCOUNT_SUSPENDED,
 * EMAIL_UNVERIFIED) travel on the unchanged error envelope.
 */
const asyncHandler = require('express-async-handler');
const { signToken } = require('../../middleware/auth');
const { sendData, sendCreated } = require('../../utils/apiResponse');
const signup = require('./seller-signup.service');
const account = require('./account.service');
const passwordReset = require('./password-reset.service');

const respond = (fn) => asyncHandler(async (req, res) => sendData(res, await fn(req)));

// POST /register — seller, email-first: 201 for a new account, 200 when a fresh link was re-sent.
exports.registerSeller = asyncHandler(async (req, res) => {
  const { created, ...body } = await signup.register(req.body);
  sendData(res, body, created ? 201 : 200);
});
// GET /verify-email/:token
exports.checkVerifyToken = respond((req) => signup.checkVerifyToken(req.params.token));
// POST /set-password — { token, password }
exports.setPasswordAfterVerify = respond((req) => signup.setPasswordAfterVerify(req.body, signToken));
// POST /resend-verification — { email }
exports.resendVerification = respond((req) => signup.resendVerification(req.body.email));

// POST /register-customer
exports.registerCustomer = asyncHandler(async (req, res) => {
  sendCreated(res, await account.registerCustomer(req.body));
});
// POST /login
exports.login = respond((req) => account.login(req.body));
// GET /me
exports.me = respond(async (req) => ({ user: req.user.toSafeJSON() }));
// PUT /profile
exports.updateProfile = respond((req) => account.updateProfile(req.user._id, req.body));
// POST /change-password
exports.changePassword = respond((req) => account.changePassword(req.user._id, req.body));

// POST /forgot-password — { email }
exports.forgotPassword = respond((req) => passwordReset.forgot(req.body.email));
// POST /reset-password/:token — { password, confirmPassword? }
exports.resetPassword = respond((req) => passwordReset.reset(req.params.token, req.body));
