/** Page slugs: slugify, and the routes each site's app already owns (a page there would be shadowed or break it). */
/** Slugify helper — same shape as Brand/Category, but local so this
 *  model has no implicit coupling to other slugifiers. */
function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

// Reserved top-level route slugs — these are baked into the Next.js
// app router so a dynamic page slug colliding with one would either be
// shadowed (page never reachable) or break a built-in route. The guard
// only applies to top-level pages (no parentCategory); pages nested
// under a category are fine because they live under /<cat>/<slug>.
//
// The two sites have DIFFERENT hard-coded route sets, so the reserved
// list is per-site. The seller subdomain only owns a handful of routes
// (its own auth screens, the dashboard, the blog and the /c content
// namespace), which means the seller site can legitimately publish a
// page at /products or /about — those are main-site routes only.
const RESERVED_TOP_LEVEL_SLUGS = new Set([
  'about',
  'account',
  'auth',
  'api',
  'blog',
  'blogs',
  'brands',
  'cart',
  'categories',
  'checkout',
  'contact',
  'dashboard',
  'favicon.ico',
  'forgot-password',
  'help',
  'home',
  'kyc-pending',
  'llms.txt',
  'locations',
  'login',
  'logout',
  'mock',
  'orders',
  'p',
  'pages',
  'press',
  'pricing',
  'privacy',
  'product',
  'products',
  'profile',
  'register',
  'reset-password',
  'returns',
  'reviews',
  'sell',
  'seller',
  'sellers',
  'shop',
  'shipping',
  'shop-by-bike',
  'signin',
  'signup',
  'support',
  'sustainability',
  'terms',
  'wishlist',
]);

const RESERVED_SELLER_SLUGS = new Set([
  'api',
  'blog',
  'c',
  'dashboard',
  'favicon.ico',
  'guide',
  'llms.txt',
  'login',
  'logout',
  'page',
  'register',
  'robots.txt',
  'seller',
  'sitemap.xml',
  'verify',
]);

const RESERVED_SLUGS_BY_SITE = {
  main: RESERVED_TOP_LEVEL_SLUGS,
  seller: RESERVED_SELLER_SLUGS,
};

module.exports = { slugify, RESERVED_TOP_LEVEL_SLUGS, RESERVED_SLUGS_BY_SITE };
