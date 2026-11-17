const { SITES, DEFAULT_SITE, isSite } = require('../config/sites');
const { env } = require('../config/env');
const { AppError } = require('../errors/AppError');

/**
 * resolveSite — decide which content property (throttlein.com vs
 * seller.throttlein.com) this request is about, and stash it on
 * `req.site`.
 *
 * Every CMS read and write is scoped by that value, so getting it right
 * matters more than getting it convenient. Resolution order, most
 * explicit first:
 *
 *   1. ?site=          — explicit query param. Used by the storefront's
 *                        server components, which always know which
 *                        property they're rendering.
 *   2. body.site       — explicit on writes. Lets a create/update pin
 *                        the site even if the header is stale.
 *   3. X-Admin-Site    — sent by the admin panel's axios interceptor,
 *                        reflecting the sidebar's site switcher.
 *   4. X-Site          — sent by the storefront's client-side axios,
 *                        derived from window.location.host.
 *   5. Origin/Referer  — last-resort host sniff against SELLER_ORIGIN,
 *                        for callers that set none of the above.
 *   6. 'main'          — the default, which is what every pre-multi-site
 *                        caller effectively asks for.
 *
 * An UNRECOGNISED value is a 400, not a silent fallback. A typo'd
 * `?site=sellers` quietly writing to the main site is exactly the kind
 * of bug that gets noticed a week later by a customer.
 */

function hostOf(value) {
  if (!value) return '';
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return String(value)
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .toLowerCase();
  }
}

/** Host of the seller property, derived from env. Empty when unset
 *  (local dev), which simply disables step 5. */
function sellerHost() {
  return hostOf(env.SELLER_ORIGIN || env.NEXT_PUBLIC_SELLER_URL || '');
}

const resolveSite = (req, res, next) => {
  const candidates = [req.query?.site, req.body?.site, req.get('X-Admin-Site'), req.get('X-Site')];

  for (const raw of candidates) {
    if (raw === undefined || raw === null || raw === '') continue;
    const value = String(raw).trim().toLowerCase();
    if (!isSite(value)) {
      return next(AppError.badRequest(`Unknown site "${raw}". Expected one of: ${SITES.join(', ')}.`));
    }
    req.site = value;
    return next();
  }

  // Step 5 — sniff the caller's origin. Only meaningful when the seller
  // property has a configured host.
  const seller = sellerHost();
  if (seller) {
    const origin = hostOf(req.get('Origin') || req.get('Referer') || '');
    if (origin && origin === seller) {
      req.site = 'seller';
      return next();
    }
  }

  req.site = DEFAULT_SITE;
  return next();
};

module.exports = resolveSite;
