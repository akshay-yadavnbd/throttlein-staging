/**
 * robots.txt — generated dynamically by Next.js from this file.
 *
 * Three blocks emitted, in this order:
 *
 *  1. `User-agent: *` — the default block. Allows the public catalogue
 *     and the search-query permutation (`?q=`) so search-result pages
 *     can be crawled and ranked, while blocking authenticated areas,
 *     API routes, and the sort/page query permutations that produce
 *     near-duplicate content.
 *
 *  2. `User-agent: Google-Extended` — Google's opt-in signal for
 *     allowing pages to be used by Bard / SGE / Gemini. We explicitly
 *     allow so the brand shows up in AI overview answers.
 *
 *  3. `User-agent: GPTBot` — OpenAI's web crawler. Same reasoning —
 *     showing up in ChatGPT's browse + Search answers is good for
 *     discovery, so we opt in.
 *
 * `sitemap` is the absolute URL to the sitemap index; the origin
 * comes from lib/siteUrl (single source of truth — see that file
 * for the env / fallback rules).
 */

import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/siteUrl';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // ─── Default crawler block ───
      {
        userAgent: '*',
        // `allow` is emitted before `disallow` by Next.js's serializer,
        // which is the standard order most crawlers expect.
        allow: ['/', '/*?q='],
        disallow: [
          '/account/',
          '/cart',
          '/checkout/',
          '/seller/dashboard/',
          '/admin/',
          '/api/',
          '/*?sort=',
          '/*?page=',
          '/cdn-cgi/',
        ],
      },

      // ─── AI crawlers — opt in for SGE / ChatGPT visibility ───
      {
        userAgent: 'Google-Extended',
        allow: '/',
      },
      {
        userAgent: 'GPTBot',
        allow: '/',
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
