'use client';

/**
 * Root error boundary. Catches errors that escape the segment-level
 * `app/error.tsx` — which happens when something in the root layout
 * (Navbar, Footer, Providers) throws during render or hydration. Because
 * the root layout itself is broken at that point we have to render our
 * own <html>/<body> here.
 *
 * Keep this file deliberately minimal — no Tailwind classes that depend
 * on the Providers tree, no client-only hooks beyond what Next requires.
 * The goal is "always renderable, even when everything else is on fire."
 */

import { useEffect } from 'react';
import { reloadIfRecoverable, reportClientError } from '@/lib/errorRecovery';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[global error boundary]', error);
    reportClientError(error, 'global');
    reloadIfRecoverable(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          background: '#f4f4f0',
          color: '#0a0a0a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: 460, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: 14,
              color: '#5a5a5a',
              lineHeight: 1.6,
              marginBottom: 20,
            }}
          >
            The page failed to load. Please try again — if it keeps
            happening, contact support@throttlein.com.
          </p>
          <div
            style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              // A full reload, not reset(): re-rendering the broken root
              // layout in place did nothing (a "dead click" in Clarity).
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 20px',
                borderRadius: 12,
                background: '#0a0a0a',
                color: '#fff',
                fontWeight: 600,
                fontSize: 14,
                border: 0,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                padding: '10px 20px',
                borderRadius: 12,
                border: '1px solid #d4d4d4',
                color: '#0a0a0a',
                fontWeight: 600,
                fontSize: 14,
                textDecoration: 'none',
              }}
            >
              Back to home
            </a>
          </div>
          {error?.digest && (
            <p
              style={{
                marginTop: 20,
                fontSize: 11,
                color: '#9a9a9a',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
            >
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
