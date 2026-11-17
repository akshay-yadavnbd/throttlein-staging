/**
 * Default OG image — `/opengraph-image.png` (1200×630).
 *
 * Next.js renders this server-side via @vercel/og when a crawler
 * fetches the URL. It replaces the layout's letterboxed logo PNG
 * fallback that was being used for the root OG.
 *
 * Pages that set their own `openGraph.images` (product, brand,
 * category, blog post) override this automatically — this is the
 * site-wide fallback for everything else, plus the explicit choice
 * for the home page since the home metadata doesn't ship an image.
 */

import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'THROTTLEIN — Bike Helmets, Gear & Parts Marketplace';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background:
            'linear-gradient(135deg, #141414 0%, #1f1f1f 60%, #2a2a2a 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '80px 100px',
          color: '#fff',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* THROTTLEIN wordmark — rendered as styled text since web fonts
            inside @vercel/og need explicit loading; system font keeps
            the asset light. */}
        <div
          style={{
            fontSize: 56,
            fontWeight: 800,
            letterSpacing: -2,
            color: '#BDFF00', // brand-lime — reserved for the wordmark
            marginBottom: 24,
          }}
        >
          THROTTLEIN
        </div>

        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: -1.5,
            maxWidth: 900,
          }}
        >
          Helmets, gear &amp; parts for every ride.
        </div>

        <div
          style={{
            marginTop: 32,
            fontSize: 28,
            color: '#c5c5c5',
            letterSpacing: 0.2,
          }}
        >
          India&apos;s marketplace for motorcycle riders.
        </div>

        {/* Bottom-right ribbon */}
        <div
          style={{
            position: 'absolute',
            bottom: 60,
            right: 100,
            fontSize: 22,
            color: '#9a9a9a',
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}
        >
          throttlein.com
        </div>
      </div>
    ),
    { ...size }
  );
}
