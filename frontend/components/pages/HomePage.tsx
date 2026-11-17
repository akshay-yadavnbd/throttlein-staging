'use client';

/**
 * Home page — rebuilt from Figma "Home page" (node 2775:990).
 *
 * Section order (top → bottom):
 *   1.  Horizontal category strip with prev/next arrows
 *   2.  Full-width hero banner
 *   3.  "Best selling this month" — 5-up product carousel
 *   4a. Two-column promo block — Mobile Holders (4-image grid + chips)
 *   4b. Right column — Seasonal Collections (1 big image + chips)
 *   4c. Lower row — Bike Protection Accessories (4-image grid + chips)
 *   5.  "Recommended by bikers" — 4 large product cards
 *   6.  "Offers Section" — 5 product cards with chevron CTA
 *   7.  "Take your offline business online" — vendor banner
 *   8.  "Brands we deal with" — grid of brand logos
 *   9.  "Explore more" — chip cloud of SEO links
 *   11. SEO content block + second chip cloud
 *   12. Trust badges — 5 icons in a row
 *
 * Header (Navbar) + Footer come from the root layout, so this file
 * only renders the body sections.
 *
 * Live data passed via props from app/page.tsx:
 *   initialBanners, initialBestSellers, initialBrands, initialTrending,
 *   initialSellerCta, initialCategories, initialRecommended, initialOffers.
 * New section types (promo blocks, SEO chip lists, trust badges) ship
 * with hardcoded skeleton content until per-section admin singletons
 * are added later.
 */

import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { imageUrl } from '@/lib/api';
import { nameToSlug } from '@/lib/categorySlug';
import { sellerUrl } from '@/lib/sellerUrl';

/* ─────── Type defs (loose — we only read a few fields) ─────── */
type Banner = {
  _id?: string;
  image: string;
  imageMobile?: string;
  // Rich-overlay fields — when `title` is set, the banner renders a
  // text + brand-pills + CTA overlay on top of the bg image instead
  // of the bare image. All other rich fields are optional.
  title?: string;
  description?: string;
  brandLogos?: string[];
  ctaLabel?: string;
  ctaHref?: string;
  ctaTheme?: 'dark' | 'light';
  alt?: string;
  href?: string;
};
type Brand = { _id: string; name: string; slug?: string; logo?: string };
type Product = {
  _id: string;
  name: string;
  slug?: string;
  price: number;
  mrp?: number;
  images?: string[];
  discountPercent?: number;
  brand?: { name: string } | string;
  rating?: number;
  reviewsCount?: number;
};
type CategoryNode = {
  _id: string;
  name: string;
  slug?: string;
  icon?: string;
  children?: CategoryNode[];
};
type SellerCta = {
  heading?: string;
  subtext?: string;
  ctaLabel?: string;
  ctaHref?: string;
  image?: string;
} | null;

/* ─────── Hardcoded content (Phase 1 — admin-editable later) ─────── */

const PROMO_LEFT = {
  title: 'Mobile Holders & Navigation Accessories',
  chips: ['Phone mounts', 'Charging mounts', 'Waterproof phone cases', 'Navigation Screen'],
  cta: 'Explore Products',
  href: '/mobile-holders',
  images: [
    '/images/figma/promo-mobile-1.jpg',
    '/images/figma/promo-mobile-2.jpg',
    '/images/figma/promo-mobile-3.jpg',
    '/images/figma/promo-mobile-4.jpg',
  ],
};

const PROMO_RIGHT = {
  title: 'Seasonal Collections',
  chips: ['Chains', 'Inner Sleeves', 'Chest Cover Jackets', 'Waterproof Boots'],
  href: '/seasonal-collections',
  image: '/images/figma/promo-seasonal.jpg',
};

const PROMO_BOTTOM = {
  title: 'Bike Protection Accessories',
  chips: ['Crash guards', 'Frame sliders', 'Engine guards', 'Radiator guards'],
  cta: 'Explore Products',
  href: '/bike-protection',
  images: [
    '/images/figma/promo-protect-1.jpg',
    '/images/figma/promo-protect-2.jpg',
    '/images/figma/promo-protect-3.jpg',
    '/images/figma/promo-protect-4.jpg',
  ],
};

// Curated 10 categories for the homepage strip. Hardcoded rather
// than read from the live category tree so the homepage layout matches
// the Figma comp exactly regardless of how admins shape the tree.
// Phase 2: move into an admin singleton if marketing wants to rotate
// the lineup without a deploy.
// Sourced 1:1 from Figma node 2775:990 (Sections 01). Labels +
// imagery exactly match the comp. The Figma actually has 10 card
// slots but the last two are filler duplicates labelled "Helmets",
// so the curated set below is the 8 unique categories.
// Hrefs point at the restructured category slugs — see
// backend/scripts/restructure-categories.js for the taxonomy.
const HOME_CATEGORIES: { label: string; href: string; icon: string }[] = [
  { label: 'Helmets', href: '/helmets', icon: '/home/categories/helmets.webp' },
  { label: 'Jackets', href: '/riding-jackets', icon: '/home/categories/jackets.webp' },
  { label: 'Gloves', href: '/riding-gloves', icon: '/home/categories/gloves.webp' },
  { label: 'Riding Boots', href: '/riding-boots', icon: '/home/categories/shoes.webp' },
  { label: 'Luggage & Bags', href: '/luggage-touring', icon: '/home/categories/bags.webp' },
  { label: 'Bike Protection', href: '/bike-protection', icon: '/home/categories/bike-protection.webp' },
  { label: 'Rider Protection', href: '/protection-gear', icon: '/home/categories/knee-covers.webp' },
  { label: 'Lights', href: '/lighting', icon: '/home/categories/lights.webp' },
  { label: 'Exhaust', href: '/exhaust-systems', icon: '/home/categories/exhaust.webp' },
  { label: 'Rider Tech', href: '/mobile-navigation', icon: '/home/categories/bluetooth.webp' },
];

const EXPLORE_LINKS: { label: string; href: string }[] = [
  { label: 'Explore LS2 Helmets', href: '/helmets' },
  { label: 'Discover Rynox Gloves', href: '/riding-gloves' },
  { label: 'Purchase Stylish Jackets', href: '/riding-jackets' },
  { label: 'Check Out Head Lights', href: '/lighting' },
  { label: 'Investigate Protective Gear', href: '/protection-gear' },
  { label: 'Locate Riding Boots', href: '/riding-boots' },
  { label: 'Browse Safety Accessories', href: '/security' },
  { label: 'Select Motorcycle Apparel', href: '/apparel' },
  { label: 'Uncover Essential Gear', href: '/products' },
  { label: 'Find Performance Accessories', href: '/performance-parts' },
  { label: 'Shop for Riding Equipment', href: '/products' },
  { label: 'View Our Safety Gear', href: '/protection-gear' },
  { label: 'Discover Your Riding Essentials', href: '/products' },
  { label: 'Check Out Your Motorcycle Gear', href: '/products' },
  { label: 'Explore Our Riding Accessories', href: '/products' },
  { label: 'Browse New Safety Equipment', href: '/bike-safety' },
];

const SEO_INTRO = {
  heading: 'Discover our extensive range of bike accessories Throttlein is your go-to marketplace for all things biking.',
  body: "Whether you're gearing up for a new ride or looking to upgrade your current setup, Throttlein is here to inspire you with budget-friendly bike accessory solutions. From helmets to protective gear, we have something for every rider. Shopping at Throttlein is a unique experience compared to traditional retail. It's about immersing yourself in hands-on solutions and discovering ideas that fit your biking lifestyle. That's why we offer over 10,000 products and services for you to explore. When you visit Throttlein, feel free to interact with our product displays. Test the comfort of our helmets, examine the quality of our gear, and explore our wide range of accessories. Each product tag provides essential information, including where to find it in our store. Most of our products are designed for easy transport, making it simple to take your new gear home.",
};

const TRUST_BADGES: { label: string; Icon: (p: { className?: string }) => React.JSX.Element }[] = [
  { label: 'Top Brands', Icon: BadgeIcon },
  { label: 'Authentic Products', Icon: ShieldIcon },
  { label: 'Super fast delivery', Icon: TruckIcon },
  { label: 'Easy Returns', Icon: ReturnIcon },
  { label: 'Secure payment', Icon: LockIcon },
];

/* ─────── Helpers ─────── */

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

function categoryHref(c: CategoryNode): string {
  return `/${c.slug || nameToSlug(c.name)}`;
}

/* ─────── Main component ─────── */

export default function HomePage({
  initialBanners = [],
  initialBestSellers = [],
  initialBrands = [],
  initialSellerCta = null,
  initialCategories = [],
  initialRecommended = [],
  initialOffers = [],
  initialPromoBlocks = [],
  initialHomeSeoBlock = null,
}: {
  initialBanners?: Banner[];
  initialBestSellers?: Product[];
  initialBrands?: Brand[];
  initialSellerCta?: SellerCta;
  initialCategories?: CategoryNode[];
  initialRecommended?: Product[];
  initialOffers?: Product[];
  initialPromoBlocks?: PromoBlock[];
  initialHomeSeoBlock?: HomeSeoBlock;
}) {
  // Still streamed in by the server for forward compatibility, but
  // the redesigned 2775:990 layout doesn't render it directly.
  void initialCategories;

  // The Offers carousel prefers discounted products, but if nothing in
  // the curated list has a discount we still want to render the section
  // — fall back to the raw list so the carousel isn't blank.
  const offers = useMemo(() => {
    const withDiscount = initialOffers.filter(
      (p) => (p.discountPercent || 0) > 0 || (p.mrp || 0) > p.price,
    );
    return (withDiscount.length > 0 ? withDiscount : initialOffers).slice(0, 5);
  }, [initialOffers]);

  // SEO safety net — the hero banner renders <h1>{b.title}</h1> only
  // when the first banner actually has a title. If the CMS returns no
  // banners (or every banner is image-only) the entire homepage would
  // ship without a single h1 in view-source. Fall back to a visually
  // hidden brand heading so crawlers, screen readers, and Lighthouse
  // audits never see the page as headless. Rendered only when there's
  // no banner with a title so we don't end up with two h1s.
  const hasBannerTitle = initialBanners.some((b) => !!b?.title);
  return (
    <main className="bg-[#fff]">
      {!hasBannerTitle && (
        <h1 className="sr-only">
          THROTTLEIN — India&apos;s Motorcycle Gear &amp; Parts Marketplace
        </h1>
      )}
      <CategoriesRow categories={HOME_CATEGORIES} />
      <HeroBanner banners={initialBanners} />
      <ProductCarousel
        title="Best selling this month"
        // No slice — the server already caps this rail (12: riding
        // jackets + riding pants, best-rated first). The carousel shows
        // ~5 per viewport and the chevrons loop through the rest.
        products={initialBestSellers}
        ctaLabel="Shop all"
        ctaHref="/products"
      />
      <PromoBlocks blocks={initialPromoBlocks} />
      <RecommendedRow products={initialRecommended.slice(0, 4)} />
      <OffersSection products={offers} />
      <VendorBanner cta={initialSellerCta} />
      <BrandsGrid brands={initialBrands} />
      <ExploreLinks heading="Explore more" block={initialHomeSeoBlock} />
      <SeoContent block={initialHomeSeoBlock} />
      <TrustBadges />
    </main>
  );
}

/* ─────── 1. Categories row ─────── */

type HomeCategory = { label: string; href: string; icon: string };

type HomeSeoBlock = {
  _id?: string;
  heading: string;
  body: string;
  /** Top chip cloud — "Explore more" heading above the prose. */
  links: { label: string; href: string }[];
  /** Bottom chip cloud — rendered immediately below the prose.
   *  Optional for back-compat; falls back to an empty array. */
  bottomLinks?: { label: string; href: string }[];
  isActive: boolean;
} | null;

type PromoBlock = {
  _id: string;
  title: string;
  variant: 'image-grid' | 'single-image';
  chips: { label: string; href: string }[];
  ctaLabel: string;
  ctaHref: string;
  images: string[];
  order: number;
  isActive: boolean;
};

function CategoriesRow({ categories }: { categories: HomeCategory[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  function scrollBy(dx: number) {
    scrollerRef.current?.scrollBy({ left: dx, behavior: 'smooth' });
  }
  if (categories.length === 0) return null;
  return (
    // Section is now bg/spacing only — the inner `.container` div
    // controls width + horizontal padding, matching the convention
    // used by every other home section. The chevron scroll buttons
    // are absolutely positioned relative to the inner container so
    // they sit inside the content area, not at the viewport edges.
    <section className="py-5 bg-[#fff]">
      <div className="container relative">
        <div
          ref={scrollerRef}
          className="flex gap-6 overflow-x-auto scroll-smooth scrollbar-hide"
        >
          {categories.map((c) => (
            <Link
              key={c.label}
              href={c.href}
              className="group shrink-0 w-[121px] max-h-[147.5px] flex flex-col items-center gap-2"
            >
              <div className="w-[121px] h-[121px] rounded-2xl bg-[#f3f4f2] border border-[#eaeae6] grid place-items-center overflow-hidden transition-colors duration-200 group-hover:bg-[#E2E3DD]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c.icon}
                  alt={c.label}
                  width={96}
                  height={96}
                  loading='lazy'
                  className="object-contain w-24 h-24 mix-blend-multiply transition-transform duration-300 group-hover:scale-[1.125]"
                />
              </div>
              <span className="text-[12px] leading-[1.3] font-medium text-[#141414] text-center line-clamp-1">
                {c.label}
              </span>
            </Link>
          ))}
        </div>
        <button
          type="button"
          aria-label="Scroll categories left"
          onClick={() => scrollBy(-400)}
          className="hidden md:flex items-center justify-center absolute left-[20px] top-[36px] w-8 h-12 rounded-full bg-white/80 backdrop-blur-sm hover:bg-white transition-colors z-10"
        >
          <ChevronLeftIcon />
        </button>
        <button
          type="button"
          aria-label="Scroll categories right"
          onClick={() => scrollBy(400)}
          className="hidden md:flex items-center justify-center absolute right-[20px] top-[36px] w-8 h-12 rounded-full bg-white/80 backdrop-blur-sm hover:bg-white transition-colors z-10"
        >
          <ChevronRightIcon />
        </button>
      </div>
    </section>
  );
}

/* ─────── 2. Hero banner ─────── */

/* HeroBanner — rotating carousel of every active Home Banner row
   (managed in admin → /pages/home → Hero banners).
   - All slides are stacked in one absolute layer; the active one
     fades in over 600ms, the rest fade out. Crossfade rather than
     translate-X avoids the layout-shift CLS hit of a marquee strip.
   - Auto-advance every 6s. Pauses on hover and when the tab is
     hidden (visibilitychange) so we don't burn cycles in the bg.
   - Dot indicators below the image + prev/next chevrons that
     show up on hover (md+).
   - If only one banner exists, dots/chevrons hide automatically.
   - Each slide auto-switches between "image-only" (legacy) and
     "rich overlay" (title + brand pills + description + CTA button)
     depending on whether the admin set the rich fields. */
function HeroBanner({ banners }: { banners: Banner[] }) {
  // Filter to slides that actually have an image so we don't render
  // empty black panels for half-saved admin rows.
  const slides = (banners || []).filter((b) => b && b.image);
  // Only ONE H1 per page: the first slide that carries a title renders
  // it as <h1>; every other titled slide uses <h2> with identical
  // styling (SEO-correct heading hierarchy, zero visual difference).
  const firstTitledIdx = slides.findIndex((b) => !!b.title);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Keep index in range if the slide count changes (e.g. revalidate
  // brings back fewer banners than before).
  useEffect(() => {
    if (index >= slides.length) setIndex(0);
  }, [index, slides.length]);

  // Auto-advance. Skipped when paused or when only one slide exists.
  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % slides.length);
    }, 6000);
    return () => clearInterval(id);
  }, [paused, slides.length]);

  // Pause on tab-hidden so background tabs don't keep firing the
  // timer (also avoids snap-to-current-slide jank when the user
  // returns hours later).
  useEffect(() => {
    function onVis() {
      setPaused(document.hidden);
    }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const heroDragRef = useRef({ down: false, startX: 0, moved: false });

  if (slides.length === 0) {
    return (
      <section className="bg-white pb-5">
        <div className="container" />
      </section>
    );
  }

  const goPrev = () =>
    setIndex((i) => (i - 1 + slides.length) % slides.length);
  const goNext = () => setIndex((i) => (i + 1) % slides.length);

  // Drag-to-swipe — the crossfade stack isn't a scroll container, so a
  // horizontal mouse drag past the 50px threshold flips to the prev /
  // next slide instead. `moved` suppresses the click that would
  // otherwise navigate via the slide's <Link> when the drag releases.
  function onHeroDragStart(e: React.MouseEvent) {
    heroDragRef.current = { down: true, startX: e.pageX, moved: false };
  }
  function onHeroDragEnd(e: React.MouseEvent) {
    const d = heroDragRef.current;
    if (!d.down) return;
    d.down = false;
    const dx = e.pageX - d.startX;
    if (Math.abs(dx) > 50 && slides.length > 1) {
      d.moved = true;
      if (dx < 0) goNext();
      else goPrev();
    }
  }
  function onHeroClickCapture(e: React.MouseEvent) {
    if (heroDragRef.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      heroDragRef.current.moved = false;
    }
  }
  // Touch mirror of the mouse handlers — phones have no cursor and fire
  // touch events instead of mousedown/up, so without these the hero
  // couldn't be finger-swiped at all. Vertical page scrolling is
  // unaffected (we never preventDefault on the move itself).
  function onHeroTouchStart(e: React.TouchEvent) {
    heroDragRef.current = { down: true, startX: e.touches[0].pageX, moved: false };
  }
  function onHeroTouchEnd(e: React.TouchEvent) {
    const d = heroDragRef.current;
    if (!d.down) return;
    d.down = false;
    const dx = e.changedTouches[0].pageX - d.startX;
    if (Math.abs(dx) > 50 && slides.length > 1) {
      d.moved = true; // suppress the follow-up click on the slide link
      if (dx < 0) goNext();
      else goPrev();
    }
  }

  return (
    <section
      /* pb-8, not the pb-5 every other section joint uses: this is the
         hero → first-content boundary, where a 360px image sat only
         20px above the "Best selling" card and read as cramped. 32px
         gives the first section room to breathe without touching the
         uniform 20px rhythm between the card sections below. */
      className="pb-8"
      style={{
        background:
          'linear-gradient(180deg, #FFF 0%, rgba(255, 255, 255, 0.00) 100%), var(--background-secondary, #F3F4F2)',
      }}
    >
      <div className="container">
        <div
          className="relative group"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {/* Crossfade stack —
              Aspect is portrait (3:4) on mobile so the mobile-specific
              banner image displays tall like the Figma comp, capped at
              the Figma max-height of 696px. Desktop (lg+) switches to
              the wide 1432:578 hero ratio with no max-height. */}
          <div
            onMouseDown={onHeroDragStart}
            onMouseUp={onHeroDragEnd}
            onMouseLeave={onHeroDragEnd}
            onTouchStart={onHeroTouchStart}
            onTouchEnd={onHeroTouchEnd}
            onClickCapture={onHeroClickCapture}
            className="relative w-full overflow-hidden rounded-2xl bg-[#0d0d0d] aspect-[3/4] h-[696px] lg:aspect-[1432/578] lg:h-auto lg:max-h-[577px] cursor-grab active:cursor-grabbing select-none [&_img]:pointer-events-none"
          >

            {slides.map((b, i) => {
              const active = i === index;
              const alt = b.alt || b.title || 'Featured banner';
              // Whole-banner click target — used for image-only slides
              // OR as a fallback when a rich slide has no CTA. Falls
              // back to '/' so the click area is always defined.
              const href = b.href || b.ctaHref || '/';
              const desktopSrc = imageUrl(b.image);
              const mobileSrc = b.imageMobile
                ? imageUrl(b.imageMobile)
                : desktopSrc;
              // "Rich" mode: any of title / description / ctaLabel set.
              const rich = !!(b.title || b.description || b.ctaLabel);

              // Shared image block — sits behind the overlay (rich)
              // OR is the entire slide content (image-only).
              // Mobile-vs-desktop image switch at the `lg` breakpoint
              // (1024px). Both variants use `object-cover` to fill
              // the frame; mobile readability comes from the black
              // gradient overlay (added below in the rich branch).
              const imageEl = (
                <>
                  <Image
                    src={mobileSrc}
                    alt={alt}
                    fill
                    priority={i === 0}
                    sizes="100vw"
                    className="object-cover lg:hidden"
                  />
                  <Image
                    src={desktopSrc}
                    alt={alt}
                    fill
                    priority={i === 0}
                    sizes="(min-width: 1024px) 1432px, 100vw"
                    className="object-cover hidden lg:block"
                  />
                </>
              );

              const slideClasses = `absolute inset-0 transition-opacity duration-300 ease-out ${active
                ? 'opacity-100 pointer-events-auto'
                : 'opacity-0 pointer-events-none'
                }`;

              // Image-only slides — keep the legacy Link-wraps-image
              // behaviour so the whole banner is one click target.
              if (!rich) {
                return (
                  <Link
                    key={b._id || i}
                    href={href}
                    aria-label={alt}
                    aria-hidden={!active}
                    tabIndex={active ? 0 : -1}
                    className={slideClasses}
                  >
                    {imageEl}
                  </Link>
                );
              }

              // Rich slides — overlay copy + brand pills + CTA on
              // top of the bg image. The image itself isn't clickable;
              // the CTA button drives navigation. (If admin still set
              // `href`, the title also links so screen-reader users
              // get the same affordance.)
              return (
                <div
                  key={b._id || i}
                  aria-hidden={!active}
                  className={slideClasses}
                >
                  {imageEl}
                  {/* Mobile-only gradient overlay per Figma node
                      2964:1323 — solid black 0→40%, fades through 82%
                      black at ~53%, fully transparent by 66%+. Hides
                      the upper portion of the image so the overlay
                      copy reads cleanly without darkening the entire
                      banner. Hidden on lg+ since the desktop layout
                      uses image-cover with content on the left half. */}
                  <div
                    aria-hidden
                    className="absolute inset-0 lg:hidden bg-gradient-to-b from-black from-40% via-black/80 via-[53%] to-transparent to-[66%]"
                  />
                  <div className="relative h-full max-w-[1432px] mx-auto px-5 lg:px-14 flex items-start pt-8 lg:items-center lg:pt-0">
                    <div className="max-w-[560px] flex flex-col gap-4 lg:gap-5 text-white">
                      {b.title && (() => {
                        // First titled slide is the page's single <h1>;
                        // the rest are <h2>. Same classes on both, so
                        // the visual rendering is identical — only the
                        // heading semantics differ (40px Poppins Medium
                        // mobile / 5xl SemiBold desktop, Figma 2964:1327).
                        const HeadingTag = (i === firstTitledIdx ? 'h1' : 'h2') as 'h1' | 'h2';
                        return (
                          <HeadingTag className="text-[40px] leading-[1.2] tracking-[-1.5px] font-medium lg:text-5xl lg:leading-[1.1] lg:tracking-[-0.5px] lg:font-semibold">
                            {b.href ? (
                              <Link href={href} tabIndex={active ? 0 : -1} className="hover:underline underline-offset-4">
                                {b.title}
                              </Link>
                            ) : (
                              b.title
                            )}
                          </HeadingTag>
                        );
                      })()}

                      {b.brandLogos && b.brandLogos.length > 0 && (
                        // Outer dark capsule wraps all logo pills as a
                        // single chip group. Background is a low-alpha
                        // white over whatever banner BG sits behind it,
                        // so the chip reads on both dark and light
                        // banner artwork. Inner pills are solid white.
                        <div className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/10 p-1.5 backdrop-blur-sm">
                          {b.brandLogos.map((logo, li) => (
                            <span
                              key={`${logo}-${li}`}
                              className="inline-flex items-center justify-center h-9 px-4 rounded-full bg-white"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={imageUrl(logo)}
                                alt=""
                                aria-hidden
                                className="max-h-5 max-w-[96px] object-contain"
                              />
                            </span>
                          ))}
                        </div>
                      )}

                      {b.description && (
                        <p className="text-sm sm:text-base text-white/85 leading-relaxed max-w-[480px]">
                          {b.description}
                        </p>
                      )}

                      {b.ctaLabel && (
                        <div>
                          <Link
                            href={b.ctaHref || href}
                            tabIndex={active ? 0 : -1}
                            className={
                              b.ctaTheme === 'light'
                                ? 'inline-flex items-center px-5 py-2.5 rounded-md bg-white text-[#141414] text-sm  hover:bg-white/90 transition shadow-[inset_0_0.5px_0.5px_1px_rgba(255,255,255,0.32),inset_0_-1px_0_1px_#000]'
                                : 'inline-flex items-center px-5 py-2.5 rounded-md bg-[#141414] text-white text-sm hover:bg-black/85 transition shadow-[inset_0_0.5px_0.5px_1px_rgba(255,255,255,0.32),inset_0_-1px_0_1px_#000]'
                            }
                          >
                            {b.ctaLabel}
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Prev / next chevrons — visible only when there's more
              than one slide. Appear on hover (md+) to keep the
              banner clean by default. */}
          {slides.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous banner"
                onClick={goPrev}
                className="hidden md:grid absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 place-items-center rounded-full bg-white/90 hover:bg-white text-[#141414] shadow-md transition opacity-0 group-hover:opacity-100"
              >
                <ChevronLeftIcon className="w-5 h-5" />
              </button>
              <button
                type="button"
                aria-label="Next banner"
                onClick={goNext}
                className="hidden md:grid absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 place-items-center rounded-full bg-white/90 hover:bg-white text-[#141414] shadow-md transition opacity-0 group-hover:opacity-100"
              >
                <ChevronRightIcon className="w-5 h-5" />
              </button>
            </>
          )}

          {/* Dot indicators */}
          {slides.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
              {slides.map((_, i) => {
                const active = i === index;
                return (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Go to banner ${i + 1}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => setIndex(i)}
                    className={`transition-all rounded-full ${active
                      ? 'w-6 h-2 bg-white'
                      : 'w-2 h-2 bg-white/50 hover:bg-white/80'
                      }`}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ─────── 3 & 6. Product carousel ─────── */

function ProductCarousel({
  title,
  products,
  ctaLabel,
  ctaHref,
  cardKind = 'price',
}: {
  title: string;
  products: Product[];
  ctaLabel?: string;
  ctaHref?: string;
  cardKind?: 'price' | 'chip';
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Drag-to-scroll — the grab cursor promises dragging, so deliver it.
  // Mouse-only (touch already scrolls natively). `moved` suppresses the
  // click that would otherwise fire on the card the drag started over,
  // so releasing a drag doesn't navigate to a product page.
  const dragRef = useRef({ down: false, startX: 0, startLeft: 0, moved: false });
  function onDragStart(e: React.MouseEvent) {
    const el = scrollerRef.current;
    if (!el) return;
    dragRef.current = { down: true, startX: e.pageX, startLeft: el.scrollLeft, moved: false };
  }
  function onDragMove(e: React.MouseEvent) {
    const d = dragRef.current;
    const el = scrollerRef.current;
    if (!d.down || !el) return;
    const dx = e.pageX - d.startX;
    if (Math.abs(dx) > 5) d.moved = true;
    el.scrollLeft = d.startLeft - dx;
  }
  function onDragEnd() {
    dragRef.current.down = false;
  }
  function onClickCapture(e: React.MouseEvent) {
    if (dragRef.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current.moved = false;
    }
  }
  // Loop-aware scrollBy — when the row is already at one end and the
  // user clicks the chevron pointing past that end, snap to the other
  // end instead of stopping. Tolerance of 2px to handle sub-pixel
  // scroll positions on retina screens.
  function scrollBy(dx: number) {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (dx > 0 && el.scrollLeft >= max - 2) {
      el.scrollTo({ left: 0, behavior: 'smooth' });
    } else if (dx < 0 && el.scrollLeft <= 2) {
      el.scrollTo({ left: max, behavior: 'smooth' });
    } else {
      el.scrollBy({ left: dx, behavior: 'smooth' });
    }
  }
  if (products.length === 0) return null;
  // Carousel chevrons only make sense when the row actually overflows.
  // The 4-up layout fits at desktop widths; anything > 4 needs the
  // looping slider, anything ≤ 4 renders as a static row.
  const showChevrons = products.length > 4;
  return (
    <section className="bg-[#F3F4F2] pb-5 pt-5" >
      <div className="container">
        <div className="relative bg-[#fff] rounded-[16px] p-6">
          <div className="flex items-end justify-between gap-4 mb-6">
            <h2 className="text-2xl font-semibold text-[#141414]">{title}</h2>
            {ctaLabel && ctaHref && (
              <Link
                href={ctaHref}
                className="shrink-0 inline-flex items-center justify-center px-4 py-3 rounded-lg text-sm font-medium text-[#fff] bg-[#000] whitespace-nowrap"
              >
                {ctaLabel}
              </Link>
            )}
          </div>
          <div
            ref={scrollerRef}
            onMouseDown={onDragStart}
            onMouseMove={onDragMove}
            onMouseUp={onDragEnd}
            onMouseLeave={onDragEnd}
            onClickCapture={onClickCapture}
            // NOTE: no scroll-smooth here while dragging would fight the
            // 1:1 pointer tracking — chevrons use scrollTo/scrollBy with
            // behavior:'smooth' explicitly instead.
            // [&_img]:pointer-events-none stops the browser's native
            // image-drag ghost from hijacking the drag gesture; clicks
            // still work because the wrapping <Link> receives them.
            className="flex gap-6 overflow-x-auto scrollbar-hide cursor-grab active:cursor-grabbing select-none [&_img]:pointer-events-none"
          >
            {products.map((p) =>
              cardKind === 'chip' ? (
                <OfferCard key={p._id} product={p} />
              ) : (
                <ProductCardLite key={p._id} product={p} />
              ),
            )}
          </div>
          {showChevrons && (
            <>
              <button
                type="button"
                aria-label="Scroll left"
                onClick={() => scrollBy(-400)}
                className="hidden md:flex items-center justify-center absolute left-[5px] top-[55%] -translate-y-1/2 w-8 h-12 rounded-full bg-white/80 backdrop-blur-sm hover:bg-white transition-colors z-10"
              >
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                aria-label="Scroll right"
                onClick={() => scrollBy(400)}
                className="hidden md:flex items-center justify-center absolute right-[5px] top-[55%] -translate-y-1/2 w-8 h-12 rounded-full bg-white/80 backdrop-blur-sm hover:bg-white transition-colors z-10"
              >
                <ChevronRightIcon />
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ProductCardLite({ product }: { product: Product }) {
  const img = (product as any).listingImage || product.images?.[0];
  // URL: /product/<catalog-slug>?id=<productId>. See ProductCard.
  const slugForUrl = (product as any).catalog?.slug || product.slug;
  const href = slugForUrl ? `/product/${slugForUrl}?id=${product._id}` : '#';
  return (
    // No card border per Figma node 2775:1054 — cards sit borderless
    // on the parent white panel. Only the image area gets the cream
    // background tile + rounded corners; the text below floats
    // edge-to-edge under it.
    <Link
      href={href}
      className="shrink-0 w-[258px] hover:opacity-90 transition"
    >
      <div className="relative w-full aspect-square bg-[#f3f4f2] rounded-2xl overflow-hidden">
        {img && (
          <Image
            src={imageUrl(img)}
            alt={product.name}
            fill
            sizes="258px"
            className="object-contain mix-blend-multiply"
          />
        )}
      </div>
      <div className="pt-3">
        <div className="text-sm text-[#141414] line-clamp-1">{product.name}</div>
        <div className="mt-1 text-base font-semibold text-[#141414]">₹ {inr(product.price)}</div>
      </div>
    </Link>
  );
}

function OfferCard({ product }: { product: Product }) {
  const img = (product as any).listingImage || product.images?.[0];
  // URL: /product/<catalog-slug>?id=<productId>. See ProductCard.
  const slugForUrl = (product as any).catalog?.slug || product.slug;
  const href = slugForUrl ? `/product/${slugForUrl}?id=${product._id}` : '#';
  // Discount badge — prefer the live-offer decoration (discountPercent
  // set by resolveOffers) and fall back to the mrp/price gap. Rounded
  // to a whole percent; hidden when there's no real discount.
  const mrp = Number(product.mrp) || 0;
  const price = Number(product.price) || 0;
  const pct = Math.round(
    Number((product as any).discountPercent) ||
    (mrp > price && mrp > 0 ? ((mrp - price) / mrp) * 100 : 0),
  );
  return (
    <Link
      href={href}
      className="shrink-0 w-[258px] rounded-2xl border border-[#eee] bg-white overflow-hidden hover:shadow-md transition"
    >
      <div className="relative w-full aspect-square bg-[#f3f4f2] overflow-hidden">
        {img && (
          <Image
            src={imageUrl(img)}
            alt={product.name}
            fill
            sizes="258px"
            className="object-contain mix-blend-multiply"
          />
        )}
        {pct > 0 && (
          <span className="absolute top-2.5 right-2.5 z-10 rounded-md bg-[#0d0d0d] text-white text-xs font-semibold px-2 py-1 shadow-sm">
            {pct}% OFF
          </span>
        )}
      </div>
      <div className="px-3 py-3 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-[#141414] line-clamp-1">{product.name}</span>
        <ChevronRightIcon className="w-4 h-4 shrink-0" />
      </div>
    </Link>
  );
}

/* ─────── 4. Promo blocks ─────── */

/* ───────────────────────────── PromoBlocks ─────────────────────────────
   Section 05 — admin-managed promo blocks. The admin can mix two
   variants: `image-grid` (4-square mosaic + text) and `single-image`
   (one big image + chip cloud). The layout is a 2/1 column split where
   image-grid blocks stack in the wide left column and single-image
   blocks stack in the narrow right column. When only ONE variant
   exists we collapse to a single full-width column. */
function PromoBlocks({ blocks }: { blocks: PromoBlock[] }) {
  if (!blocks || blocks.length === 0) return null;

  const gridBlocks = blocks.filter((b) => b.variant === 'image-grid');
  const singleBlocks = blocks.filter((b) => b.variant === 'single-image');

  const onlyGrids = singleBlocks.length === 0;
  const onlySingles = gridBlocks.length === 0;

  return (
    <section className="bg-[#F3F4F2] pb-5">
      <div className="container">
        <div
          className={
            onlyGrids || onlySingles
              ? 'grid grid-cols-1 gap-6'
              : 'grid grid-cols-1 lg:grid-cols-3 gap-6'
          }
        >
          {/* Left / wide column — image-grid variants */}
          {gridBlocks.length > 0 ? (
            <div
              className={
                onlyGrids
                  ? 'flex flex-col gap-6'
                  : 'lg:col-span-2 flex flex-col gap-6'
              }
            >
              {gridBlocks.map((b, i) => (
                <PromoFourImageCard
                  key={b._id}
                  title={b.title}
                  chips={b.chips}
                  ctaLabel={b.ctaLabel}
                  ctaHref={b.ctaHref}
                  images={b.images}
                  imagesLeft={i % 2 === 0}
                />
              ))}
            </div>
          ) : null}

          {/* Right / narrow column — single-image variants */}
          {singleBlocks.length > 0 ? (
            <div
              className={
                onlySingles
                  ? 'grid grid-cols-1 sm:grid-cols-2 gap-6'
                  : 'flex flex-col gap-6'
              }
            >
              {singleBlocks.map((b) => (
                <PromoSingleImageCard
                  key={b._id}
                  title={b.title}
                  chips={b.chips}
                  ctaHref={b.ctaHref}
                  image={b.images?.[0]}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── PromoFourImageCard ─────────────────────────
   "image-grid" variant (despite the legacy name, it now renders a
   SINGLE large image on one side and copy on the other). The image
   side alternates left/right per block index so consecutive blocks
   have visual rhythm.

   Layout per Figma node 2775:1066 — the copy column uses justify-
   between with internal vertical padding so the title+chips block
   floats around 22% from the top and the underline CTA sits about
   22% from the bottom (mirroring the 69px top/bottom margins from
   the comp). Chips are passive labels (no link); the underline CTA
   is the single click target. */
function PromoFourImageCard({
  title,
  chips,
  ctaLabel,
  ctaHref,
  images,
  imagesLeft,
}: {
  title: string;
  chips: { label: string; href: string }[];
  ctaLabel: string;
  ctaHref: string;
  images: string[];
  imagesLeft: boolean;
}) {
  // First image only — extra images in the array are reserved for
  // admin convenience (quick swap) but not rendered.
  const src = images && images[0] ? images[0] : '';

  const ImageSide = (
    // Image height capped at 318px on desktop per Figma node 2775:1066
    // (image frame is 319×318 in the comp). Mobile keeps aspect-square
    // so the image stays proportional when the card stacks vertically.
    <div className="w-full sm:w-1/2 shrink-0">
      <div className="relative w-full aspect-square sm:aspect-auto sm:h-[318px] rounded-xl bg-[#f3f4f2] overflow-hidden">
        {src ? (
          <Image
            src={imageUrl(src)}
            alt={title}
            fill
            sizes="(min-width: 1024px) 318px, 100vw"
            className="object-cover"
          />
        ) : null}
      </div>
    </div>
  );

  const Copy = (
    // Vertical padding pushes the title+chip block down from the top
    // edge and the CTA up from the bottom edge, matching the Figma
    // 69px top/bottom inset rather than the previous flush-top look.
    <div className="flex-1 flex flex-col justify-between py-6 md:py-10">
      <div className="flex flex-col gap-4">
        <h3 className="text-2xl md:text-3xl font-semibold leading-tight text-[#141414]">
          {title}
        </h3>
        {chips && chips.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {chips.map((c, i) => (
              <span
                key={`${c.label}-${i}`}
                className="inline-flex items-center px-3 h-8 rounded-full border border-black/20 text-sm text-[#424242]"
              >
                {c.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="pt-6">
        <Link
          href={ctaHref}
          className="inline-flex items-center gap-2 text-sm font-medium underline underline-offset-2 text-[#141414] hover:text-black"
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  );

  return (
    <div className="rounded-2xl border border-[#e5e7eb] bg-white p-6 flex flex-col sm:flex-row gap-6">
      {imagesLeft ? ImageSide : Copy}
      {imagesLeft ? Copy : ImageSide}
    </div>
  );
}

/* ───────────────────────── PromoSingleImageCard ─────────────────────────
   "single-image" variant — per Figma node 2775:1093 the bottom half
   of the card is a light-blue panel (#b1d5ff) carrying the title,
   chip cloud and a black circular chevron CTA pinned bottom-right.
   The image occupies the top half (aspect 445/386 from Figma).

   The entire card is a Link so the chevron isn't the only affordance
   — clicking anywhere on the image OR the blue area navigates to
   ctaHref. Chips are passive labels (border-black/24, gray text)
   matching the Figma chip style. */
function PromoSingleImageCard({
  title,
  chips,
  ctaHref,
  image,
}: {
  title: string;
  chips: { label: string; href: string }[];
  ctaHref: string;
  image?: string;
}) {
  return (
    <Link
      href={ctaHref}
      className="group block rounded-2xl overflow-hidden hover:shadow-sm transition-shadow flex flex-col h-full"
    >
      {/* Top half — product imagery. Aspect locked to Figma 445×386. */}
      <div
        className="relative w-full bg-[#f3f4f2]"
        style={{ aspectRatio: '445 / 386' }}
      >
        {image ? (
          <Image
            src={imageUrl(image)}
            alt={title}
            fill
            sizes="(min-width: 1024px) 445px, 100vw"
            className="object-cover"
          />
        ) : null}
      </div>
      {/* Bottom half — light-blue panel. justify-between pins the
          title+chip block to the top and the chevron CTA to the
          bottom-right. min-h matches the image height for symmetry. */}
      <div
        className="bg-[#b1d5ff] p-6 flex flex-col items-start justify-between flex-1"
        style={{ minHeight: '350px' }}
      >
        <div className="w-full flex flex-col gap-2">
          <h3 className="text-[28px] font-semibold leading-[1.52] text-[#141414]">
            {title}
          </h3>
          {chips && chips.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {chips.map((c, i) => (
                <span
                  key={`${c.label}-${i}`}
                  className="inline-flex items-center px-2.5 h-8 rounded-full border border-black/20 bg-transparent text-sm text-[#424242]"
                >
                  {c.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="w-full flex justify-end pt-6">
          <span className="grid place-items-center w-12 h-12 rounded-full bg-black text-white shadow-sm group-hover:bg-[#141414] transition">
            <ChevronRightIcon className="w-5 h-5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

/* Cycled review snippets — no review schema in the DB yet, so the
   testimonial cards display curated copy that loops over the products.
   Index stays stable per grid slot. */
const RECOMMENDED_REVIEWS = [
  'Incredible quality and performance! This product exceeded my expectations in every way.',
  'Absolutely love this item! It has made my riding experience so much better.',
  'A must-have for any rider! The features are top-notch and very user-friendly.',
  "This product is simply fantastic! I can't imagine my rides without it.",
];

function StarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 17.27 5.82 21l1.64-7.03L2 9.24l7.19-.61L12 2l2.81 6.63L22 9.24l-5.46 4.73L18.18 21z" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.418 3.582-7 8-7s8 2.582 8 7" strokeLinecap="round" />
    </svg>
  );
}

function RecommendedRow({ products }: { products: Product[] }) {
  if (!products || products.length === 0) return null;
  return (
    // Outer section uses the page's secondary surface tone so the
    // white "card" container floats on the same warm-grey backdrop
    // used between other home sections.
    <section className="bg-[#F3F4F2] pb-5">
      <div className="container">
        {/* White card container — 16px radius + 24px inner padding
            per Figma spec. Holds the section heading and the
            4-up testimonial grid. */}
        <div className="bg-white rounded-2xl p-6">
          <h2 className="text-2xl font-semibold leading-tight mb-6 text-[#141414]">
            Recommended by bikers
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {products.map((p, i) => (
              // Index in key so cycled/repeated products don't collide.
              // Pass `index` so the review snippet stays stable per slot.
              <RecommendedCard
                key={`${p._id}-${i}`}
                product={p}
                index={i}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* Testimonial-style card matching Figma node 2775:1142 — black frame,
   rounded product image, white star rating pill (★ 5.9 (2K)) at the
   top-left, and a floating white review card overlapping the bottom
   of the image with avatar + product name + 3-line review snippet. */
function RecommendedCard({
  product,
  index,
}: {
  product: Product;
  index: number;
}) {
  const img = imageUrl((product as any).listingImage || product.images?.[0]);
  const href = `/product/${(product as any).catalog?.slug || product.slug || product._id}?id=${product._id}`;
  const review = RECOMMENDED_REVIEWS[index % RECOMMENDED_REVIEWS.length];
  return (
    // Matches Figma CSS exactly:
    //   border-radius: 8px;
    //   background: linear-gradient(180deg, rgba(0,0,0,0) 50%, #000 100%),
    //               url(<image>) lightgray 50% / cover no-repeat;
    // Image fills the card edge-to-edge; the lower half fades to black
    // so the floating white review chip stays readable on any photo.
    <Link
      href={href}
      className="block relative rounded-lg overflow-hidden aspect-[4/5] bg-white hover:shadow-md transition-shadow"
    >
      {/* Product image — `object-contain` so the FULL product is
          always visible (no head/foot crop). The light-gray card bg
          fills any remaining space around the product. */}
      <Image
        src={img}
        alt={product.name}
        fill
        sizes="(min-width: 1024px) 320px, 50vw"
        className="object-contain p-4"
      />

      {/* Bottom-half black gradient overlay — sits ABOVE the image but
          BELOW the rating pill / review card. Transparent through the
          top half, then ramps to full black at the bottom. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent from-50% to-black"
      />

      {/* Rating pill — top-left, floating on the image. Rendered from
          the product's REAL rating + review count; hidden entirely
          until the product has at least one review (no fake "5.9 (2K)"
          placeholder). */}
      {(product.reviewsCount ?? 0) > 0 && (
        <div className="absolute top-3 left-3 inline-flex items-center gap-1 h-6 px-2 rounded-full bg-white shadow-sm">
          <StarIcon className="w-3.5 h-3.5 text-[#141414]" />
          <span className="text-xs font-semibold text-black leading-none">
            {(product.rating ?? 0).toFixed(1)} ({product.reviewsCount})
          </span>
        </div>
      )}

      {/* Floating review card — white panel pinned 12px from each
          edge at the bottom, sitting OVER the gradient. */}
      <div className="absolute left-3 right-3 bottom-3 flex gap-3 items-start rounded-lg bg-white p-3 shadow-sm">
        <div className="shrink-0 grid place-items-center p-2 rounded-lg bg-[#e2e3dd]">
          <UserIcon className="w-4 h-4 text-[#141414]" />
        </div>
        <div className="min-w-0 flex flex-col gap-0.5 self-stretch">
          <div className="text-xs font-semibold text-black truncate">
            {product.name}
          </div>
          <p className="text-xs text-[#141414] leading-[1.52] line-clamp-2">
            {review}
          </p>
        </div>
      </div>
    </Link>
  );
}

/* ───────────────────────── OffersSection ─────────────────────────
   Section 06 — thin wrapper around ProductCarousel that pins the
   `chip` card variant and the section title. Returns null is delegated
   to the carousel itself when the products list is empty. */
function OffersSection({ products }: { products: Product[] }) {
  return (
    <ProductCarousel
      title="Offers Section"
      products={products}
      cardKind="chip"
    />
  );
}

/* ───────────────────────── VendorBanner ─────────────────────────
   Section 07 — "Take your offline business online" rail. Driven by
   the singleton /seller-cta record so marketing can swap the copy
   + photograph without a deploy. Skips when no record is configured. */
function VendorBanner({ cta }: { cta: SellerCta }) {
  if (!cta) return null;
  // Figma copy as fallback. Real content comes from /api/seller-cta
  // (admin-managed via /pages/home → Seller CTA accordion).
  const heading = cta.heading || 'Take your offline business online';
  const subtext = cta.subtext || 'Onboard in 48 hours. Reach 2M+ riders. Zero setup fees.';
  const label = cta.ctaLabel || 'Become a Vendor';
  // Default to the seller site (subdomain in production). Admin can
  // still override via the Seller CTA record's ctaHref.
  const href = cta.ctaHref || sellerUrl();
  // Use the admin-uploaded image when present; otherwise fall back
  // to the static art at /public/home/seller-section.png.
  const img = cta.image ? imageUrl(cta.image) : '/home/seller-section.webp';
  return (
    <section className="bg-[#F3F4F2] pb-5">
      <div className="container">
        {/* Light cream card containing a 2-col grid. The image side
            has its own rounded corners (slightly smaller than the
            card) and sits inside the cream padding, matching the
            Figma comp. */}
        <div className="rounded-2xl bg-[#f3f4ef] grid grid-cols-1 lg:grid-cols-2 items-stretch gap-4 sm:gap-6">
          <div className="py-6 md:py-10 flex flex-col justify-center">
            <h2 className="text-2xl md:text-3xl font-semibold leading-tight text-[#141414]">
              {heading}
            </h2>
            <p className="mt-5 text-base md:text-lg text-[#5e5e5e] max-w-xl leading-relaxed">
              {subtext}
            </p>
            <div className="mt-7">
              {/* Seller CTA opens in a NEW TAB so shoppers keep their
                  storefront session while exploring the seller site. */}
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-5 py-3 rounded-lg bg-[#0d0d0d] text-white text-sm font-medium hover:bg-black/85 transition"
              >
                {label}
              </a>
            </div>
          </div>
          <div className="relative min-h-[260px] md:min-h-[380px] rounded-xl overflow-hidden bg-[#0d0d0d]">
            <Image
              src={img}
              alt={heading}
              fill
              sizes="(min-width: 1024px) 700px, 100vw"
              className="object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────── Section dividers below are kept for navigation ─────── */

/* ─────── Icons ─────── */

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

/* ───────────────────────── Trust badge icons ─────────────────────────
   Verbatim Figma SVGs (node 2775:1320..1350) — multi-layer fill:
   solid black silhouette + lime #D3FF33 overlay + white-to-transparent
   gradient highlight. Scoped gradient/clip IDs per icon (badge/shield/
   truck/return/lock) so multiple icons can render on one page without
   ID collisions. Width/height come from the className prop. */
function BadgeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 72 72" fill="none">
      <path d="M36 4.5C30.6599 4.5 25.4397 6.08352 20.9996 9.05032C16.5595 12.0171 13.0988 16.2339 11.0553 21.1675C9.0117 26.1012 8.47701 31.53 9.51881 36.7674C10.5606 42.0049 13.1321 46.8159 16.9081 50.5919C20.6841 54.3679 25.4951 56.9394 30.7326 57.9812C35.9701 59.023 41.3989 58.4883 46.3325 56.4447C51.2661 54.4012 55.4829 50.9405 58.4497 46.5004C61.4165 42.0603 63 36.8401 63 31.5C63 24.3392 60.1554 17.4716 55.0919 12.4081C50.0284 7.34463 43.1609 4.5 36 4.5ZM51.165 28.8225C49.0525 30.3446 47.4782 32.4986 46.6694 34.9736C45.8605 37.4486 45.859 40.1166 46.665 42.5925C46.7701 43.0307 46.7412 43.4904 46.582 43.912C46.4229 44.3337 46.1407 44.6978 45.7722 44.9572C45.4037 45.2166 44.9658 45.3593 44.5152 45.367C44.0646 45.3746 43.6221 45.2468 43.245 45C41.1437 43.4692 38.611 42.6445 36.0113 42.6445C33.4115 42.6445 30.8788 43.4692 28.7775 45C28.3929 45.2812 27.9289 45.433 27.4524 45.4336C26.976 45.4342 26.5116 45.2835 26.1263 45.0032C25.741 44.723 25.4545 44.3277 25.3083 43.8742C25.162 43.4207 25.1635 42.9326 25.3125 42.48C26.1185 40.0041 26.117 37.3361 25.3082 34.8611C24.4993 32.3861 22.9251 30.2321 20.8125 28.71C20.4703 28.4189 20.223 28.0319 20.1027 27.599C19.9823 27.1661 19.9943 26.7071 20.1371 26.2811C20.2799 25.855 20.547 25.4815 20.904 25.2087C21.2609 24.9358 21.6914 24.776 22.14 24.75C24.7238 24.7334 27.2365 23.9025 29.3208 22.3756C31.4052 20.8487 32.9551 18.7035 33.75 16.245C33.898 15.7948 34.1843 15.4029 34.5681 15.125C34.9519 14.8472 35.4137 14.6976 35.8875 14.6976C36.3614 14.6976 36.8231 14.8472 37.2069 15.125C37.5908 15.4029 37.8771 15.7948 38.025 16.245C38.8317 18.7402 40.4156 20.9117 42.5451 22.442C44.6746 23.9723 47.2379 24.7811 49.86 24.75C50.3362 24.7483 50.8006 24.8977 51.1865 25.1767C51.5723 25.4557 51.8597 25.85 52.0073 26.3027C52.1549 26.7554 52.155 27.2433 52.0077 27.6961C51.8604 28.1489 51.5732 28.5433 51.1875 28.8225H51.165Z" fill="#D3FF33" />
      <path d="M36 4.5C30.6599 4.5 25.4397 6.08352 20.9996 9.05032C16.5595 12.0171 13.0988 16.2339 11.0553 21.1675C9.0117 26.1012 8.47701 31.53 9.51881 36.7674C10.5606 42.0049 13.1321 46.8159 16.9081 50.5919C20.6841 54.3679 25.4951 56.9394 30.7326 57.9812C35.9701 59.023 41.3989 58.4883 46.3325 56.4447C51.2661 54.4012 55.4829 50.9405 58.4497 46.5004C61.4165 42.0603 63 36.8401 63 31.5C63 24.3392 60.1554 17.4716 55.0919 12.4081C50.0284 7.34463 43.1609 4.5 36 4.5ZM51.165 28.8225C49.0525 30.3446 47.4782 32.4986 46.6694 34.9736C45.8605 37.4486 45.859 40.1166 46.665 42.5925C46.7701 43.0307 46.7412 43.4904 46.582 43.912C46.4229 44.3337 46.1407 44.6978 45.7722 44.9572C45.4037 45.2166 44.9658 45.3593 44.5152 45.367C44.0646 45.3746 43.6221 45.2468 43.245 45C41.1437 43.4692 38.611 42.6445 36.0113 42.6445C33.4115 42.6445 30.8788 43.4692 28.7775 45C28.3929 45.2812 27.9289 45.433 27.4524 45.4336C26.976 45.4342 26.5116 45.2835 26.1263 45.0032C25.741 44.723 25.4545 44.3277 25.3083 43.8742C25.162 43.4207 25.1635 42.9326 25.3125 42.48C26.1185 40.0041 26.117 37.3361 25.3082 34.8611C24.4993 32.3861 22.9251 30.2321 20.8125 28.71C20.4703 28.4189 20.223 28.0319 20.1027 27.599C19.9823 27.1661 19.9943 26.7071 20.1371 26.2811C20.2799 25.855 20.547 25.4815 20.904 25.2087C21.2609 24.9358 21.6914 24.776 22.14 24.75C24.7238 24.7334 27.2365 23.9025 29.3208 22.3756C31.4052 20.8487 32.9551 18.7035 33.75 16.245C33.898 15.7948 34.1843 15.4029 34.5681 15.125C34.9519 14.8472 35.4137 14.6976 35.8875 14.6976C36.3614 14.6976 36.8231 14.8472 37.2069 15.125C37.5908 15.4029 37.8771 15.7948 38.025 16.245C38.8317 18.7402 40.4156 20.9117 42.5451 22.442C44.6746 23.9723 47.2379 24.7811 49.86 24.75C50.3362 24.7483 50.8006 24.8977 51.1865 25.1767C51.5723 25.4557 51.8597 25.85 52.0073 26.3027C52.1549 26.7554 52.155 27.2433 52.0077 27.6961C51.8604 28.1489 51.5732 28.5433 51.1875 28.8225H51.165Z" fill="url(#paint0_linear_badge)" />
      <path d="M10.2375 49.5L5.15253 54.6525C4.85122 54.9326 4.63245 55.2899 4.52001 55.6856C4.40757 56.0813 4.40576 56.5002 4.51478 56.8969C4.6238 57.2935 4.83948 57.6527 5.13837 57.9353C5.43726 58.218 5.80791 58.4133 6.21003 58.5L14.3775 60.5475L18.405 66.5775C18.5934 66.8381 18.8355 67.0553 19.115 67.2144C19.3944 67.3736 19.7048 67.4709 20.025 67.5H20.25C20.5461 67.5017 20.8397 67.445 21.1138 67.333C21.388 67.221 21.6373 67.056 21.8475 66.8475L27.0225 61.6725C20.2142 59.6254 14.2986 55.3354 10.2375 49.5Z" fill="#D3FF33" />
      <path d="M10.2375 49.5L5.15253 54.6525C4.85122 54.9326 4.63245 55.2899 4.52001 55.6856C4.40757 56.0813 4.40576 56.5002 4.51478 56.8969C4.6238 57.2935 4.83948 57.6527 5.13837 57.9353C5.43726 58.218 5.80791 58.4133 6.21003 58.5L14.3775 60.5475L18.405 66.5775C18.5934 66.8381 18.8355 67.0553 19.115 67.2144C19.3944 67.3736 19.7048 67.4709 20.025 67.5H20.25C20.5461 67.5017 20.8397 67.445 21.1138 67.333C21.388 67.221 21.6373 67.056 21.8475 66.8475L27.0225 61.6725C20.2142 59.6254 14.2986 55.3354 10.2375 49.5Z" fill="url(#paint1_linear_badge)" />
      <path d="M66.8475 54.6525L61.7625 49.5C57.7072 55.3313 51.8001 59.6209 45 61.6725L50.175 66.8475C50.5941 67.2632 51.1597 67.4975 51.75 67.5H51.975C52.3048 67.4662 52.6231 67.3599 52.907 67.1888C53.191 67.0176 53.4336 66.7858 53.6175 66.51L57.645 60.48L65.79 58.5C66.1767 58.4027 66.5306 58.2044 66.8154 57.9254C67.1003 57.6464 67.3059 57.2968 67.4112 56.9122C67.5165 56.5276 67.5177 56.122 67.4147 55.7368C67.3117 55.3516 67.1082 55.0007 66.825 54.72L66.8475 54.6525Z" fill="#D3FF33" />
      <path d="M66.8475 54.6525L61.7625 49.5C57.7072 55.3313 51.8001 59.6209 45 61.6725L50.175 66.8475C50.5941 67.2632 51.1597 67.4975 51.75 67.5H51.975C52.3048 67.4662 52.6231 67.3599 52.907 67.1888C53.191 67.0176 53.4336 66.7858 53.6175 66.51L57.645 60.48L65.79 58.5C66.1767 58.4027 66.5306 58.2044 66.8154 57.9254C67.1003 57.6464 67.3059 57.2968 67.4112 56.9122C67.5165 56.5276 67.5177 56.122 67.4147 55.7368C67.3117 55.3516 67.1082 55.0007 66.825 54.72L66.8475 54.6525Z" fill="url(#paint2_linear_badge)" />
      <defs>
        <linearGradient id="paint0_linear_badge" x1="36" y1="4.5" x2="36" y2="58.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="paint1_linear_badge" x1="15.7284" y1="49.5" x2="15.7284" y2="67.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="paint2_linear_badge" x1="56.2455" y1="49.5" x2="56.2455" y2="67.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 72 72" fill="none">
      <path fillRule="evenodd" clipRule="evenodd" d="M4.13514 21.9446V49.1427C4.13179 49.3857 4.19414 49.625 4.31562 49.8354C4.43709 50.0458 4.61316 50.2194 4.82521 50.338L28.3795 63.937C28.5881 64.0614 28.8266 64.1271 29.0695 64.1271C29.3125 64.1271 29.5509 64.0614 29.7596 63.937L39.3853 58.3796C39.256 57.8029 39.2262 57.2085 39.2971 56.6218L39.5583 54.4381C39.5821 54.2982 39.5567 54.1544 39.4864 54.0311L38.4943 52.0683C37.9899 51.08 37.8213 49.9543 38.014 48.8617C38.2066 47.769 38.7501 46.7689 39.562 46.0127L41.1656 44.5076C41.2739 44.4158 41.3471 44.2893 41.3726 44.1496L41.8739 42.0087C42.1214 40.9268 42.7155 39.9553 43.5657 39.2418C44.4159 38.5284 45.4759 38.1121 46.5844 38.0563L48.7803 37.9341C48.9222 37.9333 49.0594 37.8833 49.1687 37.7928L50.9294 36.4749C51.8153 35.8068 52.8943 35.4445 54.0039 35.4427V21.9448C54.0072 21.7019 53.9449 21.4626 53.8234 21.2522C53.7019 21.0418 53.5259 20.8681 53.3138 20.7496L45.1522 16.0373L20.2179 30.4331V40.5756C20.2179 40.6967 20.186 40.8157 20.1255 40.9206C20.0649 41.0255 19.9778 41.1126 19.8729 41.1732C19.768 41.2338 19.649 41.2656 19.5278 41.2656C19.4067 41.2656 19.2877 41.2338 19.1828 41.1732L13.677 37.9944C13.4649 37.8759 13.2888 37.7022 13.1673 37.4918C13.0459 37.2814 12.9835 37.0421 12.9869 36.7992V26.2583L37.9211 11.8625L29.7596 7.1505C29.5509 7.02612 29.3125 6.96045 29.0695 6.96045C28.8266 6.96045 28.5881 7.02612 28.3795 7.1505L4.82521 20.7494C4.61318 20.868 4.43712 21.0416 4.31565 21.252C4.19418 21.4624 4.13181 21.7017 4.13514 21.9446ZM59.2365 47.7626C59.3339 47.8696 59.4093 47.9948 59.4584 48.131C59.5074 48.2672 59.5292 48.4117 59.5224 48.5563C59.5156 48.7009 59.4803 48.8427 59.4187 48.9737C59.3571 49.1047 59.2703 49.2223 59.1632 49.3197L52.9498 54.9584L52.9437 54.9646C52.7366 55.1716 52.4558 55.2879 52.1631 55.2879C51.8703 55.2879 51.5895 55.1716 51.3825 54.9646L48.8057 52.3879C48.6008 52.1804 48.4862 51.9002 48.4872 51.6085C48.4881 51.3169 48.6044 51.0374 48.8106 50.8312C49.0169 50.625 49.2964 50.5088 49.5881 50.5079C49.8797 50.5071 50.1599 50.6217 50.3674 50.8267L52.2017 52.6609L57.68 47.6893C57.8961 47.4927 58.1815 47.39 58.4734 47.4038C58.7653 47.4175 59.0397 47.5466 59.2365 47.7626ZM67.5427 51.0722L66.5505 53.0349C66.2836 53.5466 66.1811 54.1281 66.2569 54.7002L66.5179 56.8839C66.5988 57.5115 66.4712 58.1484 66.1548 58.6964C65.8384 59.2445 65.3506 59.6734 64.7666 59.9172L62.745 60.7831C62.2116 61.0034 61.7592 61.3829 61.4496 61.87L60.2459 63.7105C59.9045 64.2434 59.3974 64.6492 58.8027 64.8657C58.208 65.0821 57.5586 65.0972 56.9545 64.9085L54.8493 64.2723C54.2991 64.0982 53.7086 64.0982 53.1584 64.2723L51.0532 64.9085C50.4491 65.0972 49.7998 65.0822 49.2051 64.8657C48.6104 64.6492 48.1033 64.2434 47.7619 63.7105L46.5581 61.87C46.2486 61.3829 45.7962 61.0033 45.2627 60.7831L43.2411 59.9172C42.6571 59.6734 42.1693 59.2445 41.8529 58.6964C41.5365 58.1484 41.4089 57.5115 41.4898 56.8839L41.7508 54.7002C41.8266 54.1281 41.7241 53.5466 41.4572 53.0349L40.465 51.0722C40.1743 50.5101 40.0763 49.868 40.1862 49.2447C40.2961 48.6214 40.6078 48.0516 41.0733 47.6228L42.6769 46.1177C43.1027 45.7282 43.3979 45.2169 43.5224 44.6534L44.0239 42.5119C44.1625 41.8945 44.5003 41.3397 44.9851 40.9329C45.4699 40.5261 46.0749 40.2899 46.7071 40.2606L48.9029 40.1385C49.4793 40.1138 50.0341 39.9118 50.4916 39.5602L52.2524 38.2423C52.7554 37.8584 53.3707 37.6504 54.0036 37.6504C54.6364 37.6504 55.2517 37.8584 55.7548 38.2423L57.5156 39.5602C57.9731 39.9119 58.528 40.1138 59.1045 40.1385L61.3004 40.2606C61.9325 40.2899 62.5376 40.5261 63.0224 40.9329C63.5072 41.3397 63.8449 41.8945 63.9835 42.5119L64.4852 44.6534C64.6095 45.2169 64.9048 45.7283 65.3306 46.1177L66.9342 47.6228C67.3996 48.0516 67.7113 48.6214 67.8213 49.2447C67.9312 49.8679 67.8333 50.51 67.5427 51.0722ZM62.1833 51.3442C62.1833 49.7265 61.7035 48.1451 60.8048 46.8C59.906 45.455 58.6286 44.4066 57.134 43.7875C55.6395 43.1684 53.9949 43.0065 52.4083 43.322C50.8216 43.6376 49.3642 44.4166 48.2203 45.5605C47.0764 46.7044 46.2974 48.1618 45.9818 49.7484C45.6661 51.3351 45.8281 52.9796 46.4472 54.4742C47.0662 55.9688 48.1146 57.2463 49.4596 58.145C50.8047 59.0438 52.3861 59.5235 54.0038 59.5236C56.1731 59.5236 58.2536 58.6618 59.7875 57.1279C61.3214 55.594 62.1832 53.5135 62.1833 51.3442Z" fill="#D3FF33" />
      <path fillRule="evenodd" clipRule="evenodd" d="M4.13514 21.9446V49.1427C4.13179 49.3857 4.19414 49.625 4.31562 49.8354C4.43709 50.0458 4.61316 50.2194 4.82521 50.338L28.3795 63.937C28.5881 64.0614 28.8266 64.1271 29.0695 64.1271C29.3125 64.1271 29.5509 64.0614 29.7596 63.937L39.3853 58.3796C39.256 57.8029 39.2262 57.2085 39.2971 56.6218L39.5583 54.4381C39.5821 54.2982 39.5567 54.1544 39.4864 54.0311L38.4943 52.0683C37.9899 51.08 37.8213 49.9543 38.014 48.8617C38.2066 47.769 38.7501 46.7689 39.562 46.0127L41.1656 44.5076C41.2739 44.4158 41.3471 44.2893 41.3726 44.1496L41.8739 42.0087C42.1214 40.9268 42.7155 39.9553 43.5657 39.2418C44.4159 38.5284 45.4759 38.1121 46.5844 38.0563L48.7803 37.9341C48.9222 37.9333 49.0594 37.8833 49.1687 37.7928L50.9294 36.4749C51.8153 35.8068 52.8943 35.4445 54.0039 35.4427V21.9448C54.0072 21.7019 53.9449 21.4626 53.8234 21.2522C53.7019 21.0418 53.5259 20.8681 53.3138 20.7496L45.1522 16.0373L20.2179 30.4331V40.5756C20.2179 40.6967 20.186 40.8157 20.1255 40.9206C20.0649 41.0255 19.9778 41.1126 19.8729 41.1732C19.768 41.2338 19.649 41.2656 19.5278 41.2656C19.4067 41.2656 19.2877 41.2338 19.1828 41.1732L13.677 37.9944C13.4649 37.8759 13.2888 37.7022 13.1673 37.4918C13.0459 37.2814 12.9835 37.0421 12.9869 36.7992V26.2583L37.9211 11.8625L29.7596 7.1505C29.5509 7.02612 29.3125 6.96045 29.0695 6.96045C28.8266 6.96045 28.5881 7.02612 28.3795 7.1505L4.82521 20.7494C4.61318 20.868 4.43712 21.0416 4.31565 21.252C4.19418 21.4624 4.13181 21.7017 4.13514 21.9446ZM59.2365 47.7626C59.3339 47.8696 59.4093 47.9948 59.4584 48.131C59.5074 48.2672 59.5292 48.4117 59.5224 48.5563C59.5156 48.7009 59.4803 48.8427 59.4187 48.9737C59.3571 49.1047 59.2703 49.2223 59.1632 49.3197L52.9498 54.9584L52.9437 54.9646C52.7366 55.1716 52.4558 55.2879 52.1631 55.2879C51.8703 55.2879 51.5895 55.1716 51.3825 54.9646L48.8057 52.3879C48.6008 52.1804 48.4862 51.9002 48.4872 51.6085C48.4881 51.3169 48.6044 51.0374 48.8106 50.8312C49.0169 50.625 49.2964 50.5088 49.5881 50.5079C49.8797 50.5071 50.1599 50.6217 50.3674 50.8267L52.2017 52.6609L57.68 47.6893C57.8961 47.4927 58.1815 47.39 58.4734 47.4038C58.7653 47.4175 59.0397 47.5466 59.2365 47.7626ZM67.5427 51.0722L66.5505 53.0349C66.2836 53.5466 66.1811 54.1281 66.2569 54.7002L66.5179 56.8839C66.5988 57.5115 66.4712 58.1484 66.1548 58.6964C65.8384 59.2445 65.3506 59.6734 64.7666 59.9172L62.745 60.7831C62.2116 61.0034 61.7592 61.3829 61.4496 61.87L60.2459 63.7105C59.9045 64.2434 59.3974 64.6492 58.8027 64.8657C58.208 65.0821 57.5586 65.0972 56.9545 64.9085L54.8493 64.2723C54.2991 64.0982 53.7086 64.0982 53.1584 64.2723L51.0532 64.9085C50.4491 65.0972 49.7998 65.0822 49.2051 64.8657C48.6104 64.6492 48.1033 64.2434 47.7619 63.7105L46.5581 61.87C46.2486 61.3829 45.7962 61.0033 45.2627 60.7831L43.2411 59.9172C42.6571 59.6734 42.1693 59.2445 41.8529 58.6964C41.5365 58.1484 41.4089 57.5115 41.4898 56.8839L41.7508 54.7002C41.8266 54.1281 41.7241 53.5466 41.4572 53.0349L40.465 51.0722C40.1743 50.5101 40.0763 49.868 40.1862 49.2447C40.2961 48.6214 40.6078 48.0516 41.0733 47.6228L42.6769 46.1177C43.1027 45.7282 43.3979 45.2169 43.5224 44.6534L44.0239 42.5119C44.1625 41.8945 44.5003 41.3397 44.9851 40.9329C45.4699 40.5261 46.0749 40.2899 46.7071 40.2606L48.9029 40.1385C49.4793 40.1138 50.0341 39.9118 50.4916 39.5602L52.2524 38.2423C52.7554 37.8584 53.3707 37.6504 54.0036 37.6504C54.6364 37.6504 55.2517 37.8584 55.7548 38.2423L57.5156 39.5602C57.9731 39.9119 58.528 40.1138 59.1045 40.1385L61.3004 40.2606C61.9325 40.2899 62.5376 40.5261 63.0224 40.9329C63.5072 41.3397 63.8449 41.8945 63.9835 42.5119L64.4852 44.6534C64.6095 45.2169 64.9048 45.7283 65.3306 46.1177L66.9342 47.6228C67.3996 48.0516 67.7113 48.6214 67.8213 49.2447C67.9312 49.8679 67.8333 50.51 67.5427 51.0722ZM62.1833 51.3442C62.1833 49.7265 61.7035 48.1451 60.8048 46.8C59.906 45.455 58.6286 44.4066 57.134 43.7875C55.6395 43.1684 53.9949 43.0065 52.4083 43.322C50.8216 43.6376 49.3642 44.4166 48.2203 45.5605C47.0764 46.7044 46.2974 48.1618 45.9818 49.7484C45.6661 51.3351 45.8281 52.9796 46.4472 54.4742C47.0662 55.9688 48.1146 57.2463 49.4596 58.145C50.8047 59.0438 52.3861 59.5235 54.0038 59.5236C56.1731 59.5236 58.2536 58.6618 59.7875 57.1279C61.3214 55.594 62.1832 53.5135 62.1833 51.3442Z" fill="url(#paint0_linear_shield)" />
      <defs>
        <linearGradient id="paint0_linear_shield" x1="36.0001" y1="6.96045" x2="36.0001" y2="65.0398" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function TruckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 72 72" fill="none">
      <g clipPath="url(#clip0_truck)">
        <path d="M46.5001 10.5C32.439 10.5 21 21.9389 21 36C21 50.061 32.439 61.4999 46.5001 61.4999C60.5612 61.4999 72 50.061 72 36C72 21.9389 60.561 10.5 46.5001 10.5ZM57 38.9999H46.5001C45.7044 38.9999 44.9414 38.6838 44.3788 38.1212C43.8161 37.5587 43.5 36.7956 43.5 36V20.9999C43.5054 20.2078 43.8239 19.45 44.3859 18.8918C44.9479 18.3336 45.7079 18.0204 46.5 18.0204C47.2921 18.0204 48.0521 18.3336 48.6141 18.8918C49.1762 19.45 49.4946 20.2078 49.5 20.9999V33H57C57.7956 33 58.5587 33.3161 59.1213 33.8787C59.6839 34.4413 60 35.2043 60 36C60 36.7956 59.6839 37.5586 59.1213 38.1212C58.5587 38.6838 57.7956 38.9999 57 38.9999Z" fill="black" />
        <path d="M46.5001 10.5C32.439 10.5 21 21.9389 21 36C21 50.061 32.439 61.4999 46.5001 61.4999C60.5612 61.4999 72 50.061 72 36C72 21.9389 60.561 10.5 46.5001 10.5ZM57 38.9999H46.5001C45.7044 38.9999 44.9414 38.6838 44.3788 38.1212C43.8161 37.5587 43.5 36.7956 43.5 36V20.9999C43.5054 20.2078 43.8239 19.45 44.3859 18.8918C44.9479 18.3336 45.7079 18.0204 46.5 18.0204C47.2921 18.0204 48.0521 18.3336 48.6141 18.8918C49.1762 19.45 49.4946 20.2078 49.5 20.9999V33H57C57.7956 33 58.5587 33.3161 59.1213 33.8787C59.6839 34.4413 60 35.2043 60 36C60 36.7956 59.6839 37.5586 59.1213 38.1212C58.5587 38.6838 57.7956 38.9999 57 38.9999Z" fill="#D3FF33" />
        <path d="M46.5001 10.5C32.439 10.5 21 21.9389 21 36C21 50.061 32.439 61.4999 46.5001 61.4999C60.5612 61.4999 72 50.061 72 36C72 21.9389 60.561 10.5 46.5001 10.5ZM57 38.9999H46.5001C45.7044 38.9999 44.9414 38.6838 44.3788 38.1212C43.8161 37.5587 43.5 36.7956 43.5 36V20.9999C43.5054 20.2078 43.8239 19.45 44.3859 18.8918C44.9479 18.3336 45.7079 18.0204 46.5 18.0204C47.2921 18.0204 48.0521 18.3336 48.6141 18.8918C49.1762 19.45 49.4946 20.2078 49.5 20.9999V33H57C57.7956 33 58.5587 33.3161 59.1213 33.8787C59.6839 34.4413 60 35.2043 60 36C60 36.7956 59.6839 37.5586 59.1213 38.1212C58.5587 38.6838 57.7956 38.9999 57 38.9999Z" fill="url(#paint0_linear_truck)" />
        <path d="M16.4999 27.0001H6C5.60431 27.0028 5.21198 26.9272 4.84563 26.7777C4.47927 26.6281 4.14611 26.4076 3.86535 26.1287C3.58459 25.8499 3.36176 25.5182 3.20971 25.1529C3.05765 24.7876 2.97937 24.3958 2.97937 24.0001C2.97937 23.6044 3.05765 23.2126 3.20971 22.8473C3.36176 22.4819 3.58459 22.1503 3.86535 21.8715C4.14611 21.5926 4.47927 21.3721 4.84563 21.2225C5.21198 21.073 5.60431 20.9974 6 21.0001H16.4999C16.8956 20.9974 17.2879 21.073 17.6543 21.2225C18.0206 21.3721 18.3538 21.5926 18.6346 21.8715C18.9153 22.1503 19.1382 22.4819 19.2902 22.8473C19.4423 23.2126 19.5205 23.6044 19.5205 24.0001C19.5205 24.3958 19.4423 24.7876 19.2902 25.1529C19.1382 25.5182 18.9153 25.8499 18.6346 26.1287C18.3538 26.4076 18.0206 26.6281 17.6543 26.7777C17.2879 26.9272 16.8956 27.0028 16.4999 27.0001Z" fill="black" />
        <path d="M16.4999 27.0001H6C5.60431 27.0028 5.21198 26.9272 4.84563 26.7777C4.47927 26.6281 4.14611 26.4076 3.86535 26.1287C3.58459 25.8499 3.36176 25.5182 3.20971 25.1529C3.05765 24.7876 2.97937 24.3958 2.97937 24.0001C2.97937 23.6044 3.05765 23.2126 3.20971 22.8473C3.36176 22.4819 3.58459 22.1503 3.86535 21.8715C4.14611 21.5926 4.47927 21.3721 4.84563 21.2225C5.21198 21.073 5.60431 20.9974 6 21.0001H16.4999C16.8956 20.9974 17.2879 21.073 17.6543 21.2225C18.0206 21.3721 18.3538 21.5926 18.6346 21.8715C18.9153 22.1503 19.1382 22.4819 19.2902 22.8473C19.4423 23.2126 19.5205 23.6044 19.5205 24.0001C19.5205 24.3958 19.4423 24.7876 19.2902 25.1529C19.1382 25.5182 18.9153 25.8499 18.6346 26.1287C18.3538 26.4076 18.0206 26.6281 17.6543 26.7777C17.2879 26.9272 16.8956 27.0028 16.4999 27.0001Z" fill="#D3FF33" />
        <path d="M16.4999 27.0001H6C5.60431 27.0028 5.21198 26.9272 4.84563 26.7777C4.47927 26.6281 4.14611 26.4076 3.86535 26.1287C3.58459 25.8499 3.36176 25.5182 3.20971 25.1529C3.05765 24.7876 2.97937 24.3958 2.97937 24.0001C2.97937 23.6044 3.05765 23.2126 3.20971 22.8473C3.36176 22.4819 3.58459 22.1503 3.86535 21.8715C4.14611 21.5926 4.47927 21.3721 4.84563 21.2225C5.21198 21.073 5.60431 20.9974 6 21.0001H16.4999C16.8956 20.9974 17.2879 21.073 17.6543 21.2225C18.0206 21.3721 18.3538 21.5926 18.6346 21.8715C18.9153 22.1503 19.1382 22.4819 19.2902 22.8473C19.4423 23.2126 19.5205 23.6044 19.5205 24.0001C19.5205 24.3958 19.4423 24.7876 19.2902 25.1529C19.1382 25.5182 18.9153 25.8499 18.6346 26.1287C18.3538 26.4076 18.0206 26.6281 17.6543 26.7777C17.2879 26.9272 16.8956 27.0028 16.4999 27.0001Z" fill="url(#paint1_linear_truck)" />
        <path d="M15 38.9999H2.99995C2.20432 38.9999 1.44127 38.6838 0.878666 38.1212C0.316066 37.5586 0 36.7956 0 36C0 35.2043 0.316066 34.4413 0.878666 33.8787C1.44127 33.3161 2.20432 33 2.99995 33H15C15.7957 33 16.5587 33.3161 17.1213 33.8787C17.6839 34.4413 18 35.2043 18 36C18 36.7956 17.6839 37.5586 17.1213 38.1212C16.5587 38.6838 15.7957 38.9999 15 38.9999Z" fill="black" />
        <path d="M15 38.9999H2.99995C2.20432 38.9999 1.44127 38.6838 0.878666 38.1212C0.316066 37.5586 0 36.7956 0 36C0 35.2043 0.316066 34.4413 0.878666 33.8787C1.44127 33.3161 2.20432 33 2.99995 33H15C15.7957 33 16.5587 33.3161 17.1213 33.8787C17.6839 34.4413 18 35.2043 18 36C18 36.7956 17.6839 37.5586 17.1213 38.1212C16.5587 38.6838 15.7957 38.9999 15 38.9999Z" fill="#D3FF33" />
        <path d="M15 38.9999H2.99995C2.20432 38.9999 1.44127 38.6838 0.878666 38.1212C0.316066 37.5586 0 36.7956 0 36C0 35.2043 0.316066 34.4413 0.878666 33.8787C1.44127 33.3161 2.20432 33 2.99995 33H15C15.7957 33 16.5587 33.3161 17.1213 33.8787C17.6839 34.4413 18 35.2043 18 36C18 36.7956 17.6839 37.5586 17.1213 38.1212C16.5587 38.6838 15.7957 38.9999 15 38.9999Z" fill="url(#paint2_linear_truck)" />
        <path d="M16.4999 51.0001H10.5C10.1043 51.0028 9.71198 50.9272 9.34562 50.7777C8.97927 50.6281 8.64611 50.4076 8.36535 50.1287C8.08459 49.8499 7.86176 49.5182 7.70971 49.1529C7.55765 48.7876 7.47937 48.3958 7.47937 48.0001C7.47937 47.6044 7.55765 47.2126 7.70971 46.8473C7.86176 46.4819 8.08459 46.1503 8.36535 45.8715C8.64611 45.5926 8.97927 45.3721 9.34562 45.2225C9.71198 45.073 10.1043 44.9974 10.5 45.0001H16.4999C16.8956 44.9974 17.2879 45.073 17.6543 45.2225C18.0206 45.3721 18.3538 45.5926 18.6346 45.8715C18.9153 46.1503 19.1382 46.4819 19.2902 46.8473C19.4423 47.2126 19.5205 47.6044 19.5205 48.0001C19.5205 48.3958 19.4423 48.7876 19.2902 49.1529C19.1382 49.5182 18.9153 49.8499 18.6346 50.1287C18.3538 50.4076 18.0206 50.6281 17.6543 50.7777C17.2879 50.9272 16.8956 51.0028 16.4999 51.0001Z" fill="black" />
        <path d="M16.4999 51.0001H10.5C10.1043 51.0028 9.71198 50.9272 9.34562 50.7777C8.97927 50.6281 8.64611 50.4076 8.36535 50.1287C8.08459 49.8499 7.86176 49.5182 7.70971 49.1529C7.55765 48.7876 7.47937 48.3958 7.47937 48.0001C7.47937 47.6044 7.55765 47.2126 7.70971 46.8473C7.86176 46.4819 8.08459 46.1503 8.36535 45.8715C8.64611 45.5926 8.97927 45.3721 9.34562 45.2225C9.71198 45.073 10.1043 44.9974 10.5 45.0001H16.4999C16.8956 44.9974 17.2879 45.073 17.6543 45.2225C18.0206 45.3721 18.3538 45.5926 18.6346 45.8715C18.9153 46.1503 19.1382 46.4819 19.2902 46.8473C19.4423 47.2126 19.5205 47.6044 19.5205 48.0001C19.5205 48.3958 19.4423 48.7876 19.2902 49.1529C19.1382 49.5182 18.9153 49.8499 18.6346 50.1287C18.3538 50.4076 18.0206 50.6281 17.6543 50.7777C17.2879 50.9272 16.8956 51.0028 16.4999 51.0001Z" fill="#D3FF33" />
        <path d="M16.4999 51.0001H10.5C10.1043 51.0028 9.71198 50.9272 9.34562 50.7777C8.97927 50.6281 8.64611 50.4076 8.36535 50.1287C8.08459 49.8499 7.86176 49.5182 7.70971 49.1529C7.55765 48.7876 7.47937 48.3958 7.47937 48.0001C7.47937 47.6044 7.55765 47.2126 7.70971 46.8473C7.86176 46.4819 8.08459 46.1503 8.36535 45.8715C8.64611 45.5926 8.97927 45.3721 9.34562 45.2225C9.71198 45.073 10.1043 44.9974 10.5 45.0001H16.4999C16.8956 44.9974 17.2879 45.073 17.6543 45.2225C18.0206 45.3721 18.3538 45.5926 18.6346 45.8715C18.9153 46.1503 19.1382 46.4819 19.2902 46.8473C19.4423 47.2126 19.5205 47.6044 19.5205 48.0001C19.5205 48.3958 19.4423 48.7876 19.2902 49.1529C19.1382 49.5182 18.9153 49.8499 18.6346 50.1287C18.3538 50.4076 18.0206 50.6281 17.6543 50.7777C17.2879 50.9272 16.8956 51.0028 16.4999 51.0001Z" fill="url(#paint3_linear_truck)" />
      </g>
      <defs>
        <linearGradient id="paint0_linear_truck" x1="46.5" y1="10.5" x2="46.5" y2="61.4999" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="paint1_linear_truck" x1="11.25" y1="21" x2="11.25" y2="27.0002" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="paint2_linear_truck" x1="9" y1="33" x2="9" y2="38.9999" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="paint3_linear_truck" x1="13.5" y1="45" x2="13.5" y2="51.0002" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <clipPath id="clip0_truck">
          <rect width="72" height="72" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

function ReturnIcon({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 72 72" fill="none">
      <g clipPath="url(#clip0_return)">
        <path fillRule="evenodd" clipRule="evenodd" d="M30.8304 10.1234L35.7188 12.6079V0H24.0469V12.6079L28.9303 10.1261C29.5065 9.83386 30.2091 9.81024 30.8304 10.1234Z" fill="black" />
        <path fillRule="evenodd" clipRule="evenodd" d="M30.8304 10.1234L35.7188 12.6079V0H24.0469V12.6079L28.9303 10.1261C29.5065 9.83386 30.2091 9.81024 30.8304 10.1234Z" fill="#D3FF33" />
        <path fillRule="evenodd" clipRule="evenodd" d="M30.8304 10.1234L35.7188 12.6079V0H24.0469V12.6079L28.9303 10.1261C29.5065 9.83386 30.2091 9.81024 30.8304 10.1234Z" fill="url(#paint0_linear_return)" />
        <path fillRule="evenodd" clipRule="evenodd" d="M59.7656 25.4866V2.10938C59.7656 0.944275 58.8214 0 57.6562 0H39.9375V16.04C39.9375 17.5567 38.3192 18.724 36.7388 17.8462L29.8828 14.3624L22.8851 17.9187C21.4805 18.6301 19.832 17.5919 19.8331 16.04L19.8281 0H2.10938C0.944275 0 0 0.944275 0 2.10938V57.6562C0 58.8214 0.944275 59.7656 2.10938 59.7656H25.4866C22.8845 53.354 22.912 46.2222 25.5591 39.832C31.0946 26.4677 46.3612 20.0468 59.7656 25.4866Z" fill="black" />
        <path fillRule="evenodd" clipRule="evenodd" d="M59.7656 25.4866V2.10938C59.7656 0.944275 58.8214 0 57.6562 0H39.9375V16.04C39.9375 17.5567 38.3192 18.724 36.7388 17.8462L29.8828 14.3624L22.8851 17.9187C21.4805 18.6301 19.832 17.5919 19.8331 16.04L19.8281 0H2.10938C0.944275 0 0 0.944275 0 2.10938V57.6562C0 58.8214 0.944275 59.7656 2.10938 59.7656H25.4866C22.8845 53.354 22.912 46.2222 25.5591 39.832C31.0946 26.4677 46.3612 20.0468 59.7656 25.4866Z" fill="#D3FF33" />
        <path fillRule="evenodd" clipRule="evenodd" d="M59.7656 25.4866V2.10938C59.7656 0.944275 58.8214 0 57.6562 0H39.9375V16.04C39.9375 17.5567 38.3192 18.724 36.7388 17.8462L29.8828 14.3624L22.8851 17.9187C21.4805 18.6301 19.832 17.5919 19.8331 16.04L19.8281 0H2.10938C0.944275 0 0 0.944275 0 2.10938V57.6562C0 58.8214 0.944275 59.7656 2.10938 59.7656H25.4866C22.8845 53.354 22.912 46.2222 25.5591 39.832C31.0946 26.4677 46.3612 20.0468 59.7656 25.4866Z" fill="url(#paint1_linear_return)" />
        <path fillRule="evenodd" clipRule="evenodd" d="M65.523 34.2504C61.5212 30.2487 55.9929 27.7734 49.8867 27.7734C43.7805 27.7734 38.2522 30.2487 34.2504 34.2504C30.2487 38.2522 27.7734 43.7805 27.7734 49.8867C27.7734 55.9929 30.2487 61.5212 34.2504 65.523C38.2522 69.5248 43.7805 72 49.8867 72C55.9929 72 61.5212 69.5248 65.523 65.523C69.5248 61.5212 72 55.9929 72 49.8867C72 43.7805 69.5248 38.2522 65.523 34.2504ZM58.7791 56.8109C57.3025 58.2874 55.2629 59.2031 53.0151 59.2031H43.1719C42.0068 59.2031 41.0625 58.2589 41.0625 57.0938C41.0625 55.9286 42.0068 54.9844 43.1719 54.9844H53.0151C55.1816 54.9844 56.9531 53.2128 56.9531 51.0463C56.9531 49.8746 56.5873 48.9161 55.7963 48.1256C55.0827 47.4115 54.0983 46.9688 53.0151 46.9688H47.139L48.392 48.2195C49.216 49.0386 49.2198 50.3707 48.4008 51.1941C47.5818 52.0181 46.2497 52.0214 45.4263 51.2023L40.5791 46.3645C39.7551 45.5455 39.7518 44.2139 40.5709 43.39L45.4087 38.5433C46.2277 37.7199 47.5593 37.7161 48.3832 38.5351C49.2067 39.3541 49.2105 40.6857 48.3915 41.5096L47.1533 42.75H53.0151C57.5107 42.75 61.1719 46.4112 61.1719 50.9068C61.1719 53.248 60.3314 55.2585 58.7791 56.8109Z" fill="black" />
        <path fillRule="evenodd" clipRule="evenodd" d="M65.523 34.2504C61.5212 30.2487 55.9929 27.7734 49.8867 27.7734C43.7805 27.7734 38.2522 30.2487 34.2504 34.2504C30.2487 38.2522 27.7734 43.7805 27.7734 49.8867C27.7734 55.9929 30.2487 61.5212 34.2504 65.523C38.2522 69.5248 43.7805 72 49.8867 72C55.9929 72 61.5212 69.5248 65.523 65.523C69.5248 61.5212 72 55.9929 72 49.8867C72 43.7805 69.5248 38.2522 65.523 34.2504ZM58.7791 56.8109C57.3025 58.2874 55.2629 59.2031 53.0151 59.2031H43.1719C42.0068 59.2031 41.0625 58.2589 41.0625 57.0938C41.0625 55.9286 42.0068 54.9844 43.1719 54.9844H53.0151C55.1816 54.9844 56.9531 53.2128 56.9531 51.0463C56.9531 49.8746 56.5873 48.9161 55.7963 48.1256C55.0827 47.4115 54.0983 46.9688 53.0151 46.9688H47.139L48.392 48.2195C49.216 49.0386 49.2198 50.3707 48.4008 51.1941C47.5818 52.0181 46.2497 52.0214 45.4263 51.2023L40.5791 46.3645C39.7551 45.5455 39.7518 44.2139 40.5709 43.39L45.4087 38.5433C46.2277 37.7199 47.5593 37.7161 48.3832 38.5351C49.2067 39.3541 49.2105 40.6857 48.3915 41.5096L47.1533 42.75H53.0151C57.5107 42.75 61.1719 46.4112 61.1719 50.9068C61.1719 53.248 60.3314 55.2585 58.7791 56.8109Z" fill="#D3FF33" />
        <path fillRule="evenodd" clipRule="evenodd" d="M65.523 34.2504C61.5212 30.2487 55.9929 27.7734 49.8867 27.7734C43.7805 27.7734 38.2522 30.2487 34.2504 34.2504C30.2487 38.2522 27.7734 43.7805 27.7734 49.8867C27.7734 55.9929 30.2487 61.5212 34.2504 65.523C38.2522 69.5248 43.7805 72 49.8867 72C55.9929 72 61.5212 69.5248 65.523 65.523C69.5248 61.5212 72 55.9929 72 49.8867C72 43.7805 69.5248 38.2522 65.523 34.2504ZM58.7791 56.8109C57.3025 58.2874 55.2629 59.2031 53.0151 59.2031H43.1719C42.0068 59.2031 41.0625 58.2589 41.0625 57.0938C41.0625 55.9286 42.0068 54.9844 43.1719 54.9844H53.0151C55.1816 54.9844 56.9531 53.2128 56.9531 51.0463C56.9531 49.8746 56.5873 48.9161 55.7963 48.1256C55.0827 47.4115 54.0983 46.9688 53.0151 46.9688H47.139L48.392 48.2195C49.216 49.0386 49.2198 50.3707 48.4008 51.1941C47.5818 52.0181 46.2497 52.0214 45.4263 51.2023L40.5791 46.3645C39.7551 45.5455 39.7518 44.2139 40.5709 43.39L45.4087 38.5433C46.2277 37.7199 47.5593 37.7161 48.3832 38.5351C49.2067 39.3541 49.2105 40.6857 48.3915 41.5096L47.1533 42.75H53.0151C57.5107 42.75 61.1719 46.4112 61.1719 50.9068C61.1719 53.248 60.3314 55.2585 58.7791 56.8109Z" fill="url(#paint2_linear_return)" />
      </g>
      <defs>
        <linearGradient id="paint0_linear_return" x1="29.8828" y1="0" x2="29.8828" y2="12.6079" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="paint1_linear_return" x1="29.8828" y1="0" x2="29.8828" y2="59.7656" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="paint2_linear_return" x1="49.8867" y1="27.7734" x2="49.8867" y2="72" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <clipPath id="clip0_return">
          <rect width="72" height="72" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 72 72" fill="none">
      <path d="M58.5 18V20.8125C57.24 20.2275 56.07 19.485 54.9675 18.585C53.37 17.325 51.3675 16.6275 49.3425 16.6275C47.3175 16.6275 45.315 17.325 43.7175 18.6075C42.5025 19.575 41.1975 20.385 39.8025 21.015C38.205 21.735 36.5175 22.2525 34.7625 22.5H4.5V18C4.5 14.265 7.515 11.25 11.25 11.25H51.75C55.485 11.25 58.5 14.265 58.5 18Z" fill="black" />
      <path d="M58.5 18V20.8125C57.24 20.2275 56.07 19.485 54.9675 18.585C53.37 17.325 51.3675 16.6275 49.3425 16.6275C47.3175 16.6275 45.315 17.325 43.7175 18.6075C42.5025 19.575 41.1975 20.385 39.8025 21.015C38.205 21.735 36.5175 22.2525 34.7625 22.5H4.5V18C4.5 14.265 7.515 11.25 11.25 11.25H51.75C55.485 11.25 58.5 14.265 58.5 18Z" fill="#D3FF33" />
      <path d="M58.5 18V20.8125C57.24 20.2275 56.07 19.485 54.9675 18.585C53.37 17.325 51.3675 16.6275 49.3425 16.6275C47.3175 16.6275 45.315 17.325 43.7175 18.6075C42.5025 19.575 41.1975 20.385 39.8025 21.015C38.205 21.735 36.5175 22.2525 34.7625 22.5H4.5V18C4.5 14.265 7.515 11.25 11.25 11.25H51.75C55.485 11.25 58.5 14.265 58.5 18Z" fill="url(#paint0_linear_lock)" />
      <path d="M26.7525 30.9825C26.82 29.5425 27.2475 28.1925 27.9225 27H4.5V45C4.5 48.735 7.515 51.75 11.25 51.75H31.275C27.9225 45.9675 26.37 38.97 26.7525 30.9825ZM22.5 42.75H13.5C10.53 42.75 10.53 38.25 13.5 38.25H22.5C25.47 38.25 25.47 42.75 22.5 42.75Z" fill="black" />
      <path d="M26.7525 30.9825C26.82 29.5425 27.2475 28.1925 27.9225 27H4.5V45C4.5 48.735 7.515 51.75 11.25 51.75H31.275C27.9225 45.9675 26.37 38.97 26.7525 30.9825ZM22.5 42.75H13.5C10.53 42.75 10.53 38.25 13.5 38.25H22.5C25.47 38.25 25.47 42.75 22.5 42.75Z" fill="#D3FF33" />
      <path d="M26.7525 30.9825C26.82 29.5425 27.2475 28.1925 27.9225 27H4.5V45C4.5 48.735 7.515 51.75 11.25 51.75H31.275C27.9225 45.9675 26.37 38.97 26.7525 30.9825ZM22.5 42.75H13.5C10.53 42.75 10.53 38.25 13.5 38.25H22.5C25.47 38.25 25.47 42.75 22.5 42.75Z" fill="url(#paint1_linear_lock)" />
      <path d="M67.4325 31.2077C67.32 29.0477 65.7 27.2702 63.585 27.0002C59.49 26.4602 55.53 24.8177 52.155 22.1177C50.49 20.7902 48.195 20.7902 46.53 22.1177C43.3575 24.6602 39.465 26.4152 35.1 27.0002C32.985 27.2927 31.365 29.0702 31.2525 31.2077C30.51 46.3952 37.8 56.4302 47.655 60.4127C48.69 60.8402 49.905 60.8627 51.0075 60.4127C60.9075 56.4077 68.175 46.3502 67.41 31.2077H67.4325ZM57.69 37.7552L48.69 46.7552C47.8125 47.6327 46.395 47.6327 45.5175 46.7552L41.0175 42.2552C38.925 40.1627 42.0975 36.9677 44.19 39.0827L47.0925 41.9852L54.495 34.5827C56.5875 32.4902 59.7825 35.6627 57.6675 37.7552H57.69Z" fill="black" />
      <path d="M67.4325 31.2077C67.32 29.0477 65.7 27.2702 63.585 27.0002C59.49 26.4602 55.53 24.8177 52.155 22.1177C50.49 20.7902 48.195 20.7902 46.53 22.1177C43.3575 24.6602 39.465 26.4152 35.1 27.0002C32.985 27.2927 31.365 29.0702 31.2525 31.2077C30.51 46.3952 37.8 56.4302 47.655 60.4127C48.69 60.8402 49.905 60.8627 51.0075 60.4127C60.9075 56.4077 68.175 46.3502 67.41 31.2077H67.4325ZM57.69 37.7552L48.69 46.7552C47.8125 47.6327 46.395 47.6327 45.5175 46.7552L41.0175 42.2552C38.925 40.1627 42.0975 36.9677 44.19 39.0827L47.0925 41.9852L54.495 34.5827C56.5875 32.4902 59.7825 35.6627 57.6675 37.7552H57.69Z" fill="#D3FF33" />
      <path d="M67.4325 31.2077C67.32 29.0477 65.7 27.2702 63.585 27.0002C59.49 26.4602 55.53 24.8177 52.155 22.1177C50.49 20.7902 48.195 20.7902 46.53 22.1177C43.3575 24.6602 39.465 26.4152 35.1 27.0002C32.985 27.2927 31.365 29.0702 31.2525 31.2077C30.51 46.3952 37.8 56.4302 47.655 60.4127C48.69 60.8402 49.905 60.8627 51.0075 60.4127C60.9075 56.4077 68.175 46.3502 67.41 31.2077H67.4325ZM57.69 37.7552L48.69 46.7552C47.8125 47.6327 46.395 47.6327 45.5175 46.7552L41.0175 42.2552C38.925 40.1627 42.0975 36.9677 44.19 39.0827L47.0925 41.9852L54.495 34.5827C56.5875 32.4902 59.7825 35.6627 57.6675 37.7552H57.69Z" fill="url(#paint2_linear_lock)" />
      <defs>
        <linearGradient id="paint0_linear_lock" x1="31.5" y1="11.25" x2="31.5" y2="22.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="paint1_linear_lock" x1="17.8875" y1="27" x2="17.8875" y2="51.75" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="paint2_linear_lock" x1="49.3328" y1="21.1221" x2="49.3328" y2="60.7418" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}


/* ───────────────────────── BrandsGrid ─────────────────────────
   Section 09 — uniform 12-up brand logo grid. Each tile is a
   tiny rounded-card containing the logo with `mix-blend-multiply`
   so the logos visually fuse onto the off-white card. Skips when
   no brands exist. */
/* ───────────────────────── ExploreLinks ─────────────────────────
   Section 10 — chip cloud of SEO anchor links above the content
   block. Driven by the admin's Home SEO Block singleton. Returns
   null when the block is hidden or has no links so the section
   disappears entirely instead of leaving a heading orphan. */
/* ───────────────────────── SeoContent ─────────────────────────
   Section 11 — long-form SEO content block + chip cloud beneath.
   Body is admin-authored HTML (TipTap) rendered through prose
   utilities so paragraphs / lists / links inherit consistent
   spacing without us needing the @tailwindcss/typography plugin. */
/* ───────────────────────── TrustBadges ─────────────────────────
   Section 12 — fixed 5-up row of trust badges (Top Brands,
   Authentic Products, Super fast delivery, Easy Returns, Secure
   payment). Hardcoded since the icons + copy don't change. */
/* ───────────────────────── BrandsGrid ─────────────────────────
   Section 09 — uniform 12-up brand logo grid. Each tile is a
   tiny rounded-card containing the logo with `mix-blend-multiply`
   so the logos visually fuse onto the off-white card. Skips when
   no brands exist. */
function BrandsGrid({ brands }: { brands: Brand[] }) {
  if (!brands || brands.length === 0) return null;
  return (
    <section className="py-10">
      <div className="container">
        <h2 className="text-2xl font-semibold text-[#141414] mb-6">
          Brands we deal with
        </h2>
        <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-3">
          {brands.slice(0, 24).map((b) => (
            <Link
              key={b._id}
              href={`/brands/${b.slug || nameToSlug(b.name)}`}
              className="aspect-[103/40] rounded-lg border border-[#eee] grid place-items-center px-3 hover:shadow-sm transition"
              title={b.name}
            >
              {b.logo ? (
                <Image
                  src={imageUrl(b.logo)}
                  alt={b.name}
                  width={80}
                  height={40}
                  className="object-contain max-h-10 mix-blend-multiply"
                />
              ) : (
                <span className="text-xs text-[#141414]/60">{b.name}</span>
              )}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── ExploreLinks ─────────────────────────
   Section 10 — chip cloud of SEO anchor links above the content
   block. Driven by the admin's Home SEO Block singleton. Returns
   null when the block is hidden or has no links so the section
   disappears entirely instead of leaving a heading orphan. */
function ExploreLinks({
  heading,
  block,
}: {
  heading: string;
  block: HomeSeoBlock;
}) {
  if (!block || block.isActive === false) return null;
  const links = block.links || [];
  if (links.length === 0) return null;
  return (
    <section className="py-10">
      <div className="container">
        <h2 className="text-2xl font-semibold text-[#141414] mb-6">
          {heading}
        </h2>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {links.map((l) => (
            <Link
              key={`${l.label}|${l.href}`}
              href={l.href}
              className="text-sm text-[#141414] underline underline-offset-4 hover:text-black"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── SeoContent ─────────────────────────
   Section 11 — long-form SEO content block + chip cloud beneath.
   Body is admin-authored HTML (TipTap) rendered through prose
   utilities so paragraphs / lists / links inherit consistent
   spacing without us needing the @tailwindcss/typography plugin. */
function SeoContent({ block }: { block: HomeSeoBlock }) {
  if (!block || block.isActive === false) return null;
  // The BOTTOM chip cloud (rendered below the prose) is sourced from
  // `block.bottomLinks` — the admin's "Related Links" list. The top
  // "Explore more" cloud uses `block.links` and is rendered by the
  // ExploreLinks component a few sections above. Reading from
  // `block.links` here was a copy-paste bug that made both clouds
  // show the same set.
  const links = block.bottomLinks || [];
  return (
    <section className="py-10 bg-[#fafbf8]">
      <div className="container space-y-6">
        {block.heading && (
          <h2 className="text-2xl font-semibold text-[#141414] leading-snug max-w-5xl">
            {block.heading}
          </h2>
        )}
        {block.body && (
          <div
            className="text-base text-[#424242] leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.body) }}
          />
        )}
        {links.length > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-3 pt-2">
            {links.map((l) => (
              <Link
                key={`${l.label}|${l.href}`}
                href={l.href}
                className="text-sm text-[#141414] underline underline-offset-4 hover:text-black"
              >
                {l.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
/* ───────────────────────── TrustBadges ─────────────────────────
   Section 12 — fixed 5-up row of trust badges (Top Brands,
   Authentic Products, Super fast delivery, Easy Returns, Secure
   payment). Hardcoded since the icons + copy don't change. */
function TrustBadges() {
  return (
    // Full-width black band per Figma. Lime-green icons + white
    // Full-width black band per Figma. Lime-green icons + white
    // labels for high-contrast trust signals at the foot of the page.
    <section className="bg-[#0d0d0d] py-12 md:py-16">
      <div className="container">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-y-8 gap-x-6">
          {TRUST_BADGES.map((b) => {
            const Icon = b.Icon;
            return (
              <div
                key={b.label}
                className="flex flex-col items-center gap-4 text-center"
              >
                <Icon className="w-10 h-10 text-[#C8FF3D]" />
                <div className="text-sm md:text-base font-medium text-white">
                  {b.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
