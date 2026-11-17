import type { Metadata } from 'next';
import { Inter, Poppins } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { Providers } from './providers';
import { SITE_URL } from '@/lib/siteUrl';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

// Poppins is loaded as a secondary face — currently only the blog detail
// page opts in (via `.blog-detail` CSS scoping) so the rest of the site
// keeps its existing Inter feel. CSS variable lets us scope per-section.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-poppins',
  display: 'swap',
});

// `metadataBase` is the absolute root Next.js uses to resolve relative
// image URLs in OG/Twitter previews. Without it, social cards reference
// "http://localhost:3000/images/..." which obviously 404 outside dev.
// SITE_URL is sourced from lib/siteUrl (single source of truth) and
// driven by the NEXT_PUBLIC_SITE_URL build arg — see Dockerfile.

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'THROTTLEIN — Bike Accessories Marketplace',
  description:
    'Throttle in. Shop premium bike accessories from trusted sellers. Helmets, lights, locks, gloves, and more.',

  // ─── Open Graph (Facebook / WhatsApp / Teams / Slack / iMessage) ────────
  // Default OG image is `/images/home-banner-img.png` — the hero banner
  // we own. Per-page metadata (product / brand / category / blog) can
  // still override `openGraph.images` with a more specific image:
  //   - Products fall back to the seller's first uploaded product image.
  //   - Blog posts fall back to the featured image.
  //   - Category / brand pages use category / brand image when set.
  //   - Every other page inherits this hero banner default.
  openGraph: {
    type: 'website',
    siteName: 'THROTTLEIN',
    title: 'THROTTLEIN — Bike Accessories Marketplace',
    description:
      'Throttle in. Shop premium bike accessories from trusted sellers. Helmets, lights, locks, gloves, and more.',
    url: SITE_URL,
    locale: 'en_IN',
    images: [
      {
        url: '/images/home-banner-img.png',
        width: 1200,
        height: 630,
        alt: 'THROTTLEIN — India\'s motorcycle gear marketplace',
      },
    ],
  },

  // ─── Twitter Cards ──────────────────────────────────────────────────────
  // Twitter falls back to the same hero image whenever a page doesn't
  // supply its own. Kept the summary_large_image card so URLs preview
  // as full-width banners in Twitter / X.
  twitter: {
    card: 'summary_large_image',
    title: 'THROTTLEIN — Bike Accessories Marketplace',
    description:
      'Throttle in. Shop premium bike accessories from trusted sellers.',
    images: ['/images/home-banner-img.png'],
  },

  // ─── Geo / regional targeting ──────────────────────────────────────────
  // `geo.region` uses the ISO 3166-1 alpha-2 country code (IN = India).
  // ICBM is the lat/long of the storefront's HQ (Mumbai centroid here —
  // swap for the real address once we have one). These help with
  // "near me" / regional SERP relevance for queries like "buy bike
  // helmet india".
  other: {
    'geo.region': 'IN',
    'geo.placename': 'India',
    'geo.position': '19.0760;72.8777',
    ICBM: '19.0760, 72.8777',
  },
};

// Origins we want the browser to warm up before it starts requesting
// images / API data. preconnect opens the TCP/TLS handshake in parallel
// with HTML parsing — saves ~100-200ms on the first product thumbnail
// since every product image fetches from this origin. dns-prefetch is
// the fallback for older browsers / crawlers that ignore preconnect.
const PRECONNECT_ORIGINS = [
  process.env.NEXT_PUBLIC_API_URL
    ? new URL(process.env.NEXT_PUBLIC_API_URL).origin
    : 'https://api.throttlein.com',
];

// ─── Analytics IDs (env-driven so dev / staging / prod stay isolated) ─────
// Set NEXT_PUBLIC_GTM_ID and/or NEXT_PUBLIC_GA_ID in .env (and pass through
// the Dockerfile + CI). Either can be left empty to disable that tool —
// the `<Script>` block below renders only when the ID is present.
//
// GTM is the recommended primary integration (you can fire GA4 events
// THROUGH GTM); but we wire both because Google's setup wizard often
// hands out the gtag snippet alongside the GTM container.
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID || 'GTM-KS3BB4BB';
const GA_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-KTHJ1SKMGK';
// Meta (Facebook) Pixel ID. Set NEXT_PUBLIC_FB_PIXEL_ID in .env to
// enable tracking. Leaving it empty skips both the JS init and the
// <noscript> fallback img so the markup stays clean for non-tracked
// builds.
const FB_PIXEL_ID = process.env.NEXT_PUBLIC_FB_PIXEL_ID || '1360032832686993';
// Microsoft Clarity project ID. Clarity is a session-replay + heatmap tool
// that records anonymised user interactions for product analysis. See the
// analytics block in <head> for why the tag is injected after hydration
// rather than rendered into the server HTML.
const CLARITY_ID = process.env.NEXT_PUBLIC_CLARITY_ID || 'xdh7zfhhiw';

// Site-wide JSON-LD (Organization / WebSite) moved to
// lib/structuredData.ts and renders from each PROPERTY's layout —
// (storefront) gets the storefront pair, seller gets its own combined
// @graph. Rendering it here put the storefront's schema on the seller
// subdomain (flagged by the schema audit).

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // data-scroll-behavior: Next 16 no longer auto-overrides CSS
  // smooth-scrolling during SPA navigations unless this attribute is
  // present — keeps route changes snappy on pages (e.g. prose pages)
  // that enable `scroll-behavior: smooth`.
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${inter.variable} ${poppins.variable}`}>
      {/* Explicit <head> so we can inject resource hints. App Router
          merges this with the head Next.js generates from `metadata`. */}
      <head>
        {PRECONNECT_ORIGINS.map((origin) => (
          <link
            key={`preconnect-${origin}`}
            rel="preconnect"
            href={origin}
            crossOrigin="anonymous"
          />
        ))}
        {PRECONNECT_ORIGINS.map((origin) => (
          <link key={`dns-prefetch-${origin}`} rel="dns-prefetch" href={origin} />
        ))}

        {/* ── Analytics tags ──────────────────────────────────────────
            All of these use `next/script` with
            `strategy="afterInteractive"`. That choice is deliberate and
            has been got wrong twice, so the reasoning is written down.

            Raw <script> tags, and `next/script` with
            `strategy="beforeInteractive"`, both render a real <script>
            ELEMENT into the React tree. React 19 rejects that:
              "Encountered a script tag while rendering React component.
               Scripts inside React components are never executed when
               rendering on the client."
            The warning fired on every page in dev, pointing at the GTM
            tag below. `beforeInteractive` was not a fix for it — it has
            the same shape as the raw tag it replaced.

            `afterInteractive` is the only strategy that avoids it:
            next/script injects the tag imperatively from an effect
            (document.createElement) rather than rendering an element, so
            React never sees a <script> child.

            What this costs: the tags are NOT in the server-rendered
            HTML — they appear in the live DOM shortly after hydration.
            That is fine for what these tags are. Analytics only does
            anything once JavaScript runs, GTM's preview mode and Tag
            Assistant read the live DOM rather than view-source, and
            Googlebot has no interest in a measurement tag. The earlier
            note here claimed server-HTML presence was a hard
            requirement; it isn't, and it was the reason the unsupported
            pattern was kept. */}
        {GTM_ID && (
          <Script
            id="gtm-init"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`,
            }}
          />
        )}

        {/* Google Analytics 4 (gtag) — loader + config, same reasoning.
            Order between these two doesn't matter: the init snippet
            defines `gtag` itself, so whichever runs first, the calls are
            queued on dataLayer and gtag.js drains them. */}
        {GA_ID && (
          <>
            <Script
              id="ga-loader"
              strategy="afterInteractive"
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
            />
            <Script
              id="ga-init"
              strategy="afterInteractive"
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${GA_ID}');`,
              }}
            />
          </>
        )}

        {/* Meta (Facebook) Pixel — fires PageView on every route load.
            Wired via Next.js <Script afterInteractive> so the tag
            doesn't block first paint. Fallback <noscript> img lives
            inside <body> below. */}
        {FB_PIXEL_ID && (
          <Script
            id="fb-pixel-init"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${FB_PIXEL_ID}');
              fbq('track', 'PageView');`,
            }}
          />
        )}

        {/* Microsoft Clarity — session-replay + heatmaps. */}
        {CLARITY_ID && (
          <Script
            id="clarity-init"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window, document, "clarity", "script", "${CLARITY_ID}");`,
            }}
          />
        )}
      </head>
      <body className={`${inter.className} bg-brand-cream text-brand-black flex flex-col min-h-screen`}>
        {/* GTM <noscript> fallback — fires the page view via an iframe
            for users with JavaScript disabled (rare but worth having).
            Must be IMMEDIATELY after <body> per Google's docs. */}
        {GTM_ID && (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
              height="0"
              width="0"
              style={{ display: 'none', visibility: 'hidden' }}
              title="Google Tag Manager"
            />
          </noscript>
        )}

        {/* Property-level JSON-LD (Organization / WebSite) is emitted by
            each property's own layout — (storefront) and seller — so the
            seller subdomain no longer ships the storefront's schema. */}
        <Providers>
          {/* NO chrome here. Navbar + Footer moved into the
              (storefront) route group's layout so the seller property
              stops shipping hidden storefront markup — see the comment
              in app/(storefront)/layout.tsx. Each property/section owns
              its own <main> wrapper. */}
          {children}
        </Providers>
      </body>
    </html>
  );
}
