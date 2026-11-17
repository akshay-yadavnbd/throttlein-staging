const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const { DEFAULT_SITE, permissionKeyFor } = require('../config/sites');
const { env } = require('../config/env');
const { AppError } = require('../errors/AppError');

function signToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
      email: user.email,
      // Session generation (audit gap: password changes didn't revoke
      // JWTs). Bumping User.tokenVersion invalidates every token issued
      // before the bump — the check lives in `protect` below.
      tv: Number(user.tokenVersion) || 0,
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN || '7d' },
  );
}

/**
 * Mint a SELLER token for an admin acting as that seller.
 *
 * This is the supported alternative to a shared "master password". The
 * difference matters:
 *   - the only secret involved is the ADMIN'S OWN password, which is
 *     already rotatable and revocable; no new standing secret exists
 *     that could unlock every seller account if it leaked;
 *   - the token names its operator (`imp`), so every request made with
 *     it is attributable — a master password produces actions
 *     indistinguishable from the seller's own;
 *   - it expires in minutes, not the normal 7 days.
 *
 * `imp` / `impEmail` are read back in `protect` and exposed as
 * `req.impersonation`.
 */
function signImpersonationToken(seller, admin, ttl = '30m') {
  return jwt.sign(
    {
      id: seller._id.toString(),
      role: seller.role,
      email: seller.email,
      tv: Number(seller.tokenVersion) || 0,
      imp: admin._id.toString(),
      impEmail: admin.email,
      itv: Number(admin.tokenVersion) || 0,
    },
    env.JWT_SECRET,
    { expiresIn: ttl },
  );
}

const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.split(' ')[1] : null;
  if (!token) {
    throw AppError.unauthorized('Not authenticated. Token missing.');
  }
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = await User.findById(decoded.id);
    if (!user) {
      throw AppError.unauthorized('User no longer exists.');
    }
    if (user.status === 'suspended') {
      throw AppError.forbidden('Your account has been suspended. Contact admin.');
    }
    /* Session invalidation. A password reset / change / forced logout
     * increments `tokenVersion`; any token minted before that carries an
     * older `tv` and is refused here. Previously a stolen token stayed
     * valid for its full lifetime even after the victim changed their
     * password. Tokens issued before this field existed have no `tv` and
     * are treated as generation 0, so existing sessions keep working
     * until their natural expiry (or the next password change). */
    const currentVersion = Number(user.tokenVersion) || 0;
    const tokenVersion = Number(decoded.tv) || 0;
    if (tokenVersion !== currentVersion) {
      throw AppError.unauthorized('Your session ended because the account password changed. Please sign in again.');
    }
    req.user = user;
    /* Impersonation context. Present only on tokens minted by
     * signImpersonationToken, so ordinary sessions are unaffected. Every
     * downstream handler can tell "the seller did this" from "an admin
     * did this while signed in as the seller". */
    if (decoded.imp) {
      const operator = await User.findById(decoded.imp);
      if (
        !operator ||
        operator.role !== 'superadmin' ||
        operator.status === 'suspended' ||
        decoded.itv === undefined ||
        Number(decoded.itv) !== (Number(operator.tokenVersion) || 0)
      ) {
        throw new Error('The administrator session has ended.');
      }
      req.impersonation = { adminId: decoded.imp, adminEmail: decoded.impEmail || '' };
    }
    next();
  } catch (err) {
    throw AppError.unauthorized(err.message || 'Invalid or expired token.');
  }
});

/**
 * Refuse an action when the caller is impersonating.
 *
 * Mounted on the routes that change how the real owner gets INTO their
 * account — password and email. An impersonated session exists for
 * support, and must never be able to lock the seller out of their own
 * business or quietly take the account over. Also blocks anything that
 * would rewrite the seller's payout destination.
 */
const blockImpersonated = (req, res, next) => {
  if (req.impersonation) {
    return next(
      AppError.forbidden(
        'This action is blocked while signed in as another account. ' + 'Ask the account owner to do it themselves.',
      ),
    );
  }
  next();
};

// Role guard factory: requireRole('superadmin') or requireRole('seller', 'superadmin')
const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(AppError.forbidden(`Access denied. Required role: ${roles.join(' or ')}.`));
    }
    next();
  };

/**
 * Permission guard factory: gate an admin endpoint behind one of the
 * keys defined in `User.PERMISSIONS`. Allows BOTH:
 *   - the superadmin (implicit access to everything), AND
 *   - any `role:'staff'` user whose `permissions[]` array contains the
 *     required key.
 *
 * Pass multiple keys to grant access when ANY of them match:
 *   router.put('/categories/:id',
 *     protect, requirePermission('categories'), handler);
 *
 * Reject responses use 403 (forbidden) — distinct from `protect`'s 401
 * (unauthenticated) so the admin UI can render a clean "no access"
 * page instead of bouncing the user to login.
 */
const requirePermission =
  (...perms) =>
  (req, res, next) => {
    if (!req.user) {
      return next(AppError.unauthorized('Not authenticated.'));
    }
    // Superadmin bypasses the permission list — they manage staff and
    // need every endpoint.
    if (req.user.role === 'superadmin') return next();
    // Staff users: at least one of the required perms must be on their
    // permissions[] array. Non-staff (customers, sellers) can't access
    // these endpoints at all.
    if (req.user.role !== 'staff') {
      return next(AppError.forbidden('Access denied. Admin-only endpoint.'));
    }
    const granted = new Set(req.user.permissions || []);
    if (!perms.some((p) => granted.has(p))) {
      return next(AppError.forbidden(`Access denied. Missing permission: ${perms.join(' or ')}.`));
    }
    next();
  };

/**
 * Site-scoped permission guard. Same rules as `requirePermission`, but
 * the required key is derived from the request's site (set upstream by
 * the `resolveSite` middleware — mount it BEFORE this guard):
 *
 *   base='pages', req.site='main'   → requires 'pages'
 *   base='pages', req.site='seller' → requires 'seller-pages'
 *
 * The main site deliberately keeps the unprefixed key so existing staff
 * grants continue to work untouched after this feature ships — nobody
 * loses access on deploy day, and nobody gains access to the seller
 * property until a superadmin explicitly ticks the new box.
 *
 * Superadmin bypasses, exactly as with `requirePermission`.
 */
const requireSitePermission =
  (...bases) =>
  (req, res, next) => {
    const site = req.site || DEFAULT_SITE;
    const keys = bases.map((base) => permissionKeyFor(base, site));
    return requirePermission(...keys)(req, res, next);
  };

/**
 * optionalAuth — decode the Authorization header if present, attach the
 * user to req.user, but DO NOT block the request if there's no token or
 * the token is invalid. Used for endpoints that have different behaviour
 * for logged-in vs guest users (e.g. blog comments — logged-in users
 * get attribution, guests submit with name/email).
 */
const optionalAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.split(' ')[1] : null;
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = await User.findById(decoded.id);
    if (
      user &&
      user.status !== 'suspended' &&
      !decoded.imp &&
      (Number(decoded.tv) || 0) === (Number(user.tokenVersion) || 0)
    )
      req.user = user;
  } catch (_) {
    // Invalid/expired tokens are silently ignored — the request continues
    // as if no token was supplied.
  }
  next();
});

module.exports = {
  protect,
  requireRole,
  requirePermission,
  requireSitePermission,
  signToken,
  signImpersonationToken,
  blockImpersonated,
  optionalAuth,
};
