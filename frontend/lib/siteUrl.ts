/**
 * The absolute origin used for canonical URLs, sitemap entries, OG
 * image URLs, JSON-LD `@id`s, and anywhere else we need a fully-
 * qualified link.
 *
 * The value is read from `NEXT_PUBLIC_SITE_URL`, which Next.js inlines
 * into the build at compile time (so it has to be present BEFORE
 * `next build` runs — the Dockerfile passes it as an ARG, the CI
 * workflow injects it from a repo secret).
 *
 * If the env var is missing we fall back based on NODE_ENV so a
 * forgotten secret on a production build doesn't ship localhost URLs
 * to Googlebot:
 *   - production → https://throttlein.com
 *   - anything else → http://localhost:3000   (dev / preview)
 *
 * One module, one source of truth. Every page that builds canonicals,
 * OG metadata, or sitemap entries imports from here — don't re-declare
 * the constant locally.
 */
export const SITE_URL: string =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://throttlein.com'
    : 'http://localhost:3000');
