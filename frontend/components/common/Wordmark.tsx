'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';

/**
 * THROTTLEIN brand wordmark.
 * Renders /images/throttlein-logo.webp with the correct ~4.1:1 aspect ratio.
 * Falls back to a styled text wordmark if the image fails to load.
 */
const LOGO_SRC = '/images/throttlein-logo.webp';
const LOGO_NATIVE_W = 2600;
const LOGO_NATIVE_H = 635;
const LOGO_RATIO = LOGO_NATIVE_W / LOGO_NATIVE_H; // ≈ 4.094

export default function Wordmark({
  href = '/',
  variant = 'light',
  height = 36,
}: {
  href?: string | null;
  variant?: 'light' | 'dark';
  /** Rendered height in px. Width derives from the logo aspect ratio. */
  height?: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const txt = variant === 'dark' ? 'text-brand-cream' : 'text-brand-black';
  const renderedWidth = Math.round(height * LOGO_RATIO);

  const inner = (
    <span className="flex items-center">
      {!imgFailed ? (
        <Image
          src={LOGO_SRC}
          alt="THROTTLEIN"
          width={renderedWidth}
          height={height}
          priority
          onError={() => setImgFailed(true)}
          style={{ height, width: renderedWidth }}
          className="object-contain"
        />
      ) : (
        <span className={`wordmark ${txt}`} style={{ fontSize: height * 0.85 }}>
          THROT<span className="text-brand-lime">●</span>LEIN
        </span>
      )}
    </span>
  );

  return href ? (
    <Link href={href} aria-label="THROTTLEIN home">
      {inner}
    </Link>
  ) : (
    inner
  );
}
