'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { imageUrl } from '@/lib/api';
import { customerApi } from '@/lib/customerApi';
import { getStoredCustomer } from '@/lib/customerAuth';
import { getWishlistIds, invalidateWishlist } from '@/lib/wishlist';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';

export type Product = {
  _id: string;
  // Backend product slug (when populated). Used to build cleaner
  // `/product/<slug>` URLs; falls back to `_id` when missing.
  slug?: string;
  name: string;
  brand?: string | { _id: string; name: string; slug?: string } | null;
  category?: string | { _id: string; name: string; slug?: string };
  bike?: string | { _id: string; name: string; slug?: string } | null;
  price: number;
  mrp?: number;
  discountPercent?: number;
  rating?: number;
  reviewsCount?: number;
  images?: string[];
  listingImage?: string;
  sizes?: string[];
  colorImages?: Array<{ color: string; images: string[] }>;
  variants?: Array<{ size?: string; color?: string; stock?: number }>;
  stock?: number;
  isFeatured?: boolean;
  seller?: { _id: string; name: string; storeName?: string };
};

function categoryName(c: Product['category']): string {
  if (!c) return '';
  return typeof c === 'string' ? c : c.name;
}

function brandName(b: Product['brand']): string {
  if (!b) return '';
  return typeof b === 'string' ? b : b.name;
}

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

/* product card used on the home page, listings and rails */
/**
 * `priority` — true for cards in the first visible row of a grid. Next
 * then preloads the image and drops lazy-loading, which is what it asks
 * for when one of these becomes the page's Largest Contentful Paint
 * ("add loading=eager if this image is above the fold"). Callers pass it
 * for the first row only; every other card stays lazy.
 */
export default function ProductCard({ product, priority = false }: { product: Product; priority?: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [wishlisted, setWishlisted] = useState(false);
  const [wishlistBusy, setWishlistBusy] = useState(false);
  // Hover state so the heart icon fills with the same pink gradient on
  // hover as it does once actually saved — pure CSS group-hover couldn't
  // reference the per-card gradient's dynamic `product._id`-scoped id.
  const [heartHover, setHeartHover] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [notified, setNotified] = useState(false);

  // Pre-fill wishlisted state from the customer's saved list (shared
  // cache — see lib/wishlist.ts) so the heart renders filled by default
  // wherever this card shows up, not just after toggling it in this
  // session. Re-checks on `wishlist:changed` (fired by any card, or the
  // PDP, after an add/remove) so every card showing this same product
  // updates together.
  useEffect(() => {
    let alive = true;
    function refresh() {
      getWishlistIds().then((ids) => {
        if (alive) setWishlisted(ids.has(product._id));
      });
    }
    refresh();
    window.addEventListener('wishlist:changed', refresh);
    return () => {
      alive = false;
      window.removeEventListener('wishlist:changed', refresh);
    };
  }, [product._id]);

  // Prefer the backend-derived `listingImage` when present — it already
  // handles the fallback chain (listingColor → first color-with-photos →
  // product.images[0]). Legacy responses that don't populate it fall
  // back to raw `images[0]`, then to any populated colorImages entry.
  const img =
    product.listingImage ||
    product.images?.[0] ||
    (Array.isArray((product as any).colorImages)
      ? ((product as any).colorImages).find(
          (c: any) => Array.isArray(c?.images) && c.images.length,
        )?.images?.[0]
      : undefined);
  const hasDiscount = !!(product.mrp && product.mrp > product.price);
  const discount =
    product.discountPercent ??
    (hasDiscount && product.mrp
      ? Math.round(((product.mrp - product.price) / product.mrp) * 100)
      : 0);
  const outOfStock = (product.stock ?? 1) === 0;
  const rating = product.rating ?? 0;

  // Prefer the slug — falling back to the raw ObjectId leaks an
  // internal identifier into the public URL (and into the index when
  // crawled). Products without a slug shouldn't be reachable at all,
  // so when one's missing we noop the link rather than ship the id.
  // URL: /product/<catalog-slug>?id=<productId>. Shared catalog slug
  // for all sellers of the same product; per-seller productId in ?id.
  const slugForUrl = (product as any).catalog?.slug || product.slug;
  const detailHref = slugForUrl ? `/product/${slugForUrl}?id=${product._id}` : '#';

  // Only redirect to the PDP when the product actually needs a variant
  // pick — same detection ProductDetailPage.tsx uses (validateVariantSelection):
  // size is required when `sizes[]` is non-empty; colour is required when
  // any colorImages entry or variant row carries a non-empty colour. If
  // neither applies there's nothing to choose, so the card can safely
  // add it straight to the cart instead of bouncing the shopper to the
  // PDP for no reason.
  const needsSize = (product.sizes?.length || 0) > 0;
  const needsColor = (() => {
    const names = new Set<string>();
    for (const ci of product.colorImages || []) {
      const n = String(ci?.color || '').trim();
      if (n) names.add(n);
    }
    for (const v of product.variants || []) {
      const n = String(v?.color || '').trim();
      if (n) names.add(n);
    }
    return names.size > 0;
  })();
  const needsVariant = needsSize || needsColor;

  // Add-to-cart from the card: adds directly (no variant to pick) or
  // REDIRECTS to the product detail page so the shopper can choose a
  // size/colour first — direct-add was quietly saving the first variant
  // regardless of what the shopper intended, so the wrong SKU could end
  // up in the cart. Stops propagation so we don't also fire the outer
  // <Link>'s click handler.
  async function handleAddToCart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (outOfStock) return;
    if (detailHref === '#') return; // safety: no valid slug yet
    if (needsVariant) {
      router.push(detailHref);
      return;
    }
    if (adding) return;
    if (!getStoredCustomer()) {
      router.push(`/signin?returnTo=${encodeURIComponent(detailHref)}`);
      return;
    }
    setAdding(true);
    try {
      await customerApi.post('/cart', { productId: product._id, quantity: 1 });
      window.dispatchEvent(new Event('cart:changed'));
      notifySuccess(M.productCard.addedToCart);
    } catch (err: any) {
      notifyError(err, M.productCard.couldntAddToCart);
    } finally {
      setAdding(false);
    }
  }

  // "Notify me" — same sign-in gate as the other CTAs; POSTs the
  // restock-notify request (see backend notifyController.create) and
  // leaves a "We'll notify you" confirmation on the button.
  async function handleNotifyMe(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (notifying) return;
    if (!getStoredCustomer()) {
      router.push(`/signin?returnTo=${encodeURIComponent(detailHref)}`);
      return;
    }
    setNotifying(true);
    try {
      await customerApi.post('/notify-me', { productId: product._id });
      setNotified(true);
      notifySuccess(M.productCard.wellNotifyYouWhenThisItemIs);
    } catch (err: any) {
      notifyError(err, M.productCard.thatDidntWork);
    } finally {
      setNotifying(false);
    }
  }

  // Same wishlist toggle flow as the product detail page (sign-in gate,
  // POST/DELETE /wishlist, toast feedback). Stops propagation so it
  // doesn't also trigger the card's <Link> navigation.
  async function toggleWishlist(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (wishlistBusy) return;
    if (!getStoredCustomer()) {
      router.push(`/signin?returnTo=${encodeURIComponent(detailHref)}`);
      return;
    }
    setWishlistBusy(true);
    try {
      if (wishlisted) {
        await customerApi.delete(`/wishlist/${product._id}`);
        setWishlisted(false);
        notifySuccess(M.productCard.removedFromWishlist);
      } else {
        await customerApi.post('/wishlist', { productId: product._id });
        setWishlisted(true);
        notifySuccess(M.productCard.savedToWishlist);
      }
      // Bust the shared cache + tell every other card/navbar to re-check.
      invalidateWishlist();
    } catch (err: any) {
      notifyError(err, M.productCard.thatDidntWork);
    } finally {
      setWishlistBusy(false);
    }
  }

  return (
    <Link href={detailHref} className="group h-full block">
      <article className="h-full flex flex-col p-2 rounded-xl bg-white overflow-hidden transition-all duration-300 hover:shadow-[0_4px_4px_0_rgba(0,0,0,0.25)] hover-bg-white ">
        {/* ───── IMAGE AREA ───── */}
        <div className="relative  rounded-xl aspect-square bg-gradient-to-br from-default-50 to-default-100 overflow-hidden">
          {/* discount ribbon */}
          {hasDiscount && discount > 0 && (
            <div className="absolute transition-opacity duration-300 ease-out opacity-100 lg:opacity-0 lg:group-hover:opacity-100 top-2 left-2 z-10 text-black px-2 py-1.5 rounded-md text-sm font-semibold" style={{ background: 'linear-gradient(0deg, #D4FA00 0%, #D4FA00 100%), var(--fill-brand-active, #AAD900)' }}>
              {discount}% OFF
            </div>
          )}

          {/* featured badge */}
          {product.isFeatured && (
            <div className="absolute top-3 right-3 z-10 bg-amber-400 text-amber-950 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider shadow-md ring-2 ring-amber-200/70">
              ★ Featured
            </div>
          )}

          {/* out-of-stock overlay */}
          {outOfStock && (
            <div className="absolute inset-0 z-10 bg-white/70 grid place-items-center backdrop-blur-[1px]">
              <span className="px-3 py-1 bg-brand-black text-brand-cream text-xs uppercase tracking-widest font-bold rounded-full">
                Out of stock
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={toggleWishlist}
            onMouseEnter={() => setHeartHover(true)}
            onMouseLeave={() => setHeartHover(false)}
            disabled={wishlistBusy}
            aria-label={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
            aria-pressed={wishlisted}
            className={`group/heart absolute top-2 right-2 z-20 w-12 h-12 transition-opacity duration-300 ease-out ${wishlisted ? 'opacity-100' : 'opacity-100 lg:opacity-0 lg:group-hover:opacity-100'
              } ${wishlistBusy ? 'opacity-60 cursor-wait' : ''}`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 60 60"
              className="w-full h-full"
            >
              <g filter={`url(#pc-heart-shadow-${product._id})`}>
                <rect x="8" y="6" width="44" height="44" rx="22" fill="#F7F7F7" />

                <path
                  d="M30 40L28.26 38.2736C22.08 32.1657 18 28.1373 18 23.1935C18 19.1651 20.904 16 24.6 16C26.688 16 28.692 17.0594 30 18.7335C31.308 17.0594 33.312 16 35.4 16C39.096 16 42 19.1651 42 23.1935C42 28.1373 37.92 32.1657 31.74 38.2866L30 40Z"
                  stroke={wishlisted || heartHover ? `url(#pc-heart-gradient-${product._id})` : '#9CA3AF'}
                  strokeWidth="2"
                  fill={wishlisted || heartHover ? `url(#pc-heart-gradient-${product._id})` : 'none'}
                  className="transition-all duration-300"
                />
              </g>

              <defs>
                <linearGradient
                  id={`pc-heart-gradient-${product._id}`}
                  x1="18"
                  y1="28"
                  x2="42"
                  y2="28"
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor="#FF3D68" />
                  <stop offset="100%" stopColor="#FF7A9C" />
                </linearGradient>

                <filter
                  id={`pc-heart-shadow-${product._id}`}
                  x="0"
                  y="0"
                  width="60"
                  height="60"
                  filterUnits="userSpaceOnUse"
                  colorInterpolationFilters="sRGB"
                >
                  <feFlood floodOpacity="0" result="BackgroundImageFix" />
                  <feColorMatrix
                    in="SourceAlpha"
                    type="matrix"
                    values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                    result="hardAlpha"
                  />
                  <feOffset dy="2" />
                  <feGaussianBlur stdDeviation="4" />
                  <feColorMatrix
                    type="matrix"
                    values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.12 0"
                  />
                  <feBlend
                    mode="normal"
                    in2="BackgroundImageFix"
                    result="effect1_dropShadow_3182_285"
                  />
                  <feBlend
                    mode="normal"
                    in="SourceGraphic"
                    in2="effect1_dropShadow_3182_285"
                    result="shape"
                  />
                  <feColorMatrix
                    in="SourceAlpha"
                    type="matrix"
                    values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                    result="hardAlpha"
                  />
                  <feOffset dy="-2" />
                  <feGaussianBlur stdDeviation="1.3" />
                  <feComposite
                    in2="hardAlpha"
                    operator="arithmetic"
                    k2="-1"
                    k3="1"
                  />
                  <feColorMatrix
                    type="matrix"
                    values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"
                  />
                  <feBlend
                    mode="normal"
                    in2="shape"
                    result="effect2_innerShadow_3182_285"
                  />
                </filter>
              </defs>
            </svg>
          </button>

          {img ? (
        
            <div className="absolute inset-0">
              <div className="relative w-full h-full">
                <Image
                  src={imageUrl(img)}
                  alt={product.name}
                  fill
                  sizes="(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 50vw"
                  className="object-contain mix-blend-multiply"
                  priority={priority}
                />
              </div>
            </div>
          ) : (
            <div className="w-full h-full grid place-items-center text-default-400 text-xs uppercase tracking-widest">
              No image
            </div>
          )}
        </div>

        {/* ───── INFO AREA ───── */}
        <div className="flex-1 flex flex-col p-3 sm:p-4 !pb-0">
          

          {/* Name */}
          <h3 className="font-semibold text-base leading-[1.52] line-clamp-2 text-brand-black min-h-[2.5em] lg:group-hover:text-brand-700 transition">
            {product.name}
          </h3>


          {/* Price block */}
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            <span className="text-base font-extrabold text-brand-black leading-[1.52]">
              ₹{inr(product.price)}
            </span>
            {hasDiscount && (
              <>
                <span className="text-sm text-default-400 line-through leading-none">
                  ₹{inr(product.mrp!)}
                </span>
                <span className="text-[11px] font-bold text-[#2E7D32] leading-none">
                  Save ₹{inr((product.mrp ?? 0) - product.price)}
                </span>
              </>
            )}
          </div>

        </div>
        <div className={`mt-4 px-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity duration-300 ease-out ${outOfStock ? 'pointer-events-auto' : ''}`}>
          <button
            type="button"
            onClick={outOfStock ? handleNotifyMe : handleAddToCart}
            disabled={outOfStock ? notifying : adding}
            className="w-full h-9 rounded-lg bg-brand-black text-white text-xs font-semibold h-10  hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {outOfStock
              ? notifying
                ? 'Notifying…'
                : notified
                  ? "We'll notify you"
                  : 'Notify me'
              : adding
                ? 'Adding…'
                : 'Add to cart'}
          </button>
        </div>
      </article>
    </Link>
  );
}
