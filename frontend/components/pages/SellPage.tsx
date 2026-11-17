'use client';

/**
 * Sell landing page - built from the Figma design (node 2198:245).
 *
 * Header and footer come from `app/seller/layout.tsx` — the seller
 * property's own chrome (SELLER HUB logo, seller nav, seller footer),
 * shared by every page on seller.throttlein.com.
 * with the seller register page.
 *
 * Sections:
 *   1. Hero        - lime left / portrait right. Headline, sub, CTA, stats.
 *   2. Features    - "Everything you need to run your shop" - 2-col layout
 *                    with seller-at-laptop photo + 4 feature rows.
 *   3. 4-Steps     - "From signup to first sale in 4 steps" - 4 numbered
 *                    cards on a #f3f4f2 background.
 *   4. FAQ         - "Have any questions?" - first accordion expanded by
 *                    default; rest collapsed.
 *   5. CTA banner  - "Ready to open your shop?" - full-bleed motorbike
 *                    photo with black L→R gradient + lime CTA.
 */

import { sanitizeHtml } from '@/lib/sanitizeHtml';
import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/* ─── hero visual scaler ───
   The hero's right-side composition is authored on a fixed 586×480
   canvas (Figma's absolute pixel positions for the orbit, rider and
   floating cards). To render on ANY width it scales as one unit: the
   wrapper holds the 586:480 aspect at up to 586px wide, a
   ResizeObserver measures it, and the canvas transforms by
   width/586 — 1:1 on desktop, proportional on phones.

   Measured with JS rather than CSS because the pure-CSS attempt was a
   silent no-op: `scale(calc(100cqw / 586))` is invalid — scale() takes
   a <number> and dividing a length by a number yields a length — so
   the browser dropped the whole transform and the canvas rendered
   unscaled. aria-hidden: purely decorative. */
function HeroVisualScaler({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / 586);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div aria-hidden ref={ref} className="relative mx-auto aspect-[586/480] w-full max-w-[586px] shrink-0">
      <div
        className="absolute left-0 top-0 h-[480px] w-[586px] origin-top-left"
        style={{ transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
import JsonLd from '@/components/seo/JsonLd';
import SellerGuideSection from '@/components/sell/SellerGuideSection';

/* ─── hero floating category card ───
   Figma 4868:11904/11913/11925/11934 — 111px square, 12px radius,
   #DEFF66 border, black fill, product PNG inside. Each card bobs on a
   2.5s sine loop between its `initial` resting offset and its `dip`;
   the offsets differ per card so the four never move in unison, which
   is what Figma's staggered keyframe tracks encode. Honors
   prefers-reduced-motion by simply not animating. */
function HeroFloatCard({
  src,
  className = '',
  float,
}: {
  src: string;
  className?: string;
  float: { initial: number; dip: number };
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={`absolute w-[111px] ${className}`}
      initial={{ y: float.initial }}
      animate={reduceMotion ? undefined : { y: [float.initial, float.dip, float.initial] }}
      transition={{ y: { duration: 2.5, ease: [0.37, 0, 0.63, 1], repeat: Infinity } }}
    >
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-[#DEFF66] bg-black p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" src={src} className="h-full w-full object-contain" />
      </div>
    </motion.div>
  );
}

/* ─── content ─── */
const FEATURES = [
  {
    title: 'Reach motivated buyers',
    body:
      'Our audience is here for one reason - gear up. Higher conversion than generic marketplaces.',
    Icon: TargetIcon,
  },
  {
    title: 'Listings in minutes',
    body:
      'Hierarchical categories, brand tagging, bike-specific compatibility, multiple sizes - all in one form.',
    Icon: GridIcon,
  },
  {
    title: 'Smart order routing',
    body:
      'Orders come straight to your dashboard with email alerts. Mark confirmed → shipped → delivered in one click.',
    Icon: RouteIcon,
  },
  {
    title: 'You own the brand',
    body:
      'Your shop name, your logo, your customer relationships. We give you the tools - you keep the love.',
    Icon: StoreIcon,
  },
];

const STEPS = [
  {
    n: 1,
    title: 'Sign up',
    body: 'Create your seller account with your shop name, email, and phone.',
  },
  {
    n: 2,
    title: 'Add products',
    body: 'List helmets, jackets, lights, accessories. Multiple images, sizes, variants.',
  },
  {
    n: 3,
    title: 'Receive orders',
    body: 'Customers buy; you get emailed instantly. Track everything in your dashboard.',
  },
  {
    n: 4,
    title: 'Ship & earn',
    body: 'Confirm, pack, ship. Payments hit your account on the regular cycle.',
  },
];

/**
 * Fallback ONLY. The live FAQ list is admin-managed
 * (FaqSection{site:'seller'}, edited from Admin → Pages → Seller home
 * tab) and streamed in via the `initialFaqs` prop by app/seller/page.tsx.
 * This hardcoded copy — the same four Q&As that seeded the CMS — renders
 * only when the API returns nothing, so the section can't go blank if
 * the backend hiccups or an admin deactivates every section.
 */
const FALLBACK_FAQ = [
  {
    q: 'What services does Throttlein offer for bike part sales?',
    a:
      'Throttlein is a curated multi-seller marketplace for motorcycle accessories - helmets, jackets, boots, lights, exhausts, luggage, electronics and more. As a seller you get your own storefront, listings dashboard, integrated checkout, automated courier label printing and a customer-support workflow built in.',
  },
  {
    q: 'What can I sell on THROTTLEIN?',
    a:
      'Any genuine motorcycle accessory you have rights to sell: gear (helmets, jackets, gloves, boots, pants), luggage, lighting, electronics, exhausts, performance parts, safety/protection, and bike-specific OEM/aftermarket parts. Counterfeits and unsafe gear are not allowed.',
  },
  {
    q: 'Is there a setup fee or monthly subscription?',
    a:
      'No setup fee, no monthly subscription. We earn a small commission only when you make a sale, so we only grow when you do.',
  },
  {
    q: 'How long does approval take?',
    a:
      'Most sellers are approved within 24 hours of submitting their KYC. You can start listing immediately; orders begin flowing once your KYC is verified and your first product is live.',
  },
];

/** Admin answers are TipTap HTML; JSON-LD wants plain text. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function SellPage({
  initialFaqs = [],
}: {
  /** Admin-managed Q&As (FaqSection site='seller'), server-fetched. */
  initialFaqs?: { q: string; a: string }[];
}) {
  const faqs = initialFaqs.length > 0 ? initialFaqs : FALLBACK_FAQ;

  // FAQPage JSON-LD - Google can render an expandable FAQ block in
  // the SERP for seller-acquisition queries ("how to sell on
  // throttlein"), which lifts CTR. Built from the same list the page
  // renders visually so the two stay in sync automatically. Inside the
  // component (not module scope) because the list now arrives by prop.
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: stripHtml(a) },
    })),
  };
  return (
    <div className="bg-white">
      <JsonLd data={faqJsonLd} />
      {/* Header and footer come from app/seller/layout.tsx — the
          seller property's own chrome, shared by every page on it. */}

      {/* ════════════ HERO ════════════
          Figma node 4868:11890 — two-column: left-aligned copy + lime
          CTA, right a 586×480 visual (orbit ring, masked rider photo,
          four floating category cards with #DEFF66 borders animating on
          a 2.5s loop — keyframes taken from Figma's motion data, played
          through framer-motion which is already a dependency). Assets
          exported from the file into /images/seller-hero (remote MCP
          URLs expire in 7 days, so committed bytes, not hotlinks). The
          visual is decorative and pixel-positioned for the desktop
          artboard, so it renders from lg: up and is aria-hidden; below
          lg the hero is the copy column alone, centred, as before. */}
      <section className="bg-black overflow-hidden">
        <div className="container">
          <div className="mx-auto flex max-w-[1232px] flex-col items-center gap-10 py-12 text-center lg:h-[691px] lg:flex-row lg:gap-[60px] lg:py-0 lg:text-left">
            {/* Copy */}
            <div className="flex max-w-[800px] flex-1 flex-col items-center gap-6 lg:items-start lg:gap-8">
              <div className="flex flex-col gap-3">
                {/* 48px / -2px on large screens per product decision —
                    the Figma's 64px/-3px overpowered the two-column
                    layout at real viewport widths. */}
                <h1 className="text-[36px] font-medium leading-[1.24] tracking-[-1.5px] text-white sm:text-[40px] sm:tracking-[-2px] lg:text-[48px]">
                  Sell motorcycle gear & Accessories to India's most passionate riders.
                </h1>
                <p className="text-base leading-[1.52] text-white">
                  Open your shop in minutes. List helmets, jackets, lights, locks, and anything your customers ride with. Zero setup fees, full ownership of your store.
                </p>
              </div>
              <Link
                href="/seller/register"
                className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-[#D3FF33] px-6 py-2 text-base leading-none text-black transition hover:bg-[#DEFF66] active:bg-[#AAD900]"
              >
                Become a Seller
              </Link>
            </div>

            {/* Visual — decorative. The composition is authored on a
                fixed 586×480 canvas (Figma's pixel positions), so
                rather than hide it on mobile it scales as one unit —
                see HeroVisualScaler. */}
            <HeroVisualScaler>
              {/* Orbit ring (the SVG carries its own glow bleed, hence
                  the oversized box, mirroring Figma's -29%/-22% insets) */}
              <img
                alt=""
                src="/images/seller-hero/orbit.svg"
                className="absolute left-1/2 top-1/2 w-[817px] max-w-none -translate-x-1/2 -translate-y-1/2"
              />
              {/* Rider — mask baked into the export */}
              <img
                alt=""
                src="/images/seller-hero/rider.webp"
                className="absolute bottom-0 left-1/2 h-[407px] w-[350px] -translate-x-1/2 object-contain object-bottom"
              />
              <HeroFloatCard src="/images/seller-hero/card-1.webp" className="left-[385px] top-[48px]" float={{ initial: 0, dip: -8 }} />
              <HeroFloatCard src="/images/seller-hero/card-2.webp" className="left-[92px] top-[110px]" float={{ initial: -4, dip: -11 }} />
              <HeroFloatCard src="/images/seller-hero/card-3.webp" className="left-[87px] top-[369px]" float={{ initial: 3, dip: -3 }} />
              <HeroFloatCard
                src="/images/seller-hero/card-4.webp"
                className="left-[428px] top-[275px] drop-shadow-[-7px_5px_2px_rgba(0,0,0,0.35)]"
                float={{ initial: -5, dip: -13 }}
              />
            </HeroVisualScaler>
          </div>
        </div>
      </section>
      {/* ════════════ WHY ThROTTLIN ════════════ */}
      <section className="bg-[#FAFBF8] py-16 md:py-24">
        <div className="container">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 max-w-[1232px] mx-auto">
            <div>
              <h2 className="text-[32px] md:text-[48px] tracking-[-1px] font-semibold text-[#141414] leading-[1.52]">
                Why Throttlein
              </h2>
              <div className="space-y-4 mt-10">
                <p className='text-[#424242] leading-[1.52]'>
                  Throttlein is a marketplace built only for motorcycle riders, which means every visitor arrives already looking for gear - not browsing a category buried inside a general shopping site. If you manufacture, import, or retail helmets, riding jackets, boots, exhausts, or Bluetooth intercoms, this is where riders come to buy them.
                </p>
                <p className='text-[#424242] leading-[1.52]'>
                  Setting up a seller account takes minutes: register your shop with a GST number and bank details, get verified within 24-48 hours, and start listing. There's no setup fee, no monthly subscription, and new sellers pay zero commission - Throttlein only earns when you do.
                </p>
                <p className='text-[#424242] leading-[1.52]'>
                  Once you're live, every order routes straight to your seller dashboard with instant email alerts, pre-generated courier labels, and one-click status updates from confirmed to delivered. You keep your shop name, your branding, and your customer relationships - Throttlein just gives you the storefront, traffic, and logistics tooling underneath.
                </p>
              </div>
            </div>
            <div className="relative w-full aspect-[149/116] rounded-2xl overflow-hidden my-auto">
              <Image
                src="/images/figma-sell/why-throttlin.webp"
                alt="Why Throttlein"
                fill
                sizes="(max-width: 1024px) 100vw, 560px"
                className="object-contain"
              />
            </div>
          </div>
        </div>
      </section>
      {/* ════════════ FEATURES ════════════ */}
      <section className="bg-white py-16 md:py-20">

        <div className="container">
          {/* <div className="relative w-full aspect-[4/5] rounded-2xl overflow-hidden bg-default-100">
            <Image
              src="/images/figma-sell/features-portrait.webp"
              alt="Seller working on their store"
              fill
              sizes="(max-width: 768px) 100vw, 500px"
              className="object-cover"
            />
          </div>

          <div className="flex flex-col gap-6"> */}
          <div className="space-y-10 max-w-[1232px] mx-auto">
            <h2 className="text-[32px] md:text-[48px] tracking-[-1px] text-center font-semibold text-[#141414] leading-[1.52]">
              Everything you need to run your shop
            </h2>
            <div className='space-y-10'>
              {FEATURES.map(({ title, body, Icon }, i) => {
                // Odd children (1st, 3rd, 5th… - nth-child(odd)) swap
                // column order on md+ so the row reads icon-then-text
                // instead of text-then-icon, alternating the layout.
                const reversed = i % 2 === 0;
                return (
                  <div key={title} className="grid md:grid-cols-2 items-start gap-6 p-4 bg-[#F3F4F2] rounded-3xl">
                    <div className={`flex-1 min-w-0 md:p-6 lg:p-10 my-auto ${reversed ? 'md:order-1' : 'md:order-2'}`}>
                      <h3 className="font-semibold text-xl md:text-2xl text-[#141414] leading-[1.52]">
                        {title}
                      </h3>
                      <h3 className="text-base text-[#424242] mt-2 leading-[1.52]">
                        {body}
                      </h3>
                    </div>
                    <div className={`relative w-full aspect-[50/31] my-auto rounded-2xl overflow-hidden ${reversed ? 'md:order-2' : 'md:order-1'}`}>
                      <Image
                        src={`/images/figma-sell/sell-${i + 1}.webp`}
                        alt={title}
                        fill
                        sizes="(max-width: 768px) 100vw, 260px"
                        className="object-contain"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {/* </div> */}
      </section>

      {/* ════════════ 4 STEPS ════════════ */}
      <section className="bg-[#FAFBF8] py-16 md:py-24">
        <div className="container">
          <div className="flex flex-col gap-10 max-w-[1232px] mx-auto">
            <h2 className="text-center text-[40px] md:text-[48px] tracking-[-1px] font-semibold text-[#141414] leading-[1.52]">
              From signup to first sale in 4 steps
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {STEPS.map((s) => (
                <div key={s.n} className="flex flex-col gap-4 rounded-2xl justify-between bg-[#E2E3DD] p-6 pb-0">
                  <div className="flex flex-col gap-1">
                    <p className="text-xl md:text-2xl font-semibold text-[#000] leading-[1.52]">
                      0{s.n}
                    </p>
                    <h3 className="font-semibold ttext-xl md:text-2xl text-[#000] leading-[1.52]">
                      {s.title}
                    </h3>
                    <p className="text-sm md:text-base text-[#000] leading-[1.52]">
                      {s.body}
                    </p>
                  </div>
                  <div className="relative w-full max-w-[469px] aspect-[469/348] mx-auto overflow-hidden !mt-9">
                    <Image
                      src={`/images/figma-sell/step-${s.n}.webp`}
                      alt={s.title}
                      fill
                      sizes="407px"
                      className="object-contain"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </section>
      {/* ════════════ COMPARISON TABLE ════════════ */}
      <section className="bg-white py-16 md:py-24">
        <div className="container">
          <div className="flex flex-col gap-10 max-w-[1232px] mx-auto">
            <div className="flex flex-col gap-3 text-center">
              <h2 className="text-[32px] md:text-[48px] tracking-[-1px] font-semibold text-[#141414] leading-[1.52]">
                Throttlein vs a general marketplace
              </h2>
              <p className="text-[#424242] text-base md:text-lg leading-[1.52]">
                A quick honest comparison so you can decide where a bike-gear listing actually works harder.
              </p>
            </div>
            <div className=" border border-[#BDBDBD] overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse table-fixed">
                <thead>
                  <tr>
                    <th className="w-1/3 bg-white p-4 md:p-5" />
                    <th className="w-1/3 bg-[#F4FFCC] p-4 md:p-5">
                      <div className="relative w-[140px] h-[34px] mx-auto">
                        <Image
                          src="/images/throttlein-logo.webp"
                          alt="Throttlein"
                          fill
                          sizes="140px"
                          className="object-contain"
                        />
                      </div>
                    </th>
                    <th className="w-1/3 bg-[#F5F5F5] p-4 md:p-5 text-left text-lg md:text-xl font-semibold text-[#000] leading-[1.52]">
                      General marketplace
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'Setup fee', throttlein: '₹0', general: 'Varies by platform' },
                    { label: 'Audience intent', throttlein: '100% bike riders', general: 'General shoppers' },
                    { label: 'Bike-specific fitment data', throttlein: 'Built in', general: 'Not supported' },
                    { label: 'Commission', throttlein: '0%', general: 'Standard from day one' },
                    { label: 'Approval time', throttlein: '24–48 hours', general: 'Days to weeks' },
                  ].map((row, i) => (
                    <tr key={row.label} className={i % 2 === 0 ? 'bg-white' : 'bg-white'}>
                      <td className="p-4 md:p-5 border-t border-[#BDBDBD] text-base md:text-lg text-[#000] leading-[1.52]">
                        {row.label}
                      </td>
                      <td className="p-4 md:p-5 border-t border-[#BDBDBD] bg-[#F4FFCC] text-center text-base md:text-lg font-medium text-[#000] leading-[1.52]">
                        {row.throttlein}
                      </td>
                      <td className="p-4 md:p-5 border-t border-[#BDBDBD] text-base md:text-lg text-[#424242] leading-[1.52]">
                        {row.general}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
      {/* ════════════ CTA BANNER ════════════ */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/images/figma-sell/cta-bg.webp"
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(270deg, rgb(0,0,0) 34.55%, rgba(0,0,0,0.7) 65.56%, rgba(0,0,0,0.56) 84.91%, rgba(0,0,0,0.22) 97.04%, transparent 100%)',
            }}
          />
        </div>

        <div className="relative max-w-[1222px] mx-auto px-4 sm:px-6 lg:px-10 py-20 md:py-24 flex justify-center">
          <div className="text-center text-white flex flex-col items-center gap-10">
            <div className="flex flex-col gap-3">
              <h2 className="text-3xl md:text-5xl tracking-[-1.5px] md:tracking-[-1.8px] font-medium leading-[1.38]">
                Ready to open your shop?
              </h2>
              <p className="text-base md:text-lg text-white/90 leading-[1.52]">
                Riders are buying every day. The faster you list, the faster they find you.
              </p>
            </div>
            <Link
              href="/seller/register"
              className="inline-flex items-center justify-center h-10 gap-2 px-4 py-1 leading-[1.3] bg-[#D3FF33] active:bg-[#AAD900] rounded-lg text-sm font-medium text-[#141414] hover:bg-[#DEFF66] transition shadow-sm"
            >
              Become a Seller
            </Link>
          </div>
        </div>
      </section>

      {/* ════════════ FAQ ════════════
          Top padding only — the section below carries its own top
          spacing, so a pb here doubled the gap. */}
      <section className="bg-white pt-16 md:pt-20">
        <div className="max-w-[760px] mx-auto px-4 sm:px-6 lg:px-10 flex flex-col gap-10">
          <div className="flex flex-col items-center gap-4">
            <span className="inline-flex h-8 items-center bg-[#d4fa00] px-2 rounded text-sm font-semibold text-black tracking-wider">
              FAQ
            </span>
            <h2 className="text-[28px] md:text-[32px] tracking-[-1px] font-semibold text-[#141414] text-center leading-[1.52]">
              Have any questions?
            </h2>
          </div>
          <FaqList items={faqs} />
        </div>
      </section>



      {/* ════════════ SELLER GUIDE ════════════ */}
      {/* Admin-managed cards rendered after the CTA banner. Hides
          itself when the admin has the section toggled off or has
          no active cards. */}
      <SellerGuideSection />

      {/* No footer here — app/seller/layout.tsx renders SellerFooter
          for every page on the seller property. */}
    </div>
  );
}

/* ───────────────────────── Sub-components ───────────────────────── */

function Stat({ value, label }: { value: string; label: string }) {
  // Inherits text color from parent (white on the new black hero panel).
  return (
    <div className="flex flex-col gap-1">
      <div className="text-2xl md:text-[32px] tracking-[-1px] font-medium leading-[1.52]">
        {value}
      </div>
      <div className="text-sm md:text-base opacity-80 leading-[1.52] whitespace-nowrap">
        {label}
      </div>
    </div>
  );
}

function FaqList({ items }: { items: { q: string; a: string }[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  return (
    <div className="flex flex-col gap-4">
      {items.map((it, i) => {
        const open = openIdx === i;
        return (
          <div
            key={i}
            className={`rounded-2xl border border-[#e0e0e0] transition ${open ? 'bg-[#EEE]' : 'bg-white hover:bg-[#F5F5F5]'
              }`}
          >
            <button
              onClick={() => setOpenIdx(open ? null : i)}
              className="w-full flex items-center justify-between gap-4 p-4 sm:px-6 sm:py-4 text-left"
              aria-expanded={open}
            >
              <span className="text-base leading-[1.52] text-black font-semibold">
                {it.q}
              </span>
              <span className="shrink-0 w-6 h-6 text-[#141414]">
                {open ? <CrossIcon /> : <PlusIcon />}
              </span>
            </button>
            {open && (
              /* Answers are admin-authored HTML (same TipTap editor the
                 main /faqs page uses) — rendered as HTML like FaqsPage
                 does, sanitised at edit time. Seeded plain-text answers
                 pass through unchanged. */
              <div
                className="p-4 pt-0 sm:px-6 sm:pb-4 -mt-1 text-sm text-[#575757] leading-[1.52] [&_a]:underline [&_a]:underline-offset-2 [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(it.a) }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Icons ───────────────────────── */
function PlusIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function CrossIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}
function TargetIcon({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}
function GridIcon({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function RouteIcon({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="6" cy="19" r="3" />
      <circle cx="18" cy="5" r="3" />
      <path d="M9 19h6a4 4 0 0 0 4-4V10a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v3" />
    </svg>
  );
}
function StoreIcon({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M4 9v11h16V9" />
      <path d="M9 22V13h6v9" />
    </svg>
  );
}
