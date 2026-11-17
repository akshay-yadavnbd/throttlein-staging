'use client';

/**
 * Product detail page — `/product/<slug>`.
 *
 * Layout follows the Figma design (node 3152-2629):
 *  1. Breadcrumb strip with bottom divider
 *  2. Two-column hero — image gallery (vertical thumbs + main) + product info
 *     (brand, title, price, rating, size, qty, Add to cart, Buy now,
 *      delivery check, trust badges, sold-by)
 *  3. Description / Specifications tabs (underlined Figma style)
 *  4. "Customers also bought" rail (4-up)
 *  5. Waterproof feature highlight (image + text)
 *  6. Customer reviews (rating summary + reviews list)
 *
 * Multi-seller picker has been removed — we always use the cheapest
 * in-stock offer. All other behaviour kept intact: addToCart / buyNow /
 * addToWishlist, size validation, signed-in gating, delivery-rate widget.
 */

import { use, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner, Chip, Button, Tabs, Tab, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Textarea } from '@heroui/react';
import { ChevronDownIcon } from '@heroui/shared-icons';
import { api, imageUrl, unwrap, envelopeOrLegacy } from '@/lib/api';
import { customerApi } from '@/lib/customerApi';
import { getStoredCustomer } from '@/lib/customerAuth';
import { invalidateWishlist } from '@/lib/wishlist';
import ProductCard, { type Product as ListingProduct } from '@/components/common/ProductCard';
import RichTextView from '@/components/common/RichTextView';
import { ProductDetailSkeleton } from '@/components/common/PageSkeletons';
import { nameToSlug } from '@/lib/categorySlug';
import { Swiper, SwiperSlide } from 'swiper/react';
import type { Swiper as SwiperType } from 'swiper';
import 'swiper/css';
import { notifyError, notifySuccess, notifyWarning, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';

function ChevronLeftIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
function ChevronRightIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
/* Magnifier-with-plus shown on gallery tiles on hover — signals that
   clicking opens the full-size image lightbox (Myntra-style). */
function ZoomInIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

type CategoryRef = { _id: string; name: string; slug?: string } | string | null | undefined;

type Product = {
  _id: string;
  name: string;
  brand?: CategoryRef;
  category?: CategoryRef;
  bike?: CategoryRef;
  description?: string;
  price: number;
  mrp?: number;
  discountPercent?: number;
  stock: number;
  images?: string[];
  listingImage?: string;
  colorImages?: Array<{ color: string; images: string[] }>;
  rating?: number;
  reviewsCount?: number;
  sizes?: string[];
  // Optional measurement / fit chart image. Rendered as a "View size
  // chart" link right by the size selector.
  sizeChartImage?: string;
  // Optional Amazon-style A+ marketing images (up to 3) rendered below
  // the "Customers also viewed" rail. Slot positions: [0]=top-left,
  // [1]=top-right, [2]=bottom-wide. Empty entries ('') mark unused slots.
  aPlusImages?: string[];
  seller?: {
    _id: string;
    name: string;
    storeName?: string;
    email?: string;
    phone?: string;
    // Seller-profile defaults; per-product overrides live on the
    // product itself below and take precedence when present.
    returnPolicyDays?: number;
    exchangePolicyDays?: number;
  };
  // Per-product overrides — null / undefined = fall back to
  // seller.returnPolicyDays / seller.exchangePolicyDays.
  returnPolicyDays?: number | null;
  exchangePolicyDays?: number | null;
};

// One seller's offer (from /api/products/:slug — single offer per product).
type Offer = {
  _id: string;
  sellerId?: string;
  storeName?: string;
  price: number;
  mrp?: number;
  stock: number;
  sku?: string;
};

// Shared catalog product (brand-level). Price/stock/seller come from offers.
type Catalog = {
  _id: string;
  name: string;
  slug?: string;
  brand?: CategoryRef;
  category?: CategoryRef;
  bike?: CategoryRef;
  description?: string;
  mrp?: number;
  images?: string[];
  listingImage?: string;
  colorImages?: Array<{ color: string; images: string[] }>;
  rating?: number;
  reviewsCount?: number;
  sizes?: string[];
  sizeChartImage?: string;
};

/** Render a brand/category/bike reference as a human label. The backend
 *  sometimes returns just an ObjectId string when the route forgot to
 *  populate — treat 24-char hex as "not populated" so the UI doesn't
 *  leak the raw id. */
function refName(c: CategoryRef): string {
  if (!c) return '';
  if (typeof c === 'string') return /^[a-f0-9]{24}$/i.test(c) ? '' : c;
  return c.name || '';
}
function refSlug(c: CategoryRef): string {
  if (!c || typeof c === 'string') return '';
  return c.slug || nameToSlug(c.name || '');
}

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

export default function ProductDetailPage({
  params,
  initialCatalog = null,
  initialOffers = [],
}: {
  params: Promise<{ slug: string }>;
  // SSR-fetched catalog + offers from the server page.tsx so the H1,
  // price, images, description, and breadcrumb name appear in the initial
  // HTML. Crawlers/View Source see real content immediately instead of the
  // loading skeleton.
  initialCatalog?: Catalog | null;
  initialOffers?: Offer[];
}) {
  const { slug } = use(params);
  const router = useRouter();
  const [catalog, setCatalog] = useState<Catalog | null>(initialCatalog);
  const [offers, setOffers] = useState<Offer[]>(initialOffers || []);
  // URL pattern: /product/<catalog-slug>?id=<productId>. Read the
  // `id` query param (individual seller's product record ID) to
  // pre-select the referred seller in the picker. Falls through to
  // the cheapest in-stock offer when no match.
  const searchParams = useSearchParams();
  const refProductId = searchParams?.get('id') || '';
  const pickDefaultOffer = (list: Offer[], preferId = ''): string => {
    if (preferId && list.some((o) => o._id === preferId)) return preferId;
    const inStock = list.find((o) => (o.stock ?? 0) > 0);
    return (inStock || list[0])?._id || '';
  };
  const [selectedOfferId, setSelectedOfferId] = useState<string>(
    pickDefaultOffer(initialOffers || [], refProductId)
  );
  // `loading` is false when we already have an SSR catalog so the skeleton
  // doesn't flash on top of real content during the hydration refetch.
  const [loading, setLoading] = useState<boolean>(!initialCatalog);
  const [activeImg, setActiveImg] = useState(0);
  // Gallery lightbox — clicking any gallery tile opens the full-screen
  // viewer starting on that image. `activeImg` doubles as the current
  // lightbox slide index. `galleryLenRef` mirrors galleryImages.length
  // (set during render, after it's computed) so the keyboard-nav effect
  // below can clamp without depending on a value declared later.
  const [isGalleryLightboxOpen, setIsGalleryLightboxOpen] = useState(false);
  const galleryLenRef = useRef(0);
  // Mobile gallery carousel — tracks the visible slide so the segmented
  // progress indicator under the swiper can highlight the current image.
  const [mobileImgIdx, setMobileImgIdx] = useState(0);
  const colourSwiperRef = useRef<SwiperType | null>(null);
  // Tracks whether the colour swiper is scrolled to its start/end so the
  // prev/next nav buttons can hide themselves at each edge — previous is
  // hidden by default (we start at the beginning), next hides once the
  // last swatch is reached.
  const [colourAtStart, setColourAtStart] = useState(true);
  const [colourAtEnd, setColourAtEnd] = useState(false);
  // Sticky top bar mirrors the main Add to Cart row and fades in once that
  // row scrolls out of view, so the CTA stays reachable while scrolling.
  const addToCartRowRef = useRef<HTMLDivElement>(null);
  const [showStickyBar, setShowStickyBar] = useState(false);
  const [selectedSize, setSelectedSize] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [sizeError, setSizeError] = useState<string>('');
  // Selected color for the variant picker. Defaults to '' (no
  // selection) — the effect below auto-picks the first available
  // color once the product data lands.
  const [selectedColor, setSelectedColor] = useState<string>('');
  // Colour selection error — populated when the shopper tries to add
  // a variant product to cart without picking a colour.
  const [colorError, setColorError] = useState<string>('');
  const [discountRemoved, setDiscountRemoved] = useState<boolean>(false);
  // Coupon-input state — populated when the user has clicked Remove on
  // the offer card and is typing the code back in. When the typed value
  // matches the linked SellerOffer title (case-insensitive), Apply is
  // enabled and re-applies the discount visually.
  const [couponInput, setCouponInput] = useState<string>('');
  const [couponError, setCouponError] = useState<string>('');
  const [notified, setNotified] = useState<boolean>(false);
  const [busy, setBusy] = useState<'cart' | 'wishlist' | null>(null);
  const [wishlisted, setWishlisted] = useState(false);
  // Hover state so the heart icon fills with the same pink gradient on
  // hover as it does once actually saved.
  const [heartHover, setHeartHover] = useState(false);
  const [isDescriptionOpen, setIsDescriptionOpen] = useState(true);
  // Separate from isDescriptionOpen (which fully collapses the section
  // via the chevron) — this just clamps the description text to ~5
  // lines with an inline "Learn more" fade, expanding to the full text.
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isSpecificationsOpen, setIsSpecificationsOpen] = useState(true);
  // Size chart modal — opens inline over the PDP instead of blowing the
  // image out into a new browser tab, so shoppers don't lose their place.
  const [isSizeChartOpen, setIsSizeChartOpen] = useState(false);

  // Real reviews fetched from the backend. The product's stored
  // `rating` and `reviewsCount` come from the product itself; the
  // detailed list + per-rating distribution come from /reviews.
  const [reviews, setReviews] = useState<any[]>([]);
  const [distribution, setDistribution] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  const [reviewsLoading, setReviewsLoading] = useState(true);

  // Selected seller offer — still stored in state for the cart API call
  // (it accepts an offer id), but no longer user-selectable.
  const selectedOffer: Offer | null =
    offers.find((o) => o._id === selectedOfferId) || offers[0] || null;

  // Synthesize the product-shaped object the rest of the page renders from:
  // brand-level fields come from the catalog, price/stock/seller from the
  // chosen offer.
  const fallbackCatalogImages =
    catalog?.images && catalog.images.length > 0
      ? catalog.images
      : catalog?.listingImage
        ? [catalog.listingImage]
        : catalog?.colorImages?.find((entry) => entry.images?.length)?.images || [];

  const product: Product | null = catalog
    ? {
      _id: catalog._id,
      name: catalog.name,
      brand: catalog.brand,
      category: catalog.category,
      bike: catalog.bike,
      description: catalog.description,
      images: catalog.images,
      sizes: catalog.sizes,
      rating: catalog.rating,
      reviewsCount: catalog.reviewsCount,
      price: selectedOffer?.price ?? catalog.mrp ?? 0,
      mrp: selectedOffer?.mrp ?? catalog.mrp,
      stock: selectedOffer?.stock ?? 0,
      // Per-product return/exchange overrides — flow through so the
      // policy block below can prefer them over the seller defaults.
      returnPolicyDays: (catalog as any).returnPolicyDays,
      exchangePolicyDays: (catalog as any).exchangePolicyDays,
      seller: selectedOffer
        ? {
          _id: selectedOffer.sellerId || '',
          name: selectedOffer.storeName || '',
          storeName: selectedOffer.storeName,
          // Seller-profile default windows for the return-policy block.
          returnPolicyDays: (selectedOffer as any).returnPolicyDays,
          exchangePolicyDays: (selectedOffer as any).exchangePolicyDays,
        }
        : undefined,
      // Propagate the live SellerOffer decoration the backend attached
      // via resolveOffers. Without this pass-through the UI's activeOffer
      // const at ~line 407 would always be null even when a matching
      // seller-created offer exists — so the "SAVE10 applied!" line would
      // never render.
      activeOffer: (catalog as any).activeOffer ?? null,
      // Variant-related fields — needed by the Colour swatch picker,
      // per-variant stock display, and the A+ Content section at the
      // bottom of the PDP. Without these three lines the seller's
      // colors / variants / marketing images all silently disappear
      // on the storefront even though they're saved in the DB.
      colorImages: (catalog as any).colorImages || [],
      variants: (catalog as any).variants || [],
      aPlusImages: (catalog as any).aPlusImages || [],
      sizeChartImage: (catalog as any).sizeChartImage || '',
      // Seller-configured default color (from the "Product list thumbnail"
      // picker on the ProductForm). Used by the effect below to preselect
      // that colour when the PDP mounts, so first-time shoppers see the
      // marketing-chosen variant instead of the default no-selection state.
      // Empty / 'Auto' → keep behaviour of no auto-selection.
      listingColor: (catalog as any).listingColor || '',
      // Pre-coupon seller selling price. Populated by the backend when
      // an offer applies. When the shopper removes the coupon, the PDP
      // uses this as the displayed price instead of jumping back to
      // MRP (₹83,090 → confusing) vs seller price (₹71,564 → correct).
      originalPrice: (catalog as any).originalPrice ?? null,
    } as any
    : null;

  // Pre-select the seller-chosen default colour once product data lands.
  // The ProductForm's "Product list thumbnail" picker writes to
  // `product.listingColor`. When the seller has picked a real colour (not
  // Auto / empty), we mirror that choice into the PDP's swatch picker so
  // first-time shoppers see the marketing-approved variant preview
  // instead of the "nothing selected" state. Guarded by `!selectedColor`
  // so we NEVER overwrite an active user choice — only fires when the
  // picker is still on its initial empty value. The colour must also
  // actually exist in the product's variant / colorImages universe;
  // otherwise clicking Add to cart would fail the validateVariantSelection
  // check because the "selected" colour has no matching gallery.
  useEffect(() => {
    if (selectedColor) return;
    const raw = String((product as any)?.listingColor || '').trim();
    if (!raw) return;
    const ciList = ((product as any)?.colorImages || []) as Array<{ color?: string; images?: string[] }>;
    const variants = ((product as any)?.variants || []) as Array<{ color?: string }>;
    const known = new Set<string>();
    for (const ci of ciList) {
      const n = String(ci?.color || '').trim();
      if (n) known.add(n);
    }
    for (const v of variants) {
      const n = String(v?.color || '').trim();
      if (n) known.add(n);
    }
    if (known.has(raw)) setSelectedColor(raw);
  }, [(product as any)?._id, (product as any)?.listingColor]);

  // Wishlist is keyed on a STABLE representative offer (the lowest-price one)
  // so the heart doesn't flip when offers change.
  const wishlistOfferId = offers[0]?._id || selectedOffer?._id || '';

  function ensureSignedIn(): boolean {
    if (!getStoredCustomer()) {
      router.push(`/signin?returnTo=/product/${slug}`);
      return false;
    }
    return true;
  }

  // Validate both size AND colour when the product uses variants.
  // Size is required when `product.sizes[]` is non-empty; colour is
  // required when the seller has uploaded any per-colour photos OR
  // any variant rows carry a non-empty `color`. If either is missing,
  // populate the matching inline error, scroll the first offending
  // control into view, and return false so the caller can bail out.
  function validateVariantSelection(): boolean {
    const needsSize = (product?.sizes?.length || 0) > 0;
    const colorImages = ((product as any)?.colorImages || []) as any[];
    const variants = ((product as any)?.variants || []) as any[];
    const availableColors = new Set<string>();
    for (const ci of colorImages) {
      const n = String(ci?.color || '').trim();
      if (n) availableColors.add(n);
    }
    for (const v of variants) {
      const n = String(v?.color || '').trim();
      if (n) availableColors.add(n);
    }
    const needsColor = availableColors.size > 0;

    let missingSize = false;
    let missingColor = false;

    if (needsSize && !selectedSize) {
      setSizeError('Please select a size to continue.');
      missingSize = true;
    } else {
      setSizeError('');
    }
    if (needsColor && !selectedColor) {
      setColorError('Please select a colour to continue.');
      missingColor = true;
    } else {
      setColorError('');
    }

    // Scroll to the first missing selection so the shopper immediately
    // sees which control is asking for input. Size sits above colour
    // in the layout, so size wins the scroll priority when both are
    // missing at once.
    if (missingSize) {
      document.getElementById('size-selector')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (missingColor) {
      document.getElementById('color-selector')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return !(missingSize || missingColor);
  }

  async function addToCart(opts?: { silent?: boolean }) {
    if (!ensureSignedIn()) return false;
    if (!selectedOffer?._id) {
      notifyWarning(M.productDetail.noSellerAvailableForThisProductRight);
      return false;
    }
    if (!validateVariantSelection()) return false;
    setBusy('cart');
    try {
      await customerApi.post('/cart', {
        productId: selectedOffer._id,
        quantity,
        size: selectedSize,
        color: selectedColor,
      });
      // Tell the navbar (and anything else listening) to refresh its
      // cart-count badge so the change shows without a page reload.
      window.dispatchEvent(new Event('cart:changed'));
      if (!opts?.silent) notifySuccess(M.productDetail.addedToCart(quantity));
      return true;
    } catch (e: any) {
      notifyError(e, M.productDetail.thatDidntWork);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function notifyMe() {
    if (!ensureSignedIn()) return;
    if (!selectedOffer?._id) {
      notifyWarning(M.productDetail.noSellerAvailableForThisProductRight);
      return;
    }
    try {
      await customerApi.post('/notify-me', { productId: selectedOffer._id });
      setNotified(true);
      notifySuccess(M.productDetail.wellNotifyYouWhenThisItemIs);
    } catch (e: any) {
      notifyError(e, M.productDetail.thatDidntWork);
    }
  }

  async function buyNow() {
    if (!ensureSignedIn()) return;
    const ok = await addToCart({ silent: true });
    if (ok) router.push('/cart');
  }

  async function toggleWishlist() {
    if (!ensureSignedIn()) return;
    if (!wishlistOfferId) return;
    setBusy('wishlist');
    try {
      if (wishlisted) {
        await customerApi.delete(`/wishlist/${wishlistOfferId}`);
        setWishlisted(false);
        notifySuccess(M.productDetail.removedFromWishlist);
      } else {
        await customerApi.post('/wishlist', { productId: wishlistOfferId });
        setWishlisted(true);
        notifySuccess(M.productDetail.savedToWishlist);
      }
      // Bust the shared wishlist cache + tell every ProductCard (this
      // product may also show in a "related products" rail) and the
      // navbar count badge to re-check.
      invalidateWishlist();
    } catch (e: any) {
      notifyError(e, M.productDetail.thatDidntWork);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    api
      .get(`/products/${slug}`).then(envelopeOrLegacy)
      .then(({ data }) => {
        const p = data.product;
        if (!p) { setCatalog(null); return; }
        setCatalog(p);
        const list: Offer[] = [{
          _id: p._id,
          sellerId: p.seller?._id,
          storeName: p.seller?.storeName || p.seller?.name,
          // Seller-profile defaults for the return-policy block. The
          // synthesized product.seller.*Days above reads these.
          ...(p.seller?.returnPolicyDays !== undefined
            ? { returnPolicyDays: p.seller.returnPolicyDays } as any
            : {}),
          ...(p.seller?.exchangePolicyDays !== undefined
            ? { exchangePolicyDays: p.seller.exchangePolicyDays } as any
            : {}),
          price: p.price,
          mrp: p.mrp,
          stock: p.stock,
          sku: p.sku,
        }];
        setOffers(list);
        setSelectedOfferId((cur) => cur || pickDefaultOffer(list, refProductId));
      })
      .catch(() => setCatalog(null))
      .finally(() => setLoading(false));
  }, [slug]);

  // Fetch the public reviews list + distribution for this product. Pulled
  // out into a named function (rather than only living inline in the
  // effect) so the "Write a review" modal can call it again after a
  // successful submit and have the new review show up immediately.
  function loadReviews() {
    setReviewsLoading(true);
    api
      .get(`/products/${slug}/reviews`).then(envelopeOrLegacy)
      .then(({ data }) => {
        setReviews(data.reviews || []);
        setDistribution(data.distribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
      })
      .catch(() => {
        setReviews([]);
        setDistribution({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
      })
      .finally(() => setReviewsLoading(false));
  }
  useEffect(() => { loadReviews(); }, [slug]);

  // ─── "Write a review" modal state ────────────────────────────────
  const [isWriteReviewOpen, setIsWriteReviewOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewHover, setReviewHover] = useState(0);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  // Optional photos attached to the review. Uploaded immediately on pick
  // (same two-step upload-then-submit flow as the return/exchange evidence
  // uploader) so `reviewImages` holds stored keys/paths ready to send with
  // the final POST /api/reviews call.
  const [reviewImages, setReviewImages] = useState<string[]>([]);
  const [reviewImagesUploading, setReviewImagesUploading] = useState(false);
  function openWriteReview() {
    if (!ensureSignedIn()) return;
    setReviewRating(0);
    setReviewHover(0);
    setReviewTitle('');
    setReviewComment('');
    setReviewImages([]);
    setIsWriteReviewOpen(true);
  }

  async function handleReviewImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (!picked.length) return;
    const remaining = 6 - reviewImages.length;
    if (remaining <= 0) return;
    const toUpload = picked.slice(0, remaining);
    const fd = new FormData();
    toUpload.forEach((f) => fd.append('images', f));
    setReviewImagesUploading(true);
    try {
      const data = unwrap<any>(await customerApi.post('/reviews/uploads/images', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }));
      setReviewImages((prev) => [...prev, ...(data.images || [])].slice(0, 6));
    } catch (e: any) {
      notifyError(e, M.productDetail.couldntUploadPhoto);
    } finally {
      setReviewImagesUploading(false);
    }
  }

  function removeReviewImage(idx: number) {
    setReviewImages((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submitReview() {
    if (reviewRating < 1) {
      notifyWarning(M.productDetail.pleaseSelectARatingFrom1To);
      return;
    }
    if (!reviewComment.trim()) {
      notifyWarning(M.productDetail.pleaseWriteAShortCommentAboutThe);
      return;
    }
    // Guard against submitting while a photo upload is still in flight —
    // without this, hitting "Post review" right after picking photos
    // would send whatever had resolved so far (sometimes just 1 of
    // several picked photos) instead of the full set.
    if (reviewImagesUploading) {
      notifyWarning(M.productDetail.pleaseWaitForYourPhotosToFinish);
      return;
    }
    const productId = selectedOffer?._id;
    if (!productId) {
      notifyWarning(M.productDetail.noSellerAvailableForThisProductRight);
      return;
    }
    setReviewSaving(true);
    try {
      await customerApi.post('/reviews', {
        productId,
        rating: reviewRating,
        title: reviewTitle.trim(),
        comment: reviewComment.trim(),
        images: reviewImages,
      });
      notifySuccess(M.productDetail.thanksForYourReview);
      setIsWriteReviewOpen(false);
      loadReviews();
    } catch (e: any) {
      notifyError(e, M.productDetail.couldntSaveReview);
    } finally {
      setReviewSaving(false);
    }
  }

  // Pre-fill wishlisted state from the customer's saved list.
  useEffect(() => {
    if (!wishlistOfferId || !getStoredCustomer()) return;
    customerApi
      .get('/wishlist')
      .then((r) => {
        const ids = (unwrap<{ wishlist?: { products?: any[] } }>(r).wishlist?.products || []).map((p: any) => (typeof p === 'string' ? p : p?._id));
        setWishlisted(ids.includes(wishlistOfferId));
      })
      .catch(() => { });
  }, [wishlistOfferId]);

  // Show the sticky top bar once the main Add to Cart row scrolls out of view.
  useEffect(() => {
    const el = addToCartRowRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowStickyBar(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [product?._id]);

  // NOTE: no default color is auto-selected on mount. The shopper picks a
  // color manually — until they do, the gallery falls back to
  // `product.images` and the price stays on the product's base price.

  // Lightbox keyboard nav — ←/→ move between images while it's open.
  // Escape is handled by the HeroUI Modal itself. Must live ABOVE the
  // loading/not-found early returns (rules of hooks).
  useEffect(() => {
    if (!isGalleryLightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setActiveImg((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') {
        setActiveImg((i) => Math.min(galleryLenRef.current - 1, i + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isGalleryLightboxOpen]);

  if (loading) {
    return <ProductDetailSkeleton />;
  }
  if (!product) {
    return <div className="p-12 text-center text-default-500">Product not found.</div>;
  }

  // Seller's live SellerOffer (Phase 2). Backend resolveOffers attaches
  // this field when an offer is active for THIS product. When present,
  // the Special Offer card below shows the offer title + a matching chip
  // and an "Ends on …" line instead of the generic copy.
  const activeOffer: any = (product as any).activeOffer || null;
  const offerEndsLabel = (() => {
    if (!activeOffer || !activeOffer.endsAt) return '';
    try {
      const d = new Date(activeOffer.endsAt);
      if (!Number.isFinite(d.getTime())) return '';
      return d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  })();
  const rating = product.rating || 0;
  const reviewsCount = product.reviewsCount || 0;

  // ────────────────────────────────────────────────────────────────
  // Per-variant price resolution. When the seller has entered a
  // `price` (or `mrp`) on a specific size+color combination in the
  // variants matrix, the storefront should reflect THAT number the
  // moment the shopper picks that size + color — not the product's
  // top-level base price.
  //
  // Matching rules:
  //   - Both size + color picked → match on (size, color).
  //   - Only color picked        → match on color, ignore size.
  //   - Only size picked         → match on size, ignore color.
  //   - Neither picked           → no match, use base price.
  //
  // Fields fall back to base when the variant leaves them null.
  // Savings from the active SellerOffer are re-applied on top of
  // the variant price so a coupon still discounts a per-variant
  // price correctly.
  const variantMatch: any = (() => {
    const vs = ((product as any).variants || []) as Array<{
      size?: string;
      color?: string;
      price?: number | null;
      mrp?: number | null;
      stock?: number;
    }>;
    if (!Array.isArray(vs) || vs.length === 0) return null;
    const wantSize = selectedSize.trim();
    const wantColor = selectedColor.trim();
    if (!wantSize && !wantColor) return null;
    return (
      vs.find(
        (v) =>
          (!wantSize || String(v.size || '').trim() === wantSize) &&
          (!wantColor || String(v.color || '').trim() === wantColor),
      ) || null
    );
  })();

  // `product.price` is the offer-adjusted price (from resolveOffers);
  // `product.originalPrice` (when set) is the seller's pre-coupon price.
  const savings = Number(activeOffer?.savings || 0);
  const basePreCouponPrice = Number(
    (product as any).originalPrice ?? product.price ?? 0,
  );
  const variantBasePrice =
    variantMatch && variantMatch.price != null && Number(variantMatch.price) > 0
      ? Number(variantMatch.price)
      : basePreCouponPrice;
  const variantMrp =
    variantMatch && variantMatch.mrp != null && Number(variantMatch.mrp) > 0
      ? Number(variantMatch.mrp)
      : Number(product.mrp || 0);
  // Effective price after coupon: shave off the same offer savings
  // (but never take the number below ₹1).
  const effectivePrice = Math.max(1, Math.round(variantBasePrice - savings));
  const effectiveMrp = Math.max(variantMrp, variantBasePrice);
  const effectiveOriginalPrice = variantBasePrice;

  // Discount flags derived from the EFFECTIVE (variant-aware) numbers,
  // so switching to a variant with a different mrp/price re-derives the
  // strikethrough + percentage automatically.
  const hasDiscount = !!(effectiveMrp && effectiveMrp > effectivePrice);
  const discount = hasDiscount
    ? Math.round(((effectiveMrp - effectivePrice) / effectiveMrp) * 100)
    : 0;

  // Return / exchange policy, derived independently of the discount.
  // Product-level days win; otherwise fall back to the seller's default.
  // Null when neither return nor exchange is offered, which is the only
  // case where the box should be hidden.
  const returnPolicy = (() => {
    const retDays = (product as any).returnPolicyDays ?? product.seller?.returnPolicyDays;
    const excDays = (product as any).exchangePolicyDays ?? product.seller?.exchangePolicyDays;
    const canReturn = (retDays ?? 0) > 0;
    const canExchange = (excDays ?? 0) > 0;
    if (!canReturn && !canExchange) return null;
    const same = canReturn && canExchange && retDays === excDays;
    const heading = same
      ? `${retDays}-Day Easy Return & Exchange`
      : canReturn && canExchange
        ? `${retDays}-day return, ${excDays}-day exchange`
        : canReturn
          ? `${retDays}-Day Easy Return`
          : `${excDays}-Day Easy Exchange`;
    const body = same
      ? `Not satisfied? Return or exchange within ${retDays} days of delivery.`
      : canReturn && canExchange
        ? `Not satisfied? Return within ${retDays} days or exchange within ${excDays} days of delivery.`
        : canReturn
          ? `Not satisfied? Return within ${retDays} days of delivery.`
          : `Not the right fit? Exchange within ${excDays} days of delivery.`;
    return { heading, body };
  })();

  // Rendered in two places — inside the Special Offer card (under a
  // divider, which is how Figma 3731:6453 draws it) when the product is
  // discounted, and in a card of its own when it isn't. Built once here so
  // the two placements can't drift apart.
  //
  // Colours below are measured off the Figma render, not guessed:
  // heading #000, icon stroke #354052, body #424242, link #212121.
  const returnPolicyBlock = returnPolicy ? (
    <div className="flex items-start gap-2">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" className="mt-0.5 shrink-0" aria-hidden>
        <path d="M16.6107 10.8675C16.4534 12.0675 15.9723 13.202 15.2192 14.1493C14.4661 15.0967 13.4693 15.8211 12.3357 16.245C11.2021 16.6689 9.97454 16.7763 8.7846 16.5555C7.59467 16.3347 6.48727 15.7942 5.58118 14.9919C4.67509 14.1897 4.00448 13.1558 3.64128 12.0014C3.27808 10.8469 3.23599 9.6154 3.51952 8.43884C3.80305 7.26228 4.4015 6.1851 5.2507 5.32281C6.0999 4.46053 7.16781 3.84567 8.33989 3.54418C11.5891 2.71085 14.9524 4.38335 16.1941 7.50002M16.6666 3.33334V7.50001H12.4999" stroke="#354052" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="min-w-0">
        <div className="text-[16px] font-semibold text-black leading-[1.52]">{returnPolicy.heading}</div>
        <p className="text-[12px] text-[#424242] mt-2 leading-relaxed">{returnPolicy.body}</p>
        <p className="text-[12px] text-[#424242] mt-2">
          T&amp;C Applied. Read our{' '}
          <Link href="/privacy-policy" className="text-sm ml-1 text-[#212121] underline-offset-2 underline">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  ) : null;

  const outOfStock = variantMatch
    ? Number(variantMatch.stock || 0) <= 0
    : (product.stock ?? 0) <= 0;

  // ────────────────────────────────────────────────────────────────
  // Combination availability. `variantMatch` above only looks at the
  // fields the shopper HAS picked (size-only, colour-only, or both) —
  // when both are picked and no row in `product.variants` has that
  // exact (size, color) pair, `variantMatch` is null and `outOfStock`
  // silently falls back to the product's base stock, which can read
  // as "in stock" even though that pairing was never defined by the
  // seller. `combinationUnavailable` catches that specific case so the
  // CTA can show "This combination not available" instead of a
  // misleading Add to cart / Notify me button.
  const allVariants = ((product as any).variants || []) as Array<{
    size?: string;
    color?: string;
    stock?: number;
  }>;
  const needsSizeForCombo = (product?.sizes?.length || 0) > 0;
  const needsColorForCombo = allVariants.some((v) => String(v?.color || '').trim());
  // Whole-colour availability, computed inline (not via the
  // `isColorOutOfStock` helper below, so this const can be evaluated
  // right here): true when every variant row for the selected colour is
  // sold out.
  const selectedColorRows = allVariants.filter(
    (v) => String(v.color || '').trim() === selectedColor.trim(),
  );
  const selectedColorFullyOOS =
    !!selectedColor.trim() &&
    selectedColorRows.length > 0 &&
    selectedColorRows.every((v) => Number(v.stock || 0) <= 0);
  // True as soon as EITHER of these is true:
  //  - the picked colour is out of stock across every size for it (does
  //    NOT need a size to already be selected — a color swatch shown as
  //    "out of stock" is reason enough on its own), or
  //  - the shopper has made every selection the product requires (size
  //    if it has sizes, color if it has colors) and that exact
  //    combination was never defined by the seller or is sold out.
  // Either way there's nothing to add to cart / notify about, so the
  // CTA swaps to a plain unavailable notice instead of a button.
  const combinationUnavailable =
    (needsSizeForCombo || needsColorForCombo) &&
    allVariants.length > 0 &&
    (selectedColorFullyOOS ||
      ((!needsSizeForCombo || !!selectedSize.trim()) &&
        (!needsColorForCombo || !!selectedColor.trim()) &&
        (!variantMatch || Number(variantMatch.stock || 0) <= 0)));

  // "Colour / Size" label for whichever variant is currently picked —
  // shown in the sticky bar in place of "All Taxes Inc." once that pick
  // is out of stock, so the shopper scrolled down still sees WHICH
  // variant the price above belongs to.
  const selectedVariantLabel = [selectedColor.trim(), selectedSize.trim()]
    .filter(Boolean)
    .join(' / ');

  // Whole-PRODUCT out of stock — distinct from `outOfStock`, which tracks
  // whatever the shopper currently has selected (so it also flips true for
  // a single sold-out variant while OTHER variants are still buyable).
  // This is only true when literally nothing about the product can be
  // bought: no variants at all and the base stock is 0, or every single
  // variant row is sold out. Used to hide the size/color pickers — no
  // point letting the shopper choose among options that are all dead —
  // while still showing them when it's just the current pick that's out
  // (so they can switch to a variant that IS in stock).
  const wholeProductOutOfStock =
    allVariants.length === 0
      ? (product.stock ?? 0) <= 0
      : allVariants.every((v) => Number(v.stock || 0) <= 0);

  // Per-size availability. Scoped to the selected colour when one is
  // picked; otherwise checked across ALL colours for that size, so a
  // size still grays out correctly (e.g. every variant of size "M" is
  // sold out) even before the shopper has picked a colour — including
  // the fully-out-of-stock product, where this returns false for every
  // size instead of the whole selector needing to disappear.
  function isSizeAvailableForSelectedColor(size: string): boolean {
    if (allVariants.length === 0) return true;
    const scopedRows = selectedColor.trim()
      ? allVariants.filter((v) => String(v.color || '').trim() === selectedColor.trim())
      : allVariants;
    if (scopedRows.length === 0) return true; // seller didn't scope this colour by size
    const rowsForSize = scopedRows.filter((v) => String(v.size || '').trim() === size.trim());
    if (rowsForSize.length === 0) return true; // no row scoped to this size — treat as available
    return rowsForSize.some((v) => Number(v.stock || 0) > 0);
  }

  // Whole-colour availability — used on the colour swatch thumbnails to
  // both paint the "Out of stock" overlay AND disable the swatch (the
  // shopper can look, but can't pick a colour with nothing left in it).
  // A colour is "out of stock" only when every variant row carrying
  // that colour is sold out.
  function isColorOutOfStock(color: string): boolean {
    if (allVariants.length === 0) return false;
    const rows = allVariants.filter((v) => String(v.color || '').trim() === color.trim());
    if (rows.length === 0) return false;
    return rows.every((v) => Number(v.stock || 0) <= 0);
  }

  // ────────────────────────────────────────────────────────────────
  // Color-driven gallery. When the shopper has picked a color that
  // has its own uploaded photos (colorImages[i].images), the main
  // image gallery swaps to *that* per-color list. Otherwise it falls
  // back to the seller's shared `images` array. `activeImg` is the
  // index into whichever list is active — reset to 0 by the color
  // swatch onClick handler below, so the first per-color photo is
  // always what the shopper sees when they switch swatches.
  const galleryImages: string[] = (() => {
    const ciList = ((product as any).colorImages || []) as Array<{
      color?: string;
      images?: string[];
    }>;
    const match = ciList.find(
      (c) => String(c?.color || '').trim() === selectedColor,
    );
    if (selectedColor && match && Array.isArray(match.images) && match.images.length > 0) {
      return match.images;
    }
    // No color selected (or the selected one has no photos). Prefer the
    // seller's shared `images` array. If that's empty (e.g. an older
    // variant product where the seller only uploaded per-color images),
    // fall back to the first non-empty per-color bucket so the shopper
    // still sees a hero image instead of the "NO IMAGE" placeholder.
    if (Array.isArray(product.images) && product.images.length > 0) {
      return product.images;
    }
    const firstNonEmpty = ciList.find(
      (c) => Array.isArray(c?.images) && (c.images as string[]).length > 0,
    );
    return firstNonEmpty && Array.isArray(firstNonEmpty.images)
      ? (firstNonEmpty.images as string[])
      : [];
  })();
  const mainGalleryImg =
    galleryImages[activeImg] || galleryImages[0] || '';
  // Render-time ref update — the keyboard-nav effect above the early
  // returns reads this to clamp ←/→ without referencing galleryImages
  // (which is computed after those returns).
  galleryLenRef.current = galleryImages.length;

  return (
    <div className="bg-white min-h-screen">
      {/* BREADCRUMB — full-width strip with #eee bottom border */}
      <div className="border-b border-[#eee]">
        <div className="container py-4">
          <nav className="text-xs text-[#9e9e9e] flex items-center gap-1.5 flex-wrap">
            <Link href="/" className="hover:text-[#1a1410]">Home</Link>
            <span className="text-[#9e9e9e]">/</span>
            {refName(product.category) && (
              <>
                <Link
                  href={`/${refSlug(product.category)}`}
                  className="hover:text-[#1a1410]"
                >
                  {refName(product.category)}
                </Link>
                <span className="text-[#9e9e9e]">/</span>
              </>
            )}
            <span className="text-[#1a1410] font-medium truncate max-w-[50ch]">
              {product.name}
            </span>
          </nav>
        </div>
      </div>
      {/* Sticky add-to-cart bar is hidden entirely whenever the product
          can't be bought right now — either the whole product is out of
          stock, or the shopper's picked size/color combination is out of
          stock / doesn't exist.
          Uses `fixed` (not `sticky`) so it's taken completely out of
          normal document flow — with `sticky`, the bar always reserved
          its py-3 height in the layout even while faded out via opacity,
          which showed up as the page's spacing jumping in and out as
          `showStickyBar` toggled on scroll. `fixed` overlays the page
          instead, so hiding it never affects surrounding spacing. */}
      {!outOfStock && !combinationUnavailable && (
        <div
          className={`fixed inset-x-0 bottom-0 md:top-[77px] md:bottom-auto z-30 bg-white py-3 border-b border-[#eee] transition-all duration-300 ease-out ${showStickyBar
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-2 pointer-events-none'
            }`}
        >
          <div className="container">
            <div className='flex flex-col md:flex-row justify-between gap-2.5'>
              <div className='grid grid-cols-[100px_1fr] md:flex gap-4 items-center'>
                <div className="w-24 h-24 md:aspect-square md:w-12 md:h-12 rounded-lg overflow-hidden relative">
                  {mainGalleryImg ? (
                    <Image
                      src={imageUrl(mainGalleryImg)}
                      alt={product.name}
                      fill
                      sizes="(max-width: 1024px) 100vw, 50vw"
                      priority
                      className="object-contain md:object-cover"
                    />
                  ) : (
                    <div className="grid place-items-center h-full text-[#9e9e9e] text-xs uppercase tracking-widest">
                      No image
                    </div>
                  )}
                </div>
                {combinationUnavailable ? (
                  notified ? (
                    <div>
                      <p className="text-sm text-[#2E7D32] font-medium">
                        Notification Turned on
                      </p>
                      <p className='mt-1 text-sm text-[#424242] font-medium'>
                        You’ll be notified when this item is restocked.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-base font-semibold text-[#000] tabular-nums leading-none">
                        This item is currently out of Stock
                      </p>
                      {selectedVariantLabel && (
                        <p className="mt-1 text-sm font-medium text-[#757575]">{selectedVariantLabel}</p>
                      )}
                    </div>
                  )
                ) : (
                  <div className="flex items-center gap-4 flex-wrap">
                    <div>
                      {/* Sticky top-bar price mirrors the main price row so the
                            "coupon removed" state stays consistent across the
                            whole page — no chip, plain MRP number. */}
                      <p className="block md:hidden text-sm  leading-tight font-semibold text-[#1a1410]">
                        {product.name}
                      </p>
                      <span className="text-xs md:text-base font-semibold text-[#000] tabular-nums leading-none">
                        ₹{inr(discountRemoved ? effectiveOriginalPrice : effectivePrice)}
                      </span>
                      {selectedVariantLabel ? (
                        <div className="text-xs md:text-sm text-[#424242]">{selectedVariantLabel}</div>
                      ) : (
                        <div className="text-xs md:text-sm text-[#424242]">All Taxes Inc.</div>
                      )}
                    </div>

                    {hasDiscount && !discountRemoved && (
                      <div className="flex">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="24" viewBox="0 0 12 24" fill="none" className='relative z-2'>
                          <path d="M11.7387 0H0L6.94967 12L0 24H11.7387V0Z" fill="#d3ff33" />
                          <path d="M11.7387 0H0L6.94967 12L0 24H11.7387V0Z" fill="#D3FF33" />
                        </svg>
                        <span className="inline-flex items-center px-2 py-[3px] rounded-xs bg-[#d3ff33] text-[#000] relative z-1 -ml-1 text-sm font-semibold shadow-[0_2px_4px_0_rgba(0,0,0,0.12)_inset] leading-[1.32]">
                          {discount}% Off
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div>
                {!(combinationUnavailable && notified) && (
                  <button
                    type="button"
                    onClick={() => (outOfStock ? notifyMe() : addToCart())}
                    disabled={!outOfStock && busy === 'cart'}
                    className="flex-1 h-12 rounded-lg bg-[#1a1410] text-white w-full lg:w-auto font-normal text-[18px] hover:bg-[#424242] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 py-1 px-4"
                  >
                    {busy === 'cart' ? (
                      <Spinner size="sm" color="white" />
                    ) : outOfStock ? (
                      'Notify me'
                    ) : (
                      'Add to cart'
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* HERO + DESCRIPTION + SPECS — single 2-column grid per Figma
          3152-2640. Left column stacks the gallery, description prose,
          and specifications table; right column is a sticky info panel
          (brand, rating, title, price, CTAs, delivery, special offer)
          that follows the customer as they scroll through the long
          left-column content. Right panel width is fixed at 400px on
          lg+ so the proportions match the Figma frame; on mobile both
          columns collapse to full-width stacking order. */}
      <section className="py-8 md:py-10">
        {/* Grid sizing per Figma: left column flexes up to a max of
            820px, right info panel is a fixed 515px column, with a
            96px (gap-24) gutter between them on lg+. On mobile both
            columns collapse to full-width stacking. */}
        <div className="container grid md:grid-cols-2 gap-8 lg:gap-15 items-start">
          {/* LEFT COLUMN — gallery on top, then description + specs */}
          <div className="flex flex-col gap-10 min-w-0">
            {/* Image gallery — Myntra-style layout:
                - ONE image  → single large square tile.
                - MANY images → two-column grid of ALL images.
                Every tile shows a magnifier-plus hint on hover and
                clicking it opens the lightbox AT THAT IMAGE. */}
            {galleryImages.length <= 1 ? (
              <div
                className={`aspect-square w-full rounded-xl overflow-hidden border-1 border-[#E0E0E0] relative group ${mainGalleryImg ? 'cursor-zoom-in' : ''}`}
                onClick={() => {
                  if (!mainGalleryImg) return;
                  setActiveImg(0);
                  setIsGalleryLightboxOpen(true);
                }}
              >
                {mainGalleryImg ? (
                  <>
                    <Image
                      src={imageUrl(mainGalleryImg)}
                      alt={product.name}
                      fill
                      sizes="(max-width: 1024px) 100vw, 50vw"
                      priority
                      className="w-full h-full object-contain p-[5%] bg-white"
                    />
                    <span className="absolute bottom-3 right-3 z-10 grid place-items-center w-10 h-10 rounded-full bg-white/90 text-[#141414] shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      <ZoomInIcon />
                    </span>
                  </>
                ) : (
                  <div className="grid place-items-center h-full text-[#9e9e9e] text-xs uppercase tracking-widest w-full">
                    No image
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* MOBILE (< md) — full-width one-image-at-a-time swiper
                    with a Myntra-style segmented progress indicator.
                    Tapping a slide opens the lightbox at that image. */}
                <div className="md:hidden">
                  <Swiper
                    key={selectedColor}
                    slidesPerView={1}
                    spaceBetween={12}
                    // onSwiper fires on (re)mount — the key above remounts
                    // this swiper on colour change, so the indicator snaps
                    // back to slide 0 along with it.
                    onSwiper={(s) => setMobileImgIdx(s.activeIndex)}
                    onSlideChange={(s) => setMobileImgIdx(s.activeIndex)}
                    className="w-full"
                  >
                    {galleryImages.map((src, idx) => (
                      <SwiperSlide key={`${selectedColor}-m-${idx}-${src}`}>
                        <div
                          className="relative aspect-square w-full rounded-xl overflow-hidden border border-[#E0E0E0]"
                          onClick={() => {
                            setActiveImg(idx);
                            setIsGalleryLightboxOpen(true);
                          }}
                        >
                          <Image
                            src={imageUrl(src)}
                            alt={`${product.name} — view ${idx + 1}`}
                            fill
                            sizes="100vw"
                            priority={idx === 0}
                            className="w-full h-full object-contain p-[5%] bg-white"
                          />
                        </div>
                      </SwiperSlide>
                    ))}
                  </Swiper>
                  <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
                    {galleryImages.map((_, idx) => (
                      <span
                        key={idx}
                        className={`h-1 rounded-full transition-all duration-300 ${idx === mobileImgIdx ? 'w-8 bg-[#141414]' : 'w-3 bg-[#d4d4d4]'
                          }`}
                      />
                    ))}
                  </div>
                </div>

                {/* DESKTOP (md+) — two-column grid of all images */}
                <div className="hidden md:grid grid-cols-2 gap-3">
                  {galleryImages.map((src, idx) => (
                    <button
                      type="button"
                      key={`${selectedColor}-${idx}-${src}`}
                      onClick={() => {
                        setActiveImg(idx);
                        setIsGalleryLightboxOpen(true);
                      }}
                      className="aspect-square rounded-xl overflow-hidden relative border border-[#E0E0E0] group cursor-zoom-in"
                      aria-label={`View image ${idx + 1} full size`}
                    >
                      <Image
                        src={imageUrl(src)}
                        alt={`${product.name} — view ${idx + 1}`}
                        fill
                        sizes="(max-width: 1024px) 50vw, 25vw"
                        priority={idx < 2}
                        className="w-full h-full object-contain p-[5%] bg-white"
                      />
                      <span className="absolute bottom-3 right-3 z-10 grid place-items-center w-10 h-10 rounded-full bg-white/90 text-[#141414] shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        <ZoomInIcon />
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* DESCRIPTION block — lives inside the LEFT column so the
                customer reads it while the right info panel stays sticky.
                Heading uses HS-4 (Poppins SemiBold 20px), body uses Body S
                (Poppins Regular 14px, color #424242, line-height 1.65). */}

          </div>

          {/* RIGHT: Sticky info panel — pinned to the viewport top when
              the customer scrolls through the long description/specs
              content on the left. `self-start` keeps the panel aligned
              to the top of the grid row instead of being stretched. */}
          <aside className="lg:self-start flex flex-col font-poppins min-w-0">
            {/* Brand kicker — black text with underline, link-style.
                Clicking goes to the brand's listing page when slug exists. */}
            {refName(product.brand) && (
              refSlug(product.brand) ? (
                <Link
                  href={`/brands/${refSlug(product.brand)}`}
                  className="group relative inline-block text-base text-[#1a1410] w-fit"
                >
                  {refName(product.brand)}

                  <span
                    aria-hidden
                    className="absolute left-0 right-0 bottom-0 h-[1.5px] rounded-lg"
                    style={{ background: '#BDBDBD' }}
                  />

                  <span
                    aria-hidden
                    className="absolute left-0 bottom-0 h-[1.5px] w-0 rounded-lg transition-[width] duration-300 ease-out group-hover:w-full"
                    style={{ background: '#212121' }}
                  />
                </Link>
              ) : (
                <span className="group relative inline-block text-base text-[#1a1410] w-fit">
                  {refName(product.brand)}
                  <span
                    aria-hidden
                    className="absolute left-0 right-0 bottom-0 h-[1.5px] rounded-lg"
                    style={{ background: '#BDBDBD' }}
                  />

                  <span
                    aria-hidden
                    className="absolute left-0 bottom-0 h-[1.5px] w-0 rounded-lg transition-[width] duration-300 ease-out group-hover:w-full"
                    style={{ background: '#212121' }}
                  />
                </span>
              )
            )}

            {/* Rating row — single star + 4.8 + underlined "(N Reviews)"
                link. Hidden entirely until the product has at least one
                review — a "0.0 (0 Reviews)" row reads as a bad rating
                rather than an unrated product. */}
            {reviewsCount > 0 && (
              <div className="flex items-center gap-1.5 mt-3">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-[#1a1410]" aria-hidden>
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <span className="text-[14px] font-medium text-[#1a1410] tabular-nums">
                  {rating.toFixed(1)}
                </span>
                <a
                  href="#reviews"
                  className="group relative inline-block text-base text-[#1a1410] w-fit"
                >
                  ({reviewsCount} {reviewsCount === 1 ? 'Review' : 'Reviews'})
                  <span
                    aria-hidden
                    className="absolute left-0 right-0 bottom-0 h-[1.5px] rounded-lg"
                    style={{ background: '#BDBDBD' }}
                  />

                  <span
                    aria-hidden
                    className="absolute left-0 bottom-0 h-[1.5px] w-0 rounded-lg transition-[width] duration-300 ease-out group-hover:w-full"
                    style={{ background: '#212121' }}
                  />
                </a>
              </div>
            )}

            {/* Title */}
            <h1 className="mt-6 text-xl lg:text-2xl leading-tight font-semibold text-[#1a1410]">
              {product.name}
            </h1>

            {/* Price row — ₹X + lime "Y% Off" pill side-by-side.
                When the seller-created coupon has been "removed" via the
                Special Offer card below, we drop the discounted price +
                the lime chip and show the plain MRP so the buyer sees
                what they'd pay without the code applied. Re-applying the
                coupon brings them both back. */}
            <div className="mt-6 flex items-center gap-3 flex-wrap">
              <span className="text-lg lg:text-2xl font-semibold text-[#1a1410] tabular-nums leading-none">
                ₹{inr(discountRemoved ? effectiveOriginalPrice : effectivePrice)}
              </span>
              {/* MRP shown as strikethrough next to the current price so the
                  shopper sees the crossed-out list price the seller entered
                  (e.g. ₹71,564   ₹83,090). Only renders when MRP is strictly
                  higher than the currently-displayed price — otherwise it'd
                  duplicate the same number. */}
              {(() => {
                const currentPrice = Number(
                  discountRemoved ? effectiveOriginalPrice : effectivePrice,
                );
                const mrpNum = Number(effectiveMrp);
                if (!mrpNum || mrpNum <= currentPrice) return null;
                return (
                  <span className="text-base lg:text-lg text-[#9E9E9E] font-medium line-through tabular-nums leading-none">
                    ₹{inr(mrpNum)}
                  </span>
                );
              })()}
              {(() => {
                // Show the lime chip based on the CURRENT price tier:
                // - Applied  → post-coupon price vs MRP
                // - Removed  → seller selling price vs MRP
                if (!hasDiscount) return null;
                const currentPrice = discountRemoved
                  ? Number(effectiveOriginalPrice)
                  : Number(effectivePrice);
                const mrpNum = Number(effectiveMrp);
                if (!mrpNum || currentPrice >= mrpNum) return null;
                const pct = Math.round(((mrpNum - currentPrice) / mrpNum) * 100);
                if (pct <= 0) return null;
                return (
                  <div className="flex">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="24" viewBox="0 0 12 24" fill="none" className='relative z-2'>
                      <path d="M11.7387 0H0L6.94967 12L0 24H11.7387V0Z" fill="#d3ff33" />
                      <path d="M11.7387 0H0L6.94967 12L0 24H11.7387V0Z" fill="#D3FF33" />
                    </svg>
                    <span className="inline-flex items-center px-2 py-[3px] relative z-1 rounded-xs bg-[#d3ff33] -ml-1 text-[#000] text-sm font-semibold shadow-[0_2px_4px_0_rgba(0,0,0,0.12)_inset] leading-[1.32]">
                      {pct}% Off
                    </span>
                  </div>
                );
              })()}
            </div>
            <div className="text-sm text-[#424242]">All Taxes Inc.</div>

            {/* Add to Cart row — large black button + circular heart */}
            <div ref={addToCartRowRef} className="mt-6 flex items-center justify-between gap-4 pr-2">
              {(combinationUnavailable || outOfStock) ? (
                <div className='flex justify-between items-center w-full'>
                  {notified ? (
                    <div className='flex items-center gap-4'>
                      <div className='p-1 rounded-lg bg-[#F5F5F5] border border-[#E0E0E0]'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
                          <path d="M16.6667 8.33333C16.6667 7.44928 17.0179 6.60143 17.643 5.97631C18.2681 5.35119 19.1159 5 20 5C20.8841 5 21.7319 5.35119 22.357 5.97631C22.9821 6.60143 23.3333 7.44928 23.3333 8.33333C25.2473 9.23838 26.879 10.6472 28.0534 12.4088C29.2278 14.1705 29.9007 16.2185 30 18.3333V23.3333C30.1254 24.3695 30.4924 25.3618 31.0714 26.2302C31.6503 27.0987 32.4251 27.819 33.3333 28.3333H6.66667C7.5749 27.819 8.34968 27.0987 8.92865 26.2302C9.50761 25.3618 9.87457 24.3695 10 23.3333V18.3333C10.0993 16.2185 10.7722 14.1705 11.9466 12.4088C13.121 10.6472 14.7527 9.23838 16.6667 8.33333Z" fill="#EFF9CD" />
                          <path d="M15 28.3333V30C15 31.3261 15.5268 32.5979 16.4645 33.5355C17.4021 34.4732 18.6739 35 20 35C21.3261 35 22.5979 34.4732 23.5355 33.5355C24.4732 32.5979 25 31.3261 25 30V28.3333" fill="#EFF9CD" />
                          <path d="M35 11.2117C33.9068 8.83376 32.3193 6.71616 30.3433 5Z" fill="#EFF9CD" />
                          <path d="M5 11.2117C6.09225 8.83407 7.67858 6.71649 9.65333 5Z" fill="#EFF9CD" />
                          <path d="M15 28.3333V30C15 31.3261 15.5268 32.5979 16.4645 33.5355C17.4021 34.4732 18.6739 35 20 35C21.3261 35 22.5979 34.4732 23.5355 33.5355C24.4732 32.5979 25 31.3261 25 30V28.3333M35 11.2117C33.9068 8.83376 32.3193 6.71616 30.3433 5M5 11.2117C6.09225 8.83407 7.67858 6.71649 9.65333 5M16.6667 8.33333C16.6667 7.44928 17.0179 6.60143 17.643 5.97631C18.2681 5.35119 19.1159 5 20 5C20.8841 5 21.7319 5.35119 22.357 5.97631C22.9821 6.60143 23.3333 7.44928 23.3333 8.33333C25.2473 9.23838 26.879 10.6472 28.0534 12.4088C29.2278 14.1705 29.9007 16.2185 30 18.3333V23.3333C30.1254 24.3695 30.4924 25.3618 31.0714 26.2302C31.6503 27.0987 32.4251 27.819 33.3333 28.3333H6.66667C7.5749 27.819 8.34968 27.0987 8.92865 26.2302C9.50761 25.3618 9.87457 24.3695 10 23.3333V18.3333C10.0993 16.2185 10.7722 14.1705 11.9466 12.4088C13.121 10.6472 14.7527 9.23838 16.6667 8.33333Z" stroke="#212121" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm text-[#2E7D32] font-medium">
                          Notification Turned on
                        </p>
                        <p className='mt-1 text-sm text-[#424242] font-medium'>
                          You’ll be notified when this item is restocked.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className='flex gap-4 items-center'>
                      <div className='p-1 rounded-lg bg-[#F5F5F5] border border-[#E0E0E0]'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
                          <path d="M29.6083 29.595L20 35L6.66667 27.5V12.5L10.3933 10.4033M14.6767 7.995L20 5L33.3333 12.5V26.6667" fill="#EFF9CD" />
                          <path d="M24.2683 17.5983L33.3333 12.5Z" fill="#EFF9CD" />
                          <path d="M20 20V35Z" fill="#EFF9CD" />
                          <path d="M20 20L6.66667 12.5Z" fill="#EFF9CD" />
                          <path d="M5 5L35 35Z" fill="#EFF9CD" />
                          <path d="M10.3933 10.4033L6.66667 12.5V27.5L20 35L29.6083 29.595M20 35V20L6.66667 12.5M33.3333 26.6667V12.5L20 5L14.6767 7.995M33.3333 12.5L24.2683 17.5983M5 5L35 35" stroke="#212121" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <p className="text-sm font-semibold text-[#000] leading-[1.32]">
                        {combinationUnavailable
                          ? 'This variant is currently out of Stock'
                          : 'This product is currently out of Stock'}
                      </p>
                    </div>
                  )}
                  {!notified && (
                    <button
                      type="button"
                      onClick={() => notifyMe()}
                      disabled={busy === 'cart'}
                      className="h-12 rounded-lg bg-[#1a1410] px-6 text-white text-[18px] font-normal hover:bg-[#424242] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2 w-fit"
                    >
                      {busy === 'cart' ? (
                        <Spinner size="sm" color="white" />
                      ) : (
                        'Notify me'
                      )}
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => (outOfStock ? notifyMe() : addToCart())}
                  disabled={!outOfStock && busy === 'cart'}
                  className="flex-1 h-12 rounded-lg bg-[#1a1410] text-white text-[18px] font-normal hover:bg-[#424242] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                >
                  {busy === 'cart' ? (
                    <Spinner size="sm" color="white" />
                  ) : outOfStock ? (
                    'Notify me'
                  ) : (
                    'Add to cart'
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={toggleWishlist}
                onMouseEnter={() => setHeartHover(true)}
                onMouseLeave={() => setHeartHover(false)}
                disabled={busy === "wishlist"}
                aria-label={wishlisted ? "Remove from wishlist" : "Save to wishlist"}
                aria-pressed={wishlisted}
                className={`group ${wishlisted
                  ? "border-rose-200"
                  : "bg-white border-[#eaeaea] hover:border-[#bdbdbd]"
                  } ${busy === "wishlist" ? "opacity-60 cursor-wait" : ""}`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="60"
                  height="60"
                  viewBox="0 0 60 60"
                >
                  <g filter="url(#filter0_di_3182_285)">
                    <rect x="8" y="6" width="44" height="44" rx="22" fill="#F7F7F7" />

                    <path
                      d="M30 40L28.26 38.2736C22.08 32.1657 18 28.1373 18 23.1935C18 19.1651 20.904 16 24.6 16C26.688 16 28.692 17.0594 30 18.7335C31.308 17.0594 33.312 16 35.4 16C39.096 16 42 19.1651 42 23.1935C42 28.1373 37.92 32.1657 31.74 38.2866L30 40Z"
                      stroke={wishlisted || heartHover ? "url(#heartGradient)" : "#9CA3AF"}
                      strokeWidth="2"
                      fill={wishlisted || heartHover ? "url(#heartGradient)" : "none"}
                      className="transition-all duration-300"
                    />
                  </g>

                  <defs>
                    {/* Heart Gradient */}
                    <linearGradient
                      id="heartGradient"
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
                      id="filter0_di_3182_285"
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
            </div>
            {/* {outOfStock && notified && !combinationUnavailable && (
              <div className="mt-2 text-sm text-[#2E7D32] font-medium">
                Notification Turned on
              </div>
            )} */}

            {/* Size selector — hidden only when the product has no sizes.
                It stays VISIBLE even when every variant is sold out
                (`wholeProductOutOfStock`); each tile just disables itself
                via `isSizeAvailableForSelectedColor` instead of the whole
                selector disappearing, so the shopper can still see what
                sizes this product comes in. Keep this tucked under the
                CTAs so it stays available for apparel / gloves without
                bloating the helmet/accessory layout. */}
            {product.sizes && product.sizes.length > 0 && (
              <div id="size-selector" className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[14px] font-semibold text-[#1a1410]">Size</h3>
                  {product.sizeChartImage ? (
                    <button
                      type="button"
                      onClick={() => setIsSizeChartOpen(true)}
                      className="text-[13px] font-semibold text-[#1a1410] underline underline-offset-4 hover:opacity-80"
                    >
                      Size Table
                    </button>
                  ) : null}
                </div>
                {/* Figma-spec size tiles: uniform 48×48 rounded-md squares,
                    selected = filled black, unselected = white with 1px
                    border. Matches the FF811 helmet reference (XS · S · M
                    · L · XL). Error state paints border rose to draw
                    attention without changing the size tile geometry. */}
                <div className="flex flex-wrap gap-2">
                  {product.sizes.map((s) => {
                    const selected = selectedSize === s;
                    const sizeAvailable = isSizeAvailableForSelectedColor(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={!sizeAvailable}
                        onClick={() => {
                          setSelectedSize(s);
                          setSizeError('');
                        }}
                        className={`px-3 py-2 min-w-12 min-h-12 grid place-items-center whitespace-nowrap rounded-md text-[14px] font-semibold transition ${!sizeAvailable
                          ? 'bg-[#FAFAFA] border border-dashed border-[#D0D0D0] text-[#BDBDBD] cursor-not-allowed'
                          : selected
                            ? 'bg-[#1a1410] text-white border border-[#1a1410]'
                            : sizeError
                              ? 'bg-white border border-rose-400 text-rose-700 hover:border-rose-600'
                              : 'bg-white border border-[#E0E0E0] text-[#1a1410] hover:border-[#1a1410]'
                          }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
                {sizeError && (
                  <div className="mt-2 flex items-center gap-1.5 text-rose-700 text-[12px] font-semibold">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    {sizeError}
                  </div>
                )}
              </div>
            )}

            {(() => {
              // Stays visible even when the WHOLE product is out of stock
              // (every variant sold out) — each swatch just shows its own
              // "Out of stock" overlay and disables itself below, instead
              // of the whole picker disappearing.
              // Union of unique color names: prefer colorImages entries
              // (they carry photos), fall back to distinct variants[].color
              // (whose photos we'll swap in from the main gallery).
              const colorEntries: { color: string; thumb: string }[] = [];
              const seen = new Set<string>();
              const colorImages = (product as any).colorImages || [];
              for (const ci of colorImages) {
                const name = (ci?.color || '').toString().trim();
                if (!name || seen.has(name)) continue;
                seen.add(name);
                const thumb = Array.isArray(ci.images) && ci.images[0]
                  ? ci.images[0]
                  : (product.listingImage || product.images?.[0] || '');
                colorEntries.push({ color: name, thumb });
              }
              const variants = (product as any).variants || [];
              for (const v of variants) {
                const name = (v?.color || '').toString().trim();
                if (!name || seen.has(name)) continue;
                seen.add(name);
                colorEntries.push({ color: name, thumb: product.listingImage || product.images?.[0] || '' });
              }
              if (colorEntries.length === 0) return null;
              return (
                <div id="color-selector" className="mt-6 min-w-0">
                  <p className="text-[14px] text-[#1a1410] font-semibold mb-3">Colour</p>
                  <div className="relative min-w-0">
                    <Swiper
                      onSwiper={(s) => {
                        colourSwiperRef.current = s;
                        setColourAtStart(s.isBeginning);
                        setColourAtEnd(s.isEnd);
                      }}
                      onSlideChange={(s) => {
                        setColourAtStart(s.isBeginning);
                        setColourAtEnd(s.isEnd);
                      }}
                      slidesPerView="auto"
                      spaceBetween={16}
                      className="!px-0.5 !py-1"
                    >
                      {colorEntries.map(({ color, thumb }) => {
                        const isSelected = selectedColor === color;
                        const colorOOS = isColorOutOfStock(color);
                        return (
                          <SwiperSlide key={color} style={{ width: 108 }} className="!h-auto">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedColor(color);
                                setColorError('');
                                // The `galleryImages` memo below re-derives from
                                // this color's `colorImages[].images` list, so
                                // resetting activeImg to 0 lands us on the
                                // first per-color photo automatically.
                                setActiveImg(0);
                              }}
                              aria-pressed={isSelected}
                              aria-label={colorOOS ? `Pick colour ${color} (out of stock)` : `Pick colour ${color}`}
                              className={`bg-white p-2 rounded-xl transition text-left w-[108px] ${isSelected
                                ? 'border-2 border-[#1a1410]'
                                : colorError
                                  ? 'border border-rose-400 hover:border-rose-600'
                                  : 'border border-[#E0E0E0] hover:border-[#1a1410]'
                                }`}
                            >
                              <div className="aspect-square w-full relative bg-[#F5F5F5] rounded-xl overflow-hidden">
                                {thumb ? (
                                  <Image
                                    src={imageUrl(thumb)}
                                    alt={color}
                                    fill
                                    sizes="92px"
                                    className={`object-cover ${colorOOS ? 'grayscale' : ''}`}
                                  />
                                ) : (
                                  <div className="w-full h-full grid place-items-center text-[10px] uppercase text-default-500 tracking-wide">
                                    No img
                                  </div>
                                )}
                                {colorOOS && (
                                  <div className="absolute inset-0 z-10 bg-black/35 grid place-items-center gap-1">
                                    <span className="text-[10px] font-bold text-white uppercase tracking-wide">
                                      Out of stock
                                    </span>
                                    {/* <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <rect x="5" y="11" width="14" height="9" rx="2" />
                                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                                    </svg> */}
                                  </div>
                                )}
                              </div>
                              <div className="px-1 pt-2.5 pb-1 text-[12px] font-semibold text-[#1a1410] truncate">
                                {color}
                              </div>
                            </button>
                          </SwiperSlide>
                        );
                      })}
                    </Swiper>
                    {colorEntries.length > 4 && (
                      <>
                        {!colourAtStart && (
                          <button
                            type="button"
                            aria-label="Scroll left"
                            onClick={() => colourSwiperRef.current?.slidePrev()}
                            className="place-items-center absolute -left-4 top-1/2 -translate-y-1/2 hover:shadow-[0_4px_8px_-2px_rgba(0,0,0,0.12)]  z-2 w-8 h-12 bg-white/80 rounded-full hover:bg-default-50 transition"
                          >
                            <ChevronLeftIcon />
                          </button>
                        )}
                        {!colourAtEnd && (
                          <button
                            type="button"
                            aria-label="Scroll right"
                            onClick={() => colourSwiperRef.current?.slideNext()}
                            className="place-items-center absolute -right-4 top-1/2 -translate-y-1/2 hover:shadow-[0_4px_8px_-2px_rgba(0,0,0,0.12)]  z-2 w-8 h-12 bg-white/80 rounded-full  hover:bg-default-50 transition"
                          >
                            <ChevronRightIcon />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {colorError && (
                    <div className="mt-2 flex items-center gap-1.5 text-rose-700 text-[12px] font-semibold">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      {colorError}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Check Delivery card — Figma rounded panel with truck icon. */}
            <DeliveryRate key={selectedOffer?._id || slug} slug={selectedOffer?._id || slug} />

            {/* Special Offer / Return policy card — only shown when there
                IS an actual discount (so we don't display a coupon UI on
                a non-discounted product). The savings amount comes from
                MRP - selling price. */}

            {/* Old, plain-black-and-green styled version of this card — kept
                as reference, not deleted. Superseded by the purple/green
                (#6A5ACD / #2E7D32) restyle below, which reuses ALL of this
                block's dynamic logic (activeOffer, coupon input/validation,
                discountRemoved toggle, price numbers, return/exchange copy)
                and only changes colors/icons/layout to match the new design.
            {hasDiscount && (
              <div className="mt-4 rounded-2xl border border-[#eaeaea] bg-white px-6 py-5">
                <div className="mb-4">
                  <div className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-[#1a1410]" aria-hidden>
                      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                      <line x1="7" y1="7" x2="7.01" y2="7" />
                    </svg>
                    <span className="text-[14px] font-semibold text-[#1a1410]">Special Offer</span>
                  </div>
                </div>

                {activeOffer && activeOffer.title && discountRemoved ? (
                  <>
                    <div className="text-sm text-[#1a1410] mb-3">
                      Use code <span className="font-semibold">{activeOffer.title}</span> to save ₹{inr(Math.max(0, effectiveOriginalPrice - effectivePrice))} on this product.
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        placeholder="Enter coupon code"
                        value={couponInput}
                        onChange={(e) => {
                          setCouponInput(e.target.value);
                          if (couponError) setCouponError('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const typed = couponInput.trim().toLowerCase();
                            const target = activeOffer.title.toLowerCase();
                            if (typed && typed === target) {
                              setDiscountRemoved(false);
                              setCouponInput('');
                              setCouponError('');
                            } else {
                              setCouponError('That code doesn\'t match this product\'s offer.');
                            }
                          }
                        }}
                        className="flex-1 h-12 px-4 rounded-lg border border-transparent bg-[#EEEEEE] focus:border-[#1a1410] outline-none text-sm tabular-nums"
                      />
                      <Button
                        onPress={() => {
                          const typed = couponInput.trim().toLowerCase();
                          const target = activeOffer.title.toLowerCase();
                          if (typed && typed === target) {
                            setDiscountRemoved(false);
                            setCouponInput('');
                            setCouponError('');
                          } else {
                            setCouponError('That code doesn\'t match this product\'s offer.');
                          }
                        }}
                        className="font-semibold bg-[#1a1410] text-white h-12 rounded-lg px-5"
                      >
                        Apply
                      </Button>
                    </div>
                    {couponError && (
                      <div className="mt-2 text-xs text-[#DC2626] font-medium">{couponError}</div>
                    )}
                  </>
                ) : (
                  <div className="flex items-start justify-between gap-2 rounded-lg bg-[#F4F9F5] p-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-[#15803D] mt-0.5 shrink-0" aria-hidden>
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="9 12 11 14 15 10" />
                      </svg>
                      <span className="text-[13px] font-semibold text-[#15803D]">
                        {activeOffer && activeOffer.title
                          ? `${activeOffer.title} applied! You save ₹${inr(Math.max(0, effectiveMrp - effectivePrice))}`
                          : `You save ₹${inr(Math.max(0, effectiveMrp - effectivePrice))} on this order`}
                      </span>
                    </div>
                    {activeOffer && activeOffer.title && (
                      <button
                        type="button"
                        onClick={() => setDiscountRemoved(true)}
                        className="text-sm text-[#212121] group relative w-fit shrink-0"
                      >
                        Remove
                        <span
                          aria-hidden
                          className="absolute left-0 right-0 bottom-0 h-[1.5px] rounded-lg"
                          style={{ background: '#BDBDBD' }}
                        />
                        <span
                          aria-hidden
                          className="absolute left-0 bottom-0 h-[1.5px] w-0 rounded-lg transition-[width] duration-300 ease-out group-hover:w-full"
                          style={{ background: '#212121' }}
                        />
                      </button>
                    )}
                  </div>
                )}

                <div className="mt-3">
                  <div className="text-xs text-[#424242]">
                    {discountRemoved ? 'Price' : 'Discounted Price'}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[16px] font-semibold text-[#1a1410] tabular-nums leading-[1.32]">
                      ₹{inr(discountRemoved ? effectiveOriginalPrice : effectivePrice)}
                    </span>
                    {!discountRemoved && effectiveMrp > effectivePrice && (
                      <span className="text-[16px] text-[#9E9E9E] font-semibold line-through tabular-nums leading-[1.52]">
                        ₹{inr(effectiveMrp)}
                      </span>
                    )}
                  </div>
                </div>

                {(() => {
                  const retDays = (product as any).returnPolicyDays ?? product.seller?.returnPolicyDays;
                  const excDays = (product as any).exchangePolicyDays ?? product.seller?.exchangePolicyDays;
                  const same = retDays != null && excDays != null && retDays === excDays;
                  const anyEnabled = (retDays ?? 0) > 0 || (excDays ?? 0) > 0;
                  if (!anyEnabled) return null;
                  const heading = same
                    ? `${retDays}-Day Easy Return & Exchange`
                    : (retDays ?? 0) > 0 && (excDays ?? 0) > 0
                      ? `${retDays}-day return, ${excDays}-day exchange`
                      : (retDays ?? 0) > 0
                        ? `${retDays}-Day Easy Return`
                        : `${excDays}-Day Easy Exchange`;
                  const body = same
                    ? `Not satisfied? Return or exchange within ${retDays} days of delivery.`
                    : (retDays ?? 0) > 0 && (excDays ?? 0) > 0
                      ? `Not satisfied? Return within ${retDays} days or exchange within ${excDays} days of delivery.`
                      : (retDays ?? 0) > 0
                        ? `Not satisfied? Return within ${retDays} days of delivery.`
                        : `Not the right fit? Exchange within ${excDays} days of delivery.`;
                  return (
                    <div className="mt-4 pt-4 border-t border-[#eaeaea]">
                      <div className="flex items-start gap-2">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-[#1a1410] mt-0.5 shrink-0" aria-hidden>
                          <polyline points="1 4 1 10 7 10" />
                          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                        </svg>
                        <div className="min-w-0">
                          <div className="text-[14px] font-semibold text-[#1a1410]">{heading}</div>
                          <p className="text-[12px] text-[#424242] mt-1 leading-relaxed">{body}</p>
                          <p className="text-[12px] text-[#9e9e9e] mt-1">
                            T&amp;C Applied. Read our{' '}
                            <Link href="/privacy-policy" className="text-[#1a1410] underline underline-offset-2 hover:text-black">
                              Privacy Policy
                            </Link>
                          </p>

                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
            */}

            {hasDiscount && (
              <div className="mt-4 rounded-2xl border border-[#eaeaea] bg-white px-6 py-5">
                <div className="mb-4">
                  <div className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-[#6A5ACD]" aria-hidden>
                      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                      <line x1="7" y1="7" x2="7.01" y2="7" />
                    </svg>
                    <span className="text-[14px] font-semibold text-[#6A5ACD]">Special Offer</span>
                  </div>
                </div>

                {/* Two states — applied (green savings row + Remove) OR
                    removed (hint + coupon input + Apply). Only real
                    SellerOffers with a title support the input flow /
                    Remove button; a plain MRP discount can't be
                    "re-applied" via a code so it just stays in the applied
                    state without a Remove. */}
                {activeOffer && activeOffer.title && discountRemoved ? (
                  /* ─── REMOVED / re-apply state ─────────────────────── */
                  <div>
                    <div className='flex flex-wrap items-center gap-1 mb-3'>
                      <p className="text-sm text-[#1a1410]">
                        Use code <b>{activeOffer.title}</b> to save ₹{inr(Math.max(0, effectiveOriginalPrice - effectivePrice))} on this product.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setDiscountRemoved(false);
                          setCouponInput('');
                          setCouponError('');
                        }}
                        className="text-sm text-[#6A5ACD] font-semibold underline-offset-2 underline"
                      >
                        Apply
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mb-1">
                      <input
                        type="text"
                        placeholder="Enter coupon code"
                        value={couponInput}
                        onChange={(e) => {
                          setCouponInput(e.target.value);
                          if (couponError) setCouponError('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const typed = couponInput.trim().toLowerCase();
                            const target = activeOffer.title.toLowerCase();
                            if (typed && typed === target) {
                              setDiscountRemoved(false);
                              setCouponInput('');
                              setCouponError('');
                            } else {
                              setCouponError('That code doesn\'t match this product\'s offer.');
                            }
                          }
                        }}
                        className="w-full p-3 h-12 rounded-lg border bg-[#EEEEEE] border-transparent focus:border-[#1a1410] outline-none text-sm tabular-nums"
                      />
                      <Button
                        onPress={() => {
                          const typed = couponInput.trim().toLowerCase();
                          const target = activeOffer.title.toLowerCase();
                          if (typed && typed === target) {
                            setDiscountRemoved(false);
                            setCouponInput('');
                            setCouponError('');
                          } else {
                            setCouponError('That code doesn\'t match this product\'s offer.');
                          }
                        }}
                        className="font-semibold bg-[#6A5ACD] text-white h-12 rounded-lg px-5"
                      >
                        Apply
                      </Button>
                    </div>
                    {couponError && (
                      <div className="mt-2 text-xs text-[#DC2626] font-medium">{couponError}</div>
                    )}
                  </div>
                ) : (
                  /* ─── APPLIED state ─────────────────────────────────── */
                  <div className="flex items-start justify-between gap-2 rounded-lg bg-[#F4F9F5] p-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-[#15803D] mt-0.5 shrink-0" aria-hidden>
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="9 12 11 14 15 10" />
                      </svg>
                      <span className="text-[13px] font-semibold text-[#15803D]">
                        {activeOffer && activeOffer.title
                          ? `${activeOffer.title} applied! You save ₹${inr(Math.max(0, effectiveMrp - effectivePrice))}`
                          : `You save ₹${inr(Math.max(0, effectiveMrp - effectivePrice))} on this order`}
                      </span>
                    </div>
                    {activeOffer && activeOffer.title && (
                      <button
                        type="button"
                        onClick={() => setDiscountRemoved(true)}
                        className="text-sm text-[#212121] group relative w-fit shrink-0"
                      >
                        Remove
                        <span
                          aria-hidden
                          className="absolute left-0 right-0 bottom-0 h-[1.5px] rounded-lg"
                          style={{ background: '#BDBDBD' }}
                        />
                        <span
                          aria-hidden
                          className="absolute left-0 bottom-0 h-[1.5px] w-0 rounded-lg transition-[width] duration-300 ease-out group-hover:w-full"
                          style={{ background: '#212121' }}
                        />
                      </button>
                    )}
                  </div>
                )}

                <div className="mt-3">
                  <div className="text-xs text-[#424242]">
                    {discountRemoved ? 'Price' : 'Discounted Price'}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[16px] font-semibold text-[#1a1410] tabular-nums leading-[1.32]">
                      ₹{inr(discountRemoved ? effectiveOriginalPrice : effectivePrice)}
                    </span>
                    {!discountRemoved && effectiveMrp > effectivePrice && (
                      <span className="text-[16px] text-[#9E9E9E] font-semibold line-through tabular-nums leading-[1.52]">
                        ₹{inr(effectiveMrp)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Divider + return policy, per Figma 3731:6453. */}
                {returnPolicyBlock && (
                  <div className="mt-4 pt-4 border-t border-[#EEEEEE]">{returnPolicyBlock}</div>
                )}
              </div>
            )}

            {/* No discount means no offer card to hang the policy off, so it
                gets its own card here. This is the case that was broken: the
                block used to live ONLY inside the `hasDiscount &&` card, so
                products without a discount showed no return policy and no
                Privacy Policy link at all. The policy comes from the product
                (or the seller's default) and has nothing to do with whether
                the item is on offer. Card shell matches the Check delivery
                card directly above it. */}
            {!hasDiscount && returnPolicyBlock && (
              <div className="mt-4 rounded-2xl border border-[#eaeaea] bg-white px-6 py-5">
                {returnPolicyBlock}
              </div>
            )}

            <div className='mt-10'>
              <h2 className="mb-4">
                <button
                  type="button"
                  onClick={() => setIsDescriptionOpen((open) => !open)}
                  aria-expanded={isDescriptionOpen}
                  className="flex items-center gap-2 w-full text-[20px] font-semibold text-[#1a1410]"
                >
                  <span>Description</span>
                  <ChevronDownIcon
                    height="24px"
                    style={{ color: '#000' }}
                    className={`transition-transform duration-300 ease-in-out ${isDescriptionOpen ? 'rotate-180' : 'rotate-0'
                      }`}
                  />
                </button>
              </h2>
              <div
                className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${isDescriptionOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
              >
                <div className="overflow-hidden">
                  <div className="text-[14px] text-[#575757] leading-[1.65]">
                    <div
                      className={`transition-all duration-300 ease-in-out ${!isDescriptionExpanded ? 'line-clamp-4' : ''
                        }`}
                    >
                      <RichTextView html={product.description || ''} />
                    </div>
                    {!isDescriptionExpanded && (
                      <button
                        type="button"
                        onClick={() => setIsDescriptionExpanded(true)}
                        className="mt-1 text-sm text-[#212121] group relative w-fit shrink-0"
                      >
                        Read more
                        <span
                          aria-hidden
                          className="absolute left-0 right-0 bottom-0 h-[1.5px] rounded-lg"
                          style={{ background: '#BDBDBD' }}
                        />
                        <span
                          aria-hidden
                          className="absolute left-0 bottom-0 h-[1.5px] w-0 rounded-lg transition-[width] duration-300 ease-out group-hover:w-full"
                          style={{ background: '#212121' }}
                        />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* SPECIFICATIONS block — flat zebra-stripe table per Figma
                node 3152-2640. Empty fields skip rendering so no "—"
                placeholders show up. Lives inside the LEFT column so it
                scrolls past the sticky right info panel. */}
            <div className='mt-4'>
              <h2 className="mb-4">
                <button
                  type="button"
                  onClick={() => setIsSpecificationsOpen((open) => !open)}
                  aria-expanded={isSpecificationsOpen}
                  className="flex items-center gap-2 w-full text-[20px] font-semibold text-[#1a1410]"
                >
                  <span>Specifications</span>
                  <ChevronDownIcon
                    height="24px"
                    style={{ color: '#000' }}
                    className={`transition-transform duration-300 ease-in-out ${isSpecificationsOpen ? 'rotate-180' : 'rotate-0'
                      }`}
                  />
                </button>
              </h2>
              <div
                className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${isSpecificationsOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
              >
                <div className="overflow-hidden">
                  {(() => {
                    const rows: Array<[string, string]> = [];
                    if (refName(product.brand)) rows.push(['Brand', refName(product.brand)]);
                    if (refName(product.category)) rows.push(['Category', refName(product.category)]);
                    if (refName(product.bike)) rows.push(['Compatible bike', refName(product.bike)]);
                    if ((product.sizes || []).length) rows.push(['Available sizes', (product.sizes || []).join(', ')]);
                    // Distinct variant color names — same union logic as the
                    // color-swatch picker (colorImages entries first, then
                    // any variants[].color not already covered).
                    const colorNames: string[] = [];
                    const seenColorNames = new Set<string>();
                    for (const ci of (product as any).colorImages || []) {
                      const name = (ci?.color || '').toString().trim();
                      if (name && !seenColorNames.has(name)) {
                        seenColorNames.add(name);
                        colorNames.push(name);
                      }
                    }
                    for (const v of (product as any).variants || []) {
                      const name = (v?.color || '').toString().trim();
                      if (name && !seenColorNames.has(name)) {
                        seenColorNames.add(name);
                        colorNames.push(name);
                      }
                    }
                    if (colorNames.length) rows.push(['Available colors', colorNames.join(', ')]);
                    return (

                      <div className="grid grid-cols-1 sm:grid-cols-2 border border-[#e0e0e0]">
                        {rows.map(([k, v], i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between gap-4 border-[#e0e0e0] px-4 py-2 text-[14px] [&:not(:last-child)]:border-b sm:odd:border-r sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0"
                          >
                            <span className="text-[#575757] leading-[1.65]">{k}</span>
                            <span className="text-[#000] font-semibold text-right leading-[1.32]">{v}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })
                    ()}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      {/* CUSTOMERS ALSO BOUGHT */}
      <RelatedProducts
        excludeId={product._id}
        categorySlug={refSlug(product.category)}
      />

      {/* A+ CONTENT IMAGES — Amazon-style marketing layout. Renders only
          when the seller has uploaded at least one A+ image. Slots:
          [0] and [1] sit side-by-side on top; [2] is a full-width banner
          below. Empty slots collapse gracefully. */}
      {Array.isArray(product.aPlusImages) && product.aPlusImages.some((k) => k) && (
        <section className="py-10">
          <div className="container">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {[0, 1].map((i) => {
                const key = product.aPlusImages![i];
                if (!key) return <div key={i} aria-hidden />;
                return (
                  <div key={i} className="rounded-2xl overflow-hidden bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl(key)} alt="" className="w-full h-auto md:h-[540px] block object-cover" loading="lazy" />
                  </div>
                );
              })}
            </div>
            {product.aPlusImages[2] && (
              <div className="rounded-2xl overflow-hidden bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(product.aPlusImages[2])} alt="" className="w-full h-auto block" loading="lazy" />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Legacy WATERPROOF feature block was here — it was echoing
          product.images.slice(1, 6) into a 2-column grid, which the
          seller correctly flagged as "why are my product images
          showing again after A+ Content." Removed entirely; A+ Content
          is now the last marketing block before Customer reviews. */}

      {/* CUSTOMER REVIEWS */}
      {(reviewsLoading || reviews.length > 0) && (
        <section id="reviews" className="py-12 border-t scroll-mt-30 border-[#eaeaea]">
          <div className="container">

            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-8 lg:gap-10">
              {/* Rating summary */}

              <div className='md:col-span-1 lg:col-span-2'>
                <h2 className="text-lg md:text-xl font-semibold text-[#141414]">
                  Customer reviews
                </h2>
                <div className="py-6 lg:p-6">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl lg:text-[28px] font-semibold text-[#0B0B0B] tabular-nums leading-[1.52]">
                      {rating.toFixed(1)} out of 5
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-2">
                    <Stars value={rating} size={5} />
                  </div>
                  <p className="text-base text-[#424242] mt-2">
                    Based on {reviewsCount} {reviewsCount === 1 ? 'review' : 'reviews'}
                  </p>
                </div>

                {/* Distribution bars */}
                <div className="flex flex-col gap-2 pb-6 lg:p-6">
                  {[5, 4, 3, 2, 1].map((n) => {
                    const count = distribution[n] || 0;
                    const total = Object.values(distribution).reduce(
                      (s, v) => s + v,
                      0
                    );
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                      <div key={n} className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-1 w-24 shrink-0">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <svg key={i} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
                              <g clipPath={`url(#dist-star-clip-${n}-${i})`}>
                                <path
                                  d="M16 6.18154L10.1863 5.79933L7.99681 0.298828L5.80734 5.79933L0 6.18154L4.45419 9.96361L2.99256 15.7008L7.99681 12.5376L13.0011 15.7008L11.5395 9.96361L16 6.18154Z"
                                  fill={i < n ? '#FFA500' : '#FEE085'}
                                />
                              </g>
                              <defs>
                                <clipPath id={`dist-star-clip-${n}-${i}`}>
                                  <rect width="16" height="16" fill="white" />
                                </clipPath>
                              </defs>
                            </svg>
                          ))}
                        </div>
                        <div className="flex-1 h-2 rounded-lg bg-[#F3F4F2] overflow-hidden">
                          <div className="h-full rounded-lg bg-[#000] " style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-right text-[#9e9e9e] text-sm tabular-nums leading-[1.52]">
                          {count}
                        </span>
                      </div>
                    );
                  })}
                </div>

              </div>

              {/* Reviews list — hidden entirely when there are no reviews
                (and we're done loading), instead of showing an empty-state
                placeholder. */}
              {(reviewsLoading || reviews.length > 0) && (
                <div className="md:col-span-2 lg:col-span-3 flex flex-col gap-4">
                  {reviewsLoading ? (
                    <div className="flex flex-col gap-3">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div
                          key={i}
                          className="rounded-2xl border border-[#eaeaea] bg-[#f5f5f5] p-5 animate-pulse h-28"
                        />
                      ))}
                    </div>
                  ) : (
                    reviews.map((r) => <ReviewItem key={r._id} review={r} />)
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Size chart modal — opens inline over the PDP when the shopper
          clicks "Size Table" next to the size selector. Uses the shared
          HeroUI Modal so the theme + focus trap match the rest of the
          storefront. Renders nothing when the seller has not uploaded a
          size chart image. */}
      {product.sizeChartImage && (
        <Modal
          isOpen={isSizeChartOpen}
          onOpenChange={setIsSizeChartOpen}
          size="2xl"
          scrollBehavior="inside"
          backdrop="opaque"
        >
          <ModalContent>
            {() => (
              <>
                <ModalHeader className="text-[16px] font-semibold text-[#1a1410]">
                  Size chart
                </ModalHeader>
                <ModalBody className="pb-6">
                  <div className="w-full relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageUrl(product.sizeChartImage)}
                      alt="Size chart"
                      className="w-full h-auto rounded-lg"
                    />
                  </div>
                </ModalBody>
              </>
            )}
          </ModalContent>
        </Modal>
      )}

      {/* ─── Gallery lightbox ──────────────────────────────────────────
          Full-screen viewer opened by clicking any gallery tile. Plain
          index-based <img> viewer (no Swiper) — Swiper measured 0 width
          on first mount inside a freshly-opened Modal, which rendered
          the broken tall-white-column layout this replaces. `activeImg`
          is both "which tile was clicked" and the current slide. */}
      <Modal
        isOpen={isGalleryLightboxOpen}
        onClose={() => setIsGalleryLightboxOpen(false)}
        size="full"
        backdrop="opaque"
        classNames={{
          base: 'bg-white',
          closeButton: 'z-30 top-4 right-4 bg-black text-white hover:bg-black/80 h-10 w-10 grid place-items-center rounded-full',
        }}
      >
        <ModalContent>
          <ModalBody className="p-0">
            {isGalleryLightboxOpen && (
              <div className="relative w-full h-[100dvh] flex flex-col">
                {/* Stage — centred, letterboxed image */}
                <div className="flex-1 min-h-0 grid place-items-center px-4 pt-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl(galleryImages[activeImg] || galleryImages[0])}
                    alt={`${product.name} — view ${activeImg + 1}`}
                    className="max-w-full max-h-[calc(100dvh-140px)] object-contain select-none"
                    draggable={false}
                  />
                </div>
                {/* Thumbnail strip + counter */}
                {galleryImages.length > 1 && (
                  <div className="shrink-0 flex flex-col items-center gap-2 pb-4 pt-3">
                    <div className="flex gap-2 overflow-x-auto max-w-full px-4 scrollbar-hide">
                      {galleryImages.map((src, idx) => (
                        <button
                          type="button"
                          key={idx}
                          onClick={() => setActiveImg(idx)}
                          aria-label={`Show image ${idx + 1}`}
                          className={`relative w-14 h-14 shrink-0 rounded-lg overflow-hidden border-2 transition ${idx === activeImg ? 'border-black' : 'border-transparent opacity-60 hover:opacity-100'
                            }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={imageUrl(src)} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                    <div className="text-xs text-[#757575] tabular-nums">
                      {activeImg + 1} / {galleryImages.length}
                    </div>
                  </div>
                )}
                {/* Prev / next */}
                {galleryImages.length > 1 && activeImg > 0 && (
                  <button
                    type="button"
                    aria-label="Previous image"
                    onClick={() => setActiveImg((i) => Math.max(0, i - 1))}
                    className="grid place-items-center absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 z-20 bg-[#EEE] shadow-[0_1px_2px_0_rgba(0,0,0,0.06)] rounded-full hover:text-white hover:bg-black transition"
                  >
                    <ChevronLeftIcon />
                  </button>
                )}
                {galleryImages.length > 1 && activeImg < galleryImages.length - 1 && (
                  <button
                    type="button"
                    aria-label="Next image"
                    onClick={() => setActiveImg((i) => Math.min(galleryImages.length - 1, i + 1))}
                    className="grid place-items-center absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 z-20 bg-[#EEE] shadow-[0_1px_2px_0_rgba(0,0,0,0.06)] rounded-full hover:text-white hover:bg-black transition"
                  >
                    <ChevronRightIcon />
                  </button>
                )}
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* ─── Write a review modal ─────────────────────────────────────
          Opens from the "Write a review" CTA in the ratings-summary
          column. Backend self-validates purchase/delivery eligibility
          on submit (POST /reviews), so no order context is needed here. */}
      <Modal
        isOpen={isWriteReviewOpen}
        onClose={() => setIsWriteReviewOpen(false)}
        placement="center"
        size="lg"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <div className="text-base font-bold text-brand-black">
              Write a review
            </div>
          </ModalHeader>
          <ModalBody className="flex flex-col gap-4">
            {/* Star rating selector — click sets the rating, hover
                shows a preview without committing. */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-default-600 mb-2">
                Your rating
              </div>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => {
                  const filled = n <= (reviewHover || reviewRating);
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setReviewRating(n)}
                      onMouseEnter={() => setReviewHover(n)}
                      onMouseLeave={() => setReviewHover(0)}
                      aria-label={`Rate ${n} star${n === 1 ? '' : 's'}`}
                      className="p-1 outline-none focus-visible:ring-0"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill={filled ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`w-8 h-8 transition ${filled
                          ? 'text-amber-500'
                          : 'text-default-300 hover:text-amber-400'
                          }`}
                      >
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                  );
                })}
                <span className="ml-2 text-sm font-semibold text-brand-black tabular-nums">
                  {reviewRating > 0
                    ? `${reviewRating}.0`
                    : <span className="text-default-500 font-normal italic">Tap to rate</span>}
                </span>
              </div>
            </div>

            {/* Optional headline */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-default-600 mb-2">
                Headline{' '}
                <span className="font-normal normal-case text-default-500">
                  (optional)
                </span>
              </div>
              <input
                type="text"
                value={reviewTitle}
                onChange={(e) => setReviewTitle(e.target.value)}
                maxLength={120}
                placeholder="Summarise your experience in one line"
                className="w-full px-3 py-2 rounded-lg border-2 border-default-200 focus:border-brand-black outline-none text-sm bg-white"
              />
            </div>

            {/* Comment */}
            <Textarea
              label="Your review"
              placeholder="What did you like or not like? How was the fit / quality / value?"
              isRequired
              minRows={4}
              maxRows={8}
              value={reviewComment}
              onValueChange={setReviewComment}
              variant="bordered"
            />

            {/* Optional photos — same upload-then-attach flow as the
                return/exchange evidence uploader elsewhere in the app. */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-default-600 mb-2">
                Add photos{' '}
                <span className="font-normal normal-case text-default-500">
                  (optional, up to 6)
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {reviewImages.map((img, idx) => (
                  <div key={idx} className="relative w-16 h-16 rounded-lg overflow-hidden border border-default-200 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl(img)} alt={`Review photo ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeReviewImage(idx)}
                      aria-label="Remove photo"
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white text-[10px] leading-none grid place-items-center hover:bg-black"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {reviewImages.length < 6 && (
                  <label className="w-16 h-16 rounded-lg border-2 border-dashed border-default-300 shrink-0 grid place-items-center cursor-pointer text-default-500 hover:border-brand-black hover:text-brand-black transition text-[10px] font-semibold text-center px-1">
                    {reviewImagesUploading ? (
                      <Spinner size="sm" />
                    ) : (
                      <>+ Add</>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={reviewImagesUploading}
                      onChange={handleReviewImagePick}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="text-[11px] text-default-500 leading-relaxed">
              Reviews are public on the product page. Be honest — other
              shoppers count on your feedback to make a call.
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setIsWriteReviewOpen(false)}>
              Cancel
            </Button>
            <Button
              color="primary"
              className="font-semibold"
              isLoading={reviewSaving}
              isDisabled={reviewImagesUploading}
              onPress={submitReview}
            >
              {reviewImagesUploading ? 'Uploading photos…' : 'Post review'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

/* ─── helper components ─────────────────────────────────────────────── */

function Stars({ value, size = 4 }: { value: number; size?: number }) {
  // Uses the same star path + orange/pale-yellow fill scheme as the
  // rating-distribution bars, so this component's stars render identically
  // wherever it's used. `uid` keeps each instance's clipPath ids unique so
  // multiple <Stars /> on the same page don't collide.
  const uid = useId();
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" className={`w-${size} h-${size}`}>
          <g clipPath={`url(#star-clip-${uid}-${i})`}>
            <path
              d="M16 6.18154L10.1863 5.79933L7.99681 0.298828L5.80734 5.79933L0 6.18154L4.45419 9.96361L2.99256 15.7008L7.99681 12.5376L13.0011 15.7008L11.5395 9.96361L16 6.18154Z"
              fill={i <= Math.round(value) ? '#FFA500' : '#FEE085'}
            />
          </g>
          <defs>
            <clipPath id={`star-clip-${uid}-${i}`}>
              <rect width="16" height="16" fill="white" />
            </clipPath>
          </defs>
        </svg>
      ))}
    </div>
  );
}

/** Single customer review card. */
function ReviewItem({ review }: { review: any }) {
  const name = review.customer?.name || 'Anonymous rider';
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((p: string) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const date = review.createdAt
    ? new Date(review.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    : '';
  const images: string[] = Array.isArray(review.images) ? review.images : [];
  // Lightbox — clicking a thumbnail opens a full-size viewer starting on
  // the tapped photo. `null` means closed. Same plain index-based <img>
  // viewer as the main product gallery lightbox (no Swiper) — `lightboxIndex`
  // doubles as both "is it open" and "which photo is showing".
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <div className="pb-10 last:pb-10 border-b border-[#E5E7EB] last:border-b-0">
      <div className="flex gap-2 mb-2 items-center">
        <div className="w-10 h-10 rounded-full bg-[#000] text-white grid place-items-center leading-[1.52] text-xs font-semibold shrink-0">
          {initials || '?'}
        </div>
        <p className="font-semibold text-base text-[#1a1410] truncate capitalize">{name}</p>
      </div>
      <div className="flex items-center justify-between gap-2s">
        <Stars value={review.rating || 0} />
        <span className="text-sm text-[#757575] font-semibold">{date}</span>
      </div>
      {review.title && (
        <p className="font-semibold text-base text-[#000] mt-6">
          {review.title}
        </p>
      )}
      <p className="text-sm text-[#424242] mt-2 leading-[1.65] whitespace-pre-wrap">
        {review.comment}
      </p>
      {images.length > 0 && (
        <Swiper slidesPerView="auto" spaceBetween={12} className="!mt-3 w-full">
          {images.map((img, idx) => (
            <SwiperSlide key={idx} className="!w-auto">
              <button
                type="button"
                onClick={() => setLightboxIndex(idx)}
                aria-label={`Open ${name}'s review photo ${idx + 1}`}
                className="block w-24 h-24 rounded-lg overflow-hidden border border-[#E5E7EB] shrink-0 cursor-pointer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(img)}
                  alt={`${name}'s review photo ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
              </button>
            </SwiperSlide>
          ))}
        </Swiper>
      )}

      {/* Lightbox — same plain full-screen index-based viewer as the main
          product gallery lightbox (thumbnail strip + counter + prev/next
          chevrons), instead of a Swiper-based dialog. */}
      <Modal
        isOpen={lightboxIndex !== null}
        onClose={() => setLightboxIndex(null)}
        size="full"
        backdrop="opaque"
        classNames={{
          base: 'bg-white',
          closeButton: 'z-30 top-4 right-4 bg-black text-white hover:bg-black/80 h-10 w-10 grid place-items-center rounded-full',
        }}
      >
        <ModalContent>
          <ModalBody className="p-0">
            {lightboxIndex !== null && (
              <div className="relative w-full h-[100dvh] flex flex-col">
                {/* Stage — centred, letterboxed image */}
                <div className="flex-1 min-h-0 grid place-items-center px-4 pt-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl(images[lightboxIndex] || images[0])}
                    alt={`${name}'s review photo ${lightboxIndex + 1}`}
                    className="max-w-full max-h-[calc(100dvh-140px)] object-contain select-none"
                    draggable={false}
                  />
                </div>
                {/* Thumbnail strip + counter */}
                {images.length > 1 && (
                  <div className="shrink-0 flex flex-col items-center gap-2 pb-4 pt-3">
                    <div className="flex gap-2 overflow-x-auto max-w-full px-4 scrollbar-hide">
                      {images.map((img, idx) => (
                        <button
                          type="button"
                          key={idx}
                          onClick={() => setLightboxIndex(idx)}
                          aria-label={`Show photo ${idx + 1}`}
                          className={`relative w-14 h-14 shrink-0 rounded-lg overflow-hidden border-2 transition ${idx === lightboxIndex ? 'border-black' : 'border-transparent opacity-60 hover:opacity-100'
                            }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={imageUrl(img)} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                    <div className="text-xs text-[#757575] tabular-nums">
                      {lightboxIndex + 1} / {images.length}
                    </div>
                  </div>
                )}
                {/* Prev / next */}
                {images.length > 1 && lightboxIndex > 0 && (
                  <button
                    type="button"
                    aria-label="Previous photo"
                    onClick={() => setLightboxIndex((i) => (i === null ? null : Math.max(0, i - 1)))}
                    className="grid place-items-center absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 z-20 bg-[#EEE] shadow-[0_1px_2px_0_rgba(0,0,0,0.06)] rounded-full hover:text-white hover:bg-black transition"
                  >
                    <ChevronLeftIcon />
                  </button>
                )}
                {images.length > 1 && lightboxIndex < images.length - 1 && (
                  <button
                    type="button"
                    aria-label="Next photo"
                    onClick={() => setLightboxIndex((i) => (i === null ? null : Math.min(images.length - 1, i + 1)))}
                    className="grid place-items-center absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 z-20 bg-[#EEE] shadow-[0_1px_2px_0_rgba(0,0,0,0.06)] rounded-full hover:text-white hover:bg-black transition"
                  >
                    <ChevronRightIcon />
                  </button>
                )}
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#eaeaea]">
      <span className="text-[#9e9e9e]">{label}</span>
      <span className="font-semibold text-[#1a1410] text-right">{value}</span>
    </div>
  );
}

/** Flat trust badge — icon over label, no tile background. */
function TrustItem({
  label,
  Icon,
}: {
  label: string;
  Icon: React.FC<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <Icon className="w-6 h-6 text-[#1a1410]" />
      <div className="text-xs font-medium text-[#424242] leading-tight">
        {label}
      </div>
    </div>
  );
}

/* ─── Related products rail ─────────────────────────────────────────── */

function RelatedProducts({
  excludeId,
  categorySlug,
}: {
  excludeId: string;
  // Shows other products in this same category (including its
  // subcategories, per the backend's category filter) — not scoped to seller.
  categorySlug?: string;
}) {
  const [items, setItems] = useState<ListingProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const relatedSwiperRef = useRef<SwiperType | null>(null);
  const [relatedAtStart, setRelatedAtStart] = useState(true);
  const [relatedAtEnd, setRelatedAtEnd] = useState(false);

  useEffect(() => {
    if (!categorySlug) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    api
      .get('/products', { params: { category: categorySlug, limit: 8 } }).then(envelopeOrLegacy)
      .then(({ data }) => {
        if (cancelled) return;
        const list: ListingProduct[] = (data.items || []).filter(
          (p: any) => p._id !== excludeId
        );
        setItems(list.slice(0, 4));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [excludeId, categorySlug]);

  if (!loading && items.length === 0) return null;

  return (
    <section className="border-t border-[#EEE] py-10 pb-0">
      <div className="container">
        <div className="relative">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-lg sm:text-xl font-semibold text-[#141414]">
              Customers who viewed this item also viewed
            </h2>
          </div>
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-10">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-[3/4] rounded-2xl bg-[#f5f5f5] animate-pulse"
                />
              ))}
            </div>
          ) : (
            <>
              <Swiper
                onSwiper={(s) => {
                  relatedSwiperRef.current = s;
                  setRelatedAtStart(s.isBeginning);
                  setRelatedAtEnd(s.isEnd);
                }}
                onSlideChange={(s) => {
                  setRelatedAtStart(s.isBeginning);
                  setRelatedAtEnd(s.isEnd);
                }}
                spaceBetween={16}
                slidesPerView={1.25}
                breakpoints={{
                  640: { slidesPerView: 2, spaceBetween: 20 },
                  1024: { slidesPerView: 3, spaceBetween: 24 },
                  1280: { slidesPerView: 4, spaceBetween: 24 },
                }}
                className='!pb-10 !pt-6'
              >
                {items.map((p) => (
                  <SwiperSlide key={p._id} className="!h-auto">
                    <ProductCard product={p} />
                  </SwiperSlide>
                ))}
              </Swiper>
              {!relatedAtStart && (
                <button
                  type="button"
                  aria-label="Scroll left"
                  onClick={() => relatedSwiperRef.current?.slidePrev()}
                  className="place-items-center absolute -left-4 top-1/2 -translate-y-1/2 hover:shadow-[0_4px_8px_-2px_rgba(0,0,0,0.12)]  z-2 w-8 h-12 bg-white/80 rounded-full hover:bg-default-50 transition"
                >
                  <ChevronLeftIcon />
                </button>
              )}
              {!relatedAtEnd && (
                <button
                  type="button"
                  aria-label="Scroll right"
                  onClick={() => relatedSwiperRef.current?.slideNext()}
                  className="place-items-center absolute -right-4 top-1/2 -translate-y-1/2 hover:shadow-[0_4px_8px_-2px_rgba(0,0,0,0.12)]  z-2 w-8 h-12 bg-white/80 rounded-full hover:bg-default-50 transition"
                >
                  <ChevronRightIcon />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ─── Delivery rate widget ─────────────────────────────────────────── */

function DeliveryRate({ slug }: { slug: string }) {
  const [pincode, setPincode] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<null | {
    ok: boolean;
    fee?: number;
    etaDays?: number | null;
    etaDate?: string | null;
    courier?: string;
    codAvailable?: boolean;
    reason?: string;
  }>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem('last_delivery_pincode');
      if (cached) setPincode(cached);
    }
  }, []);

  async function check() {
    const p = pincode.trim();
    if (!/^[1-9][0-9]{5}$/.test(p)) {
      setResult({ ok: false, reason: 'bad-pincode' });
      return;
    }
    setChecking(true);
    setResult(null);
    try {
      const { data } = await api.get(`/products/${slug}/shipping-rate`, {
        params: { pincode: p },
      }).then(envelopeOrLegacy);
      setResult(data);
      if (data.ok) localStorage.setItem('last_delivery_pincode', p);
    } catch (e: any) {
      const status = e?.response?.status;
      const msg = apiMessage(e) || 'Unknown error';
      console.error('[shipping-rate]', status, msg, e);
      setResult({
        ok: false,
        reason: 'error',
        // @ts-ignore — extra debug fields, not in the original type
        detail: status ? `${status} · ${msg}` : msg,
      } as any);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="mt-10 rounded-2xl border border-[#E0E0E0] bg-white p-6">
      <div className="flex gap-2 items-center mb-3">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M5 17C5 17.5304 5.21071 18.0391 5.58579 18.4142C5.96086 18.7893 6.46957 19 7 19C7.53043 19 8.03914 18.7893 8.41421 18.4142C8.78929 18.0391 9 17.5304 9 17M5 17C5 16.4696 5.21071 15.9609 5.58579 15.5858C5.96086 15.2107 6.46957 15 7 15C7.53043 15 8.03914 15.2107 8.41421 15.5858C8.78929 15.9609 9 16.4696 9 17M5 17H3V6C3 5.73478 3.10536 5.48043 3.29289 5.29289C3.48043 5.10536 3.73478 5 4 5H13V17M9 17H15M15 17C15 17.5304 15.2107 18.0391 15.5858 18.4142C15.9609 18.7893 16.4696 19 17 19C17.5304 19 18.0391 18.7893 18.4142 18.4142C18.7893 18.0391 19 17.5304 19 17M15 17C15 16.4696 15.2107 15.9609 15.5858 15.5858C15.9609 15.2107 16.4696 15 17 15C17.5304 15 18.0391 15.2107 18.4142 15.5858C18.7893 15.9609 19 16.4696 19 17M13 6H18L21 11V17H19M21 11H13" stroke="#212121" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-sm font-semibold text-[#757575]">
          Check delivery
        </p>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="City Pin Code"
          value={pincode}
          onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && check()}
          className="w-full p-3 h-12 rounded-lg border text-[#757575] bg-[#EEEEEE] border-transparent hover:border-[#] focus:border-[#1a1410] outline-none text-sm tabular-nums"
        />
        <Button
          className="font-semibold bg-white text-[#1a1410] border border-[#BDBDBD] hover:bg-[#F5F5F5] hover:border-transparent hover:shadow-[inset_0_-1px_2px_0_rgba(0,0,0,0.22),inset_1px_0_0_0_#EBEBEB,inset_-1px_0_0_0_#EBEBEB,inset_0_1px_0_0_#EBEBEB] h-12 rounded-lg font-normal"
          onPress={check}
          isLoading={checking}
        >
          Check
        </Button>
      </div>

      {result && (
        <div className="mt-3 text-sm leading-relaxed">
          {result.ok ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-emerald-900">
                <span className="font-semibold inline-flex items-center gap-1.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Estimated delivery:{' '}
                  {result.etaDate ||
                    (result.etaDays
                      ? `${result.etaDays} day${result.etaDays === 1 ? '' : 's'}`
                      : 'a few days')}
                </span>
                {/* Courier name intentionally not shown — internal detail
                    the shopper doesn't need ("via Delhivery Surface"). */}
              </div>
              {result.codAvailable ? (
                <span className="inline-flex items-center gap-1.5 self-start px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="6" width="20" height="12" rx="2" />
                    <circle cx="12" cy="12" r="3" />
                    <path d="M6 10v.01M18 10v.01M6 14v.01M18 14v.01" />
                  </svg>
                  COD Available
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 self-start px-2.5 py-1 rounded-full bg-[#f5f5f5] border border-[#eaeaea] text-[#424242] text-xs font-medium">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="4" y1="4" x2="20" y2="20" />
                    <rect x="2" y="6" width="20" height="12" rx="2" />
                  </svg>
                  Prepaid only at this pincode
                </span>
              )}
            </div>
          ) : (
            <div className="text-rose-700 text-sm">
              {result.reason === 'bad-pincode' &&
                'Please enter a valid 6-digit Indian pincode.'}
              {result.reason === 'unserviceable' &&
                'Sorry — no courier services this pincode for this product yet.'}
              {result.reason === 'no-couriers' &&
                'No couriers available to this pincode right now.'}
              {result.reason === 'seller-not-ready' &&
                "This seller hasn't been activated for shipping yet."}
              {result.reason === 'seller-excluded' &&
                "Sorry — this seller doesn't deliver to your pincode."}
              {result.reason === 'error' && (
                <>
                  Couldn&apos;t check delivery right now.{' '}
                  {/* @ts-ignore */}
                  {result.detail && (
                    <span className="text-xs text-[#9e9e9e]">
                      {/* @ts-ignore */}
                      ({result.detail})
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── inline icons ──────────────────────────────────────────────────── */

function ShieldIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function FeatherIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
      <line x1="16" y1="8" x2="2" y2="22" />
      <line x1="17.5" y1="15" x2="9" y2="15" />
    </svg>
  );
}
function RotateIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}
function SparkleIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 3l1.9 5.7L19 10l-5.1 1.3L12 17l-1.9-5.7L5 10l5.1-1.3L12 3z" />
    </svg>
  );
}
function BadgeCheckIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9 12l2 2 4-4" />
      <path d="M21 12c0 1.66-1.34 3-3 3 0 1.66-1.34 3-3 3-.94 0-1.78-.43-2.33-1.1-.55.67-1.39 1.1-2.33 1.1-1.66 0-3-1.34-3-3-1.66 0-3-1.34-3-3 0-.94.43-1.78 1.1-2.33C5.43 9.78 5 8.94 5 8c0-1.66 1.34-3 3-3 0-1.66 1.34-3 3-3 .94 0 1.78.43 2.33 1.1.55-.67 1.39-1.1 2.33-1.1 1.66 0 3 1.34 3 3 1.66 0 3 1.34 3 3 0 .94-.43 1.78-1.1 2.33.67.55 1.1 1.39 1.1 2.33z" />
    </svg>
  );
}
