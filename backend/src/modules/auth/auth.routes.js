/** /api/auth. Mounted by routes/api.js through routes/authRoutes.js. */
const express = require('express');
const { protect, blockImpersonated } = require('../../middleware/auth');
const rateLimit = require('../../middleware/rateLimit');
const { emailRateKey } = require('../../middleware/requestSecurity');
const { validate } = require('../../middleware/validate');
const auth = require('./auth.schema');
const ctrl = require('./auth.controller');

const router = express.Router();

// Seller self-registration — email-first (NO password at this step).
router.post(
  '/register',
  rateLimit({ name: 'register', max: 5, window: 900 }),
  validate({ body: auth.registerSeller }),
  ctrl.registerSeller,
);

// Email-verification flow
router.get('/verify-email/:token', validate({ params: auth.verifyTokenParams }), ctrl.checkVerifyToken);
router.post(
  '/set-password',
  rateLimit({ name: 'set-password', max: 10, window: 900 }),
  validate({ body: auth.setPassword }),
  ctrl.setPasswordAfterVerify,
);
router.post(
  '/resend-verification',
  rateLimit({ name: 'resend-ip', max: 5, window: 900 }),
  rateLimit({ name: 'resend-email', max: 3, window: 900, keyBy: emailRateKey }),
  validate({ body: auth.emailOnly }),
  ctrl.resendVerification,
);

router.post(
  '/register-customer',
  rateLimit({ name: 'register', max: 5, window: 900 }),
  validate({ body: auth.registerCustomer }),
  ctrl.registerCustomer,
);

// Limit both network sources and normalised account identities. The
// storefront keys off `code: 'MISSING_FIELDS'` for a blank form.
router.post(
  '/login',
  rateLimit({ name: 'login', max: 10, window: 60 }),
  rateLimit({ name: 'login-hr', max: 60, window: 3600 }),
  rateLimit({ name: 'login-account', max: 20, window: 900, keyBy: emailRateKey }),
  validate({ body: auth.login }, { code: 'MISSING_FIELDS', message: 'Please enter both your email and password.' }),
  ctrl.login,
);
router.get('/me', protect, ctrl.me);
/* `blockImpersonated` — an admin signed in AS a seller must not be able to
 * change that seller's email or password; the owner does these themselves. */
router.put('/profile', protect, blockImpersonated, validate({ body: auth.updateProfile }), ctrl.updateProfile);
router.post(
  '/change-password',
  protect,
  blockImpersonated,
  rateLimit({ name: 'change-password', max: 5, window: 900 }),
  validate({ body: auth.changePassword }),
  ctrl.changePassword,
);

// Forgot password (no auth)
router.post(
  '/forgot-password',
  rateLimit({ name: 'fp-ip', max: 10, window: 900 }),
  rateLimit({ name: 'fp', max: 5, window: 900, keyBy: emailRateKey }),
  validate({ body: auth.emailOnly }),
  ctrl.forgotPassword,
);
router.post(
  '/reset-password/:token',
  rateLimit({ name: 'reset-password', max: 10, window: 900 }),
  validate({ params: auth.resetPasswordParams, body: auth.resetPassword }),
  ctrl.resetPassword,
);

module.exports = router;
