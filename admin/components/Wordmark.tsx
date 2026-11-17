'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';

const LOGO_SRC = '/images/throttlein-logo.webp';
const LOGO_NATIVE_W = 2600;
const LOGO_NATIVE_H = 635;
const LOGO_RATIO = LOGO_NATIVE_W / LOGO_NATIVE_H;

export default function Wordmark({
  href = '/',
  variant = 'light',
  height = 36,
}: {
  href?: string | null;
  variant?: 'light' | 'dark';
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
          /* No filter for the dark variant: the art is a BLACK badge with
             knocked-out white letters and the lime dot, so on dark chrome
             the badge melts into the background and the letters carry it.
             (An invert/brightness flatten was tried and destroys the
             letterforms — the alpha channel covers the whole badge.) */
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
