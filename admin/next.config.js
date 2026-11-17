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
    // required for the dev setup where images come from the
    // localhost:5000 backend.
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== 'production',
  },
};

module.exports = nextConfig;
