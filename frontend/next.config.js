const { LITERAL_REDIRECTS } = require('./lib/legacyRedirects');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Dev-only Next.js indicator sat bottom-left over the sidebar's
  // "Back to storefront" link (UX audit S12). Bottom-right is empty.
  devIndicators: { position: 'bottom-right' },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'" },
      ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
    ] }];
  },
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**' },
    ],
    // Next 16 blocks image optimization from local IPs by default —
    // required for the dev setup where product images come from the
    // localhost:5000 backend. Harmless in production (all images are
    // S3/https there).
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== 'production',
  },
  // ─── URL redirects ────────────────────────────────────────────────
  // Legacy paths that still get hit from external bookmarks, Google
  // crawl history, or links shared during dev. `permanent: true`
  // emits a 308 (the modern 301 — Google treats both the same for
  // link equity) so the new URL inherits all the SEO juice.
  async redirects() {
    return [
      // Categories — original verbose path: /products/category/<slug>.
      // Interim: /c/<slug>. Current: root-level /<slug>. Both legacy
      // paths chain-redirect to the canonical root URL so any link in
      // the wild lands cleanly on the new page.
      {
        source: '/products/category/:slug',
        destination: '/:slug',
        permanent: true,
      },
      {
        source: '/c/:slug',
        destination: '/:slug',
        permanent: true,
      },
      // Prose pages now live at the clean root URL `/<slug>` (resolved by
      // the [slug] route's prose fallback). The earlier `/p/<slug>` and
      // `/page/<slug>` paths 301 here so old links / bookmarks / crawl
      // history consolidate onto the single canonical root URL.
      {
        source: '/p/:slug',
        destination: '/:slug',
        permanent: true,
      },
      {
        source: '/page/:slug',
        destination: '/:slug',
        permanent: true,
      },
      // /sell renamed to /seller — the guides subtree moved with it.
      // (The literal `/sell` → `/seller` pair lives in the shared table
      // below; only the parameterised rule is a pattern.)
      { source: '/sell/guide/:slug', destination: '/seller/guide/:slug', permanent: true },

      // ── Literal path redirects ──────────────────────────────────
      // Retired category slugs, "&"-slug variants and old umbrella
      // categories all live in lib/legacyRedirects.js. That table is
      // ALSO read by the generated SEO files (sitemap, llms.txt) so they
      // can resolve a path to its final destination instead of
      // advertising a URL that 308s. Keeping one copy is the point — see
      // the header comment in that file for the bug this prevents.
      ...LITERAL_REDIRECTS.map((r) => ({ ...r, permanent: true })),
    ];
  },
};

module.exports = nextConfig;
