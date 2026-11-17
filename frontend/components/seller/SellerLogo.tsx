'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { sellerUrl } from '@/lib/sellerUrl';

/**
 * SELLER HUB lockup — the seller property's own mark.
 *
 * Deliberately NOT the `Wordmark` component. The seller subdomain uses a
 * different logo from the storefront: a lime "SELLER" + black "HUB"
 * lockup with THROTTLEIN set underneath, at a ~3.5:1 ratio rather than
 * the storefront wordmark's ~4.1:1. Reusing `Wordmark` here and swapping
 * the `src` would have meant carrying the wrong aspect ratio and the
 * wrong text fallback.
 *
 * Asset: /images/seller-hub-logo.webp (exported from Figma node
 * 4583:9563, native 465×133).
 */
const LOGO_SRC = '/images/seller-hub-logo.webp';
const LOGO_NATIVE_W = 465;
const LOGO_NATIVE_H = 133;
const LOGO_RATIO = LOGO_NATIVE_W / LOGO_NATIVE_H; // ≈ 3.496

export default function SellerLogo({
  /** Defaults to the seller property's own root, not the storefront's —
   *  clicking the logo on seller.throttlein.com should stay on the
   *  seller site. */
  href = sellerUrl('/'),
  height = 33,
}: {
  href?: string | null;
  /** Rendered height in px. Width derives from the logo's aspect ratio,
   *  so the two are never set independently and can't skew. */
  height?: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const renderedWidth = Math.round(height * LOGO_RATIO);

  const inner = (
    <span className="flex items-center">
      {!imgFailed ? (
        <Image
          src={LOGO_SRC}
          alt="THROTTLEIN Seller Hub"
          width={renderedWidth}
          height={height}
          priority
          onError={() => setImgFailed(true)}
          style={{ height, width: renderedWidth }}
          className="object-contain"
        />
      ) : (
        // Text fallback mirrors the lockup's two-tone treatment so a
        // failed image still reads as the seller brand rather than the
        // storefront one.
        <span
          className="wordmark leading-none text-brand-black"
          style={{ fontSize: height * 0.5 }}
        >
          <span className="text-[#8FBF00]">SELLER</span>
          <span> HUB</span>
        </span>
      )}
    </span>
  );

  return href ? (
    <Link href={href} aria-label="THROTTLEIN Seller Hub home">
      {inner}
    </Link>
  ) : (
    inner
  );
}
