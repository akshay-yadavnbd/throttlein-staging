'use client';

/**
 * "Sell Online" — the seller property's long-form onboarding guide.
 * Figma node 4624:1306 (1512 × 17648).
 *
 * Public URL: seller.throttlein.com/sell-online
 *
 * Structure, top to bottom:
 *   1. Hero — split, #FAFBF8
 *   2. Benefit cards — 5, 3-up
 *   3. Testimonial — black band, carousel shell
 *   4. Guide — sticky 282px anchor rail + 12 content cards
 *   5. Closing CTA — photo + gradient
 *   6. FAQ — 4-item accordion
 *
 * Header and footer come from `app/seller/layout.tsx`.
 * Copy and data live in `lib/sellOnlineContent.ts` — see the notes there
 * on the design's copy bugs and placeholder text.
 *
 * The anchor rail is the one thing Figma can't express: it renders as a
 * 560px block at the top of a 13,284px parent, which in code has to be
 * `position: sticky`. It also tracks the active section with an
 * IntersectionObserver, which the design implies via the active state on
 * tab 1 but doesn't specify.
 */

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import FaqAccordion from '@/components/common/FaqAccordion';
import TestimonialQuote from '@/components/common/TestimonialQuote';
import { sellerUrl, sellerContentUrl } from '@/lib/sellerUrl';
import type { SellerCategoryLink } from '@/lib/sellerCategoryLinks';
import {
  FALLBACK_ITEMS as FALLBACK_TESTIMONIALS,
  testimonialAvatarSrc,
  testimonialInitials,
  type TestimonialItem,
} from '@/lib/testimonials';
import {
  HERO,
  BENEFITS,
  BENEFITS_HEADING,
  TESTIMONIALS_HEADING,
  TESTIMONIALS_INTRO,
  GUIDE_SECTIONS,
  GSTIN_CARD,
  CATEGORY_SHORTLIST,
  CATEGORY_SHORTLIST_HEADING,
  SUPPORT_IMAGE,
  RESPONSIBILITIES,
  RESPONSIBILITIES_COLUMNS,
  CLOSING_CTA,
  FAQ,
  type GuideSection,
  type Step,
} from '@/lib/sellOnlineContent';

/* Shared class strings — the design reuses these exact treatments in
   several places, so they're named rather than repeated.
   Exported because the seller-category template (SellerCategoryPage) is built
   from the same Figma system and must not fork its own copies of these — two
   sets of button classes drift the moment one is touched. */
/* Figma shadow/button-primary = THREE insets (white/32 top bevel, ink/600
 * 1px ring, black/100 bottom edge) — variable defs on node 5044-15730. */
const CTA_PRIMARY_BASE =
  'inline-flex items-center justify-center rounded-lg bg-black text-white font-poppins whitespace-nowrap transition hover:bg-[#212121] shadow-[inset_0px_0.5px_0.5px_1px_rgba(255,255,255,0.32),inset_0px_0px_0px_1px_#757575,inset_0px_-1px_0px_1px_rgba(0,0,0,1)]';
export const CTA_PRIMARY = `${CTA_PRIMARY_BASE} min-h-10 px-4 py-1 text-sm leading-[1.3]`;
/** Action L size — hero banners (Figma node 5044-15730: 48px min-height,
 *  24px x-padding, 16px label, leading-none). */
export const CTA_PRIMARY_LG = `${CTA_PRIMARY_BASE} min-h-12 px-6 py-2 text-base leading-none`;
export const CTA_SECONDARY =
  'inline-flex items-center justify-center min-h-10 px-4 py-1 rounded-lg border border-[#bdbdbd] bg-white text-[#212121] font-poppins text-sm leading-[1.3] whitespace-nowrap transition hover:bg-[#f5f5f5] active:bg-[#eee]';
export const CTA_LIME =
  'inline-flex items-center justify-center min-h-10 px-4 py-1 rounded-lg bg-[#D3FF33] text-black font-poppins text-sm leading-[1.3] whitespace-nowrap transition hover:bg-[#DEFF66] active:bg-[#AAD900]';
export const BODY = 'font-poppins text-base leading-[1.52] text-[#424242]';
export const CARD =
  'bg-white border border-[#E0E0E0] rounded-2xl p-6 sm:p-8 lg:p-10 flex flex-col gap-6';

/** Re-exported so callers keep importing the link shape from here, while
 *  the single definition lives with the fetcher that produces it. */
export type CategoryPageLink = SellerCategoryLink;

export default function SellOnlinePage({
  /** Published seller-category pages, from the server route. Empty in any
   *  context that doesn't supply them, which falls back to the static labels. */
  categoryPages = [],
  /** Published testimonials for the seller property, from the server
   *  route. Omitted falls back to the built-in card. */
  testimonials = [],
}: {
  categoryPages?: CategoryPageLink[];
  testimonials?: TestimonialItem[];
}) {
  return (
    <div className="bg-white">
      <Hero />
      <Benefits />
      <Testimonials items={testimonials} />
      <Guide categoryPages={categoryPages} />
      <ClosingCta />
      <Faq />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * 1. Hero
 * ──────────────────────────────────────────────────────────────── */
function Hero() {
  return (
    <section className="bg-[#FAFBF8]">
      <div className="max-w-[1232px] mx-auto px-6 sm:px-10 lg:px-20 py-16 lg:py-20">
        <div className="flex flex-col lg:flex-row lg:items-center gap-10 lg:gap-[60px]">
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            <h1 className="font-poppins font-medium text-[40px] sm:text-[52px] lg:text-[64px] leading-[1.24] tracking-[-1.5px] lg:tracking-[-3px] text-black">
              {HERO.heading}
            </h1>
            <p className="font-poppins font-semibold text-base leading-[1.52] text-[#141414]">
              {HERO.subheading}
            </p>
            <p className={BODY}>{HERO.body}</p>

            <ProofPoints points={HERO.proofPoints} tone="dark" />

            <div className="flex flex-wrap gap-3 pt-1">
              <Link href={sellerUrl('/register')} className={CTA_PRIMARY}>
                Start Selling
              </Link>
              <Link href={sellerUrl('/login')} className={CTA_SECONDARY}>
                Seller Login
              </Link>
            </div>
          </div>

          {/* 608×431 in the design — held as an aspect ratio so it scales. */}
          <div className="flex-1 min-w-0 relative w-full aspect-[608/431] rounded-2xl overflow-hidden">
            <Image
              src={HERO.image.src}
              alt={HERO.image.alt}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 608px"
              className="object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Hairline-separated inline proof points. `tone` flips the divider and
 * text for the dark CTA banner.
 */
function ProofPoints({
  points,
  tone,
}: {
  points: readonly string[];
  tone: 'dark' | 'light';
}) {
  const text = tone === 'dark' ? 'text-[#424242]' : 'text-white';
  const rule = tone === 'dark' ? 'bg-[#D4D4D4]' : 'bg-white/40';
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {points.map((p, i) => (
        <li key={p} className="flex items-center gap-4">
          {i > 0 && <span aria-hidden className={`hidden sm:block w-px h-3 ${rule}`} />}
          <span className={`font-poppins text-sm leading-[1.65] ${text}`}>{p}</span>
        </li>
      ))}
    </ul>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * 2. Benefit cards
 * ──────────────────────────────────────────────────────────────── */
function Benefits() {
  return (
    <section className="bg-white">
      <div className="max-w-[1232px] mx-auto px-6 sm:px-10 py-16 lg:py-24 flex flex-col gap-10">
        <h2 className="font-poppins font-medium text-[28px] lg:text-[40px] leading-[1.2] text-[#141414]">
          {BENEFITS_HEADING}
        </h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {BENEFITS.map((b) => (
            <li
              key={b.title}
              className="flex flex-col gap-4 bg-white border border-[#EEEEEE] rounded-2xl p-6"
            >
              {/* 40×40 icon inside a 64×64 tile — both dimensions fixed,
                  per the design. The tile fill is what makes the icon
                  read as a badge rather than floating in the card. */}
              <span className="shrink-0 w-16 h-16 rounded-lg bg-[#F3F4F2] flex items-center justify-center">
                <Image src={b.icon} alt="" width={40} height={40} aria-hidden />
              </span>
              <h3 className="font-poppins font-semibold text-xl leading-[1.52] text-[#141414]">
                {b.title}
              </h3>
              <p className="font-poppins text-base leading-[1.6] text-[#424242]">
                {b.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * 3. Testimonials
 * ──────────────────────────────────────────────────────────────── */
function Testimonials({ items }: { items?: TestimonialItem[] }) {
  const [idx, setIdx] = useState(0);
  // Admin-managed when any are published, otherwise the built-in card.
  const stories = items && items.length ? items : FALLBACK_TESTIMONIALS;
  const total = stories.length;
  // Clamp: the list can shrink between renders if a story is unpublished
  // while someone has the page open.
  const t = stories[Math.min(idx, total - 1)];
  if (!t) return null;
  const avatar = testimonialAvatarSrc(t.avatar);

  return (
    <section className="bg-black">
      <div className="max-w-[1232px] mx-auto px-6 sm:px-10 py-16 lg:py-24 flex flex-col gap-10">
        <h2 className="font-poppins font-medium text-[28px] lg:text-[40px] leading-[1.2] text-white">
          {TESTIMONIALS_HEADING}
        </h2>
        {/* max-w 1100, not 900: in the design this intro wraps to exactly TWO
            lines across the 1232px content column. At 900 it broke to three. */}
        <p className="font-poppins text-base leading-[1.52] text-white/70 max-w-[1100px]">
          {TESTIMONIALS_INTRO}
        </p>

        {/* Full content width. This carried a max-w-[720px] that squeezed the
            card to ~60% and pushed the quote onto three lines; the design card
            spans the full 1232px column with the quote on two. */}
        <div className="bg-white rounded-2xl p-6 sm:p-9 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {avatar ? (
              <Image
                src={avatar}
                alt=""
                width={46}
                height={46}
                className="w-[46px] h-[46px] rounded-full object-cover"
                aria-hidden
              />
            ) : (
              /* The avatar is optional in the admin form — initials beat a
                 broken-image icon. */
              <span
                aria-hidden
                className="w-[46px] h-[46px] rounded-full bg-[#EEEEEE] grid place-items-center font-poppins font-semibold text-sm text-[#575757]"
              >
                {testimonialInitials(t.name)}
              </span>
            )}
            <div className="flex flex-col">
              <span className="font-poppins font-semibold text-sm leading-[1.52] text-[#141414]">
                {t.name}
              </span>
              {t.company && (
                <span className="font-poppins text-xs leading-[1.52] text-[#575757]">
                  {t.company}
                </span>
              )}
            </div>
          </div>
          {/* Quotation marks come from TestimonialQuote, not the stored
              content — the admin form tells authors not to add their own. */}
          <TestimonialQuote html={t.quote} className={BODY} />
        </div>

        {/* Controls only exist when there is somewhere to go.
            The Figma frame shows them beside a single slide, and they used
            to render unconditionally for that reason — disabled at both
            ends. But with the testimonials now admin-managed, one entry is
            the normal starting state, not a mock-up artefact, and a pair of
            permanently dead buttons reads as broken UI rather than as a
            carousel. Product call: hide them below two stories.
            Right-aligned to match the design, where they sit under the
            card's right edge. */}
        {total > 1 && (
          <div className="flex items-center justify-end gap-3">
            <CarouselButton
              label="Previous testimonial"
              disabled={idx === 0}
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              direction="left"
            />
            <CarouselButton
              label="Next testimonial"
              disabled={idx === total - 1}
              onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
              direction="right"
            />
          </div>
        )}
      </div>
    </section>
  );
}

function CarouselButton({
  label,
  disabled,
  onClick,
  direction,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  direction: 'left' | 'right';
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="w-11 h-11 rounded-full bg-[#EEEEEE] text-[#141414] flex items-center justify-center shadow-[0_1px_2px_#0000000F] transition enabled:hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden>
        <path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 6 6 6-6 6'} />
      </svg>
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * 4. Guide — sticky anchor rail + 12 cards
 * ──────────────────────────────────────────────────────────────── */
/**
 * `categoryPages` is threaded down to GuideCard, which renders the
 * category shortlist inside section 02. It used to be read straight off
 * the module scope there — which type-checked as an error and, more to
 * the point, meant the CMS-authored links never arrived and the shortlist
 * always rendered its static fallback labels.
 */
function Guide({ categoryPages }: { categoryPages: CategoryPageLink[] }) {
  const [activeId, setActiveId] = useState(GUIDE_SECTIONS[0]?.id ?? '');
  const navRef = useRef<HTMLElement | null>(null);

  /**
   * Track which section is in view so the rail highlights it.
   *
   * `rootMargin` pulls the trigger line down to just under the sticky
   * header (64px) plus a little breathing room — without it, a section
   * counts as "active" while still hidden behind the header.
   */
  useEffect(() => {
    const els = GUIDE_SECTIONS
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!els.length) return;

    const obs = new IntersectionObserver(
      (entries) => {
        // Prefer the topmost intersecting section; several can be in
        // view at once on a tall viewport.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-96px 0px -60% 0px', threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  // Keep the active tab scrolled into view within the rail on long lists.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  return (
    <section className="bg-white">
      <div className="max-w-[1232px] mx-auto px-6 sm:px-10 lg:px-0 py-16 lg:py-24">
        <div className="flex flex-col lg:flex-row gap-8 lg:gap-10">
          {/* ── Anchor rail ──
              Sticky on desktop. Below lg it becomes a horizontally
              scrolling strip pinned under the header, which keeps the
              table of contents usable on mobile without eating a screen
              of vertical space. */}
          <nav
            ref={navRef}
            aria-label="On this page"
            className="lg:w-[282px] lg:shrink-0 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto
                       sticky top-16 z-20 -mx-6 sm:-mx-10 lg:mx-0 px-6 sm:px-10 lg:px-0 py-3 lg:py-0
                       bg-white/95 backdrop-blur lg:bg-transparent lg:backdrop-blur-none
                       border-b border-[#EEEEEE] lg:border-b-0"
          >
            <ul className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
              {GUIDE_SECTIONS.map((s) => {
                const active = s.id === activeId;
                return (
                  <li key={s.id} className="shrink-0 lg:shrink">
                    <a
                      href={`#${s.id}`}
                      data-active={active}
                      aria-current={active ? 'true' : undefined}
                      className={`block whitespace-nowrap lg:whitespace-normal px-3 py-2 font-poppins text-sm leading-[1.65] transition ${
                        active
                          ? 'bg-[#EEEEEE] text-[#141414] rounded-lg font-medium'
                          : 'text-[#424242] rounded hover:text-[#141414] hover:bg-[#F5F5F5]'
                      }`}
                    >
                      {s.navLabel}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* ── Cards ── */}
          <div className="flex-1 min-w-0 flex flex-col gap-10">
            {GUIDE_SECTIONS.map((s) => (
              <GuideCard key={s.id} section={s} categoryPages={categoryPages} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function GuideCard({
  section: s,
  categoryPages,
}: {
  section: GuideSection;
  categoryPages: CategoryPageLink[];
}) {
  return (
    /* `scroll-mt` clears the sticky header when an anchor link jumps
       here — without it the heading lands underneath the chrome. */
    <article id={s.id} className={`${CARD} scroll-mt-32 lg:scroll-mt-28`}>
      <Pill>{s.pill}</Pill>

      {/* Section 12 wraps its heading and intro INSIDE an image block
          rather than stacking them above one, so it takes over both. */}
      {s.id === 'help-and-support' ? (
        <SupportBlock section={s} />
      ) : (
        <>
          <h2 className="font-poppins font-semibold text-[22px] sm:text-[28px] leading-[1.52] text-black">
            {s.heading}
          </h2>
          {s.paras?.map((p) => (
            <p key={p.slice(0, 40)} className={BODY}>
              {p}
            </p>
          ))}
        </>
      )}

      {s.itemsHeading && s.groups && (
        <h3 className="font-poppins font-semibold text-xl leading-[1.52] text-[#141414]">
          {s.itemsHeading}
        </h3>
      )}

      {s.groups?.map((g) => (
        <div key={g.title} className="flex flex-col gap-3">
          <h4 className="font-poppins font-semibold text-xl leading-[1.52] text-[#141414]">
            {g.title}
          </h4>
          <CheckGrid items={g.items} />
        </div>
      ))}

      {s.itemsHeading && !s.groups && (
        <h3 className="font-poppins font-semibold text-xl leading-[1.52] text-[#141414]">
          {s.itemsHeading}
        </h3>
      )}
      {s.items && !s.groups && <CheckGrid items={s.items} />}

      {s.subSectionsHeading && (
        <h3 className="font-poppins font-semibold text-xl leading-[1.52] text-[#141414]">
          {s.subSectionsHeading}
        </h3>
      )}
      {s.subSections?.map((sub) => (
        <div key={sub.title} className="flex flex-col gap-2">
          <h4 className="font-poppins font-semibold text-base leading-[1.52] text-[#141414]">
            {sub.title}
          </h4>
          {sub.body && <p className={BODY}>{sub.body}</p>}
          {sub.items && <CheckGrid items={sub.items} />}
        </div>
      ))}

      {s.stepsHeading && (
        <h3 className="font-poppins font-semibold text-xl leading-[1.52] text-[#141414]">
          {s.stepsHeading}
        </h3>
      )}
      {s.steps && <StepList steps={s.steps} />}

      {/* Section 07 is the responsibilities table. */}
      {s.id === 'responsibilities' && <ResponsibilitiesTable />}

      {/* Section 01's nested GSTIN card. */}
      {s.id === 'create-account' && <GstinCard />}

      {/* Section 02's nested category shortlist. */}
      {s.id === 'choose-a-category' && <CategoryShortlist pages={categoryPages} />}

      {s.closing && <p className={BODY}>{s.closing}</p>}

      {s.ctas && s.ctas.length > 0 && (
        <div className="flex flex-wrap gap-3 pt-1">
          {s.ctas.map((c) => (
            <Link
              key={c.label}
              href={c.href.startsWith('/page/') ? sellerContentUrl(c.href) : sellerUrl(c.href)}
              className={c.variant === 'primary' ? CTA_PRIMARY : CTA_SECONDARY}
            >
              {c.label}
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}

/** Blue information pill above each guide heading. */
function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="self-start inline-flex items-center rounded-full bg-[#EAF4FF] px-3 py-0.5 min-h-7 font-poppins font-semibold text-base leading-[1.32] text-[#2563EB]">
      {children}
    </span>
  );
}

/** Two-column check list. Single column below sm. */
function CheckGrid({ items }: { items: string[] }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
      {items.map((it) => (
        <li key={it} className="flex items-start gap-2">
          <CheckIcon />
          <span className={BODY}>{it}</span>
        </li>
      ))}
    </ul>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="w-5 h-5 shrink-0 mt-0.5 text-[#141414]"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M10 1.667a8.333 8.333 0 1 1 0 16.666 8.333 8.333 0 0 1 0-16.666Zm3.256 5.755a.833.833 0 0 0-1.155.024L9.09 10.49 7.923 9.32a.833.833 0 1 0-1.179 1.178l1.75 1.75a.833.833 0 0 0 1.184-.012l3.6-3.7a.833.833 0 0 0-.022-1.114Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** Numbered steps with a connector line down the left. */
function StepList({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((st, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={st.n} className="flex gap-4">
            {/* Marker column: circle + connector. The connector is
                omitted on the last item so the line doesn't dangle. */}
            <div className="flex flex-col items-center shrink-0">
              <span className="w-[34px] h-[34px] rounded-full bg-black text-white font-poppins text-sm font-semibold flex items-center justify-center">
                {st.n}
              </span>
              {!last && <span aria-hidden className="w-px flex-1 min-h-6 bg-[#E0E0E0] my-1" />}
            </div>
            <div className={`flex flex-col gap-1 ${last ? '' : 'pb-6'}`}>
              <h4 className="font-poppins font-semibold text-base leading-[1.52] text-[#141414]">
                {st.title}
              </h4>
              <p className={BODY}>{st.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Section 01 — nested "Don't Have a GSTIN?" card on #F5F5F5. */
function GstinCard() {
  return (
    <div className="bg-[#F5F5F5] rounded-3xl p-6 sm:p-8 lg:p-10 flex flex-col gap-6">
      <h3 className="font-poppins font-semibold text-[22px] sm:text-[28px] leading-[1.52] text-black">
        {GSTIN_CARD.heading}
      </h3>
      {GSTIN_CARD.paras.map((p) => (
        <p key={p.slice(0, 40)} className={BODY}>
          {p}
        </p>
      ))}
      <div className="h-px bg-[#E0E0E0]" />
      <h4 className="font-poppins font-semibold text-2xl leading-[1.52] text-black">
        {GSTIN_CARD.stepsHeading}
      </h4>
      <StepList steps={GSTIN_CARD.steps} />
    </div>
  );
}

/**
 * Section 02 — nested "Choose Your Categories" link grid.
 *
 * FOUR across, so labels flow row-wise: four published pages fill one
 * row rather than a column and a bit. Labels are each page's Short title
 * (`sellerCategory.linkTitle`), not its H1 — the H1 is written to be
 * descriptive and doesn't fit a grid cell. Capped at
 * MAX_SELLER_CATEGORY_LINKS upstream in lib/sellerCategoryLinks.
 */
function CategoryShortlist({ pages }: { pages: CategoryPageLink[] }) {
  return (
    <div className="bg-white border border-[#E0E0E0] rounded-2xl p-6 sm:p-8 lg:p-10 flex flex-col gap-6">
      <h3 className="font-poppins font-semibold text-xl leading-[1.52] text-[#141414]">
        {CATEGORY_SHORTLIST_HEADING}
      </h3>
      {/* Real, published pages become LINKS. The static labels remain as a
          text-only fallback for whatever hasn't been authored yet — the
          original reason this grid was plain text at all was that linking to
          16 non-existent pages would have shipped 16 dead links. Now the two
          are distinguished: authored ones link, the rest still just read. */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
        {pages.length > 0
          ? pages.map((p) => (
              <li key={p.slug}>
                <Link
                  href={p.href}
                  className="font-poppins text-base leading-[1.52] text-[#424242] hover:text-[#141414] underline decoration-[#D3FF33] decoration-2 underline-offset-4 transition-colors"
                >
                  {p.label}
                </Link>
              </li>
            ))
          : CATEGORY_SHORTLIST.map((label) => (
              <li key={label}>
                <span className="font-poppins text-base leading-[1.52] text-[#424242]">
                  {label}
                </span>
              </li>
            ))}
      </ul>
    </div>
  );
}

/**
 * Section 12 — image beside the heading and intro copy.
 *
 * The image is a fixed 170×202 per the design (both dimensions set, not
 * `auto`, so the portrait crop is preserved); the text column flexes.
 */
function SupportBlock({ section: s }: { section: GuideSection }) {
  return (
    <div className="bg-white rounded-xl p-4 sm:p-8 flex flex-col sm:flex-row gap-6 items-start">
      <div className="relative shrink-0 w-[170px] h-[202px] rounded-lg overflow-hidden">
        <Image
          src={SUPPORT_IMAGE.src}
          alt={SUPPORT_IMAGE.alt}
          fill
          sizes="170px"
          className="object-cover"
        />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <h2 className="font-poppins font-semibold text-[22px] sm:text-[28px] leading-[1.52] text-black">
          {s.heading}
        </h2>
        {s.paras?.map((p) => (
          <p key={p.slice(0, 40)} className={BODY}>
            {p}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Section 07 — 3-column responsibilities table. */
function ResponsibilitiesTable() {
  return (
    /* Horizontal scroll below the breakpoint rather than a stacked
       card list: the value of this table is the side-by-side reading,
       which stacking destroys. */
    <div className="overflow-x-auto -mx-6 sm:mx-0 px-6 sm:px-0">
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr>
            {RESPONSIBILITIES_COLUMNS.map((c) => (
              <th
                key={c}
                scope="col"
                className="border border-[#D8D8D8] bg-white p-6 text-left font-poppins font-semibold text-lg leading-[1.52] text-black"
              >
                {c}
              </th>
            ))}
            <th
              scope="col"
              className="border border-[#D8D8D8] bg-[#F3F4F2] p-6 text-left"
            >
              {/* The design puts the wordmark in this header cell rather
                  than the word "Throttlein". */}
              <Image
                src="/images/throttlein-logo.webp"
                alt="Throttlein"
                width={188}
                height={46}
                className="object-contain h-[46px] w-auto"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {RESPONSIBILITIES.map((r) => (
            <tr key={r.activity}>
              <th
                scope="row"
                className="border border-[#D8D8D8] p-6 text-left align-top font-poppins font-normal text-lg leading-[1.52] text-black"
              >
                {r.activity}
              </th>
              <td className="border border-[#D8D8D8] p-6 align-top font-poppins text-lg leading-[1.52] text-black">
                {r.seller}
              </td>
              <td className="border border-[#D8D8D8] bg-[#F3F4F2] p-6 align-top font-poppins text-lg leading-[1.52] text-black">
                {r.throttlein}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * 5. Closing CTA
 * ──────────────────────────────────────────────────────────────── */
function ClosingCta() {
  return (
    <section className="relative overflow-hidden">
      <Image
        src={CLOSING_CTA.background}
        alt=""
        fill
        sizes="100vw"
        aria-hidden
        className="object-cover"
      />
      {/* Left-to-right black gradient from the design — keeps the copy
          legible over the photo regardless of the crop. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(270deg, rgb(0,0,0) 34.551%, rgba(0,0,0,0.701) 65.557%, rgba(0,0,0,0.556) 84.906%, rgba(0,0,0,0.217) 97.039%, rgba(0,0,0,0) 100%)',
        }}
      />
      <div className="relative max-w-[1222px] mx-auto px-6 sm:px-10 lg:px-20 py-16 lg:py-20">
        <div className="max-w-[800px] mx-auto flex flex-col items-center text-center gap-6">
          <h2 className="font-poppins font-medium text-[28px] lg:text-[40px] leading-[1.2] text-white">
            {CLOSING_CTA.heading}
          </h2>
          <p className="font-poppins text-lg leading-[1.52] text-white">
            {CLOSING_CTA.body}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href={sellerUrl('/register')} className={CTA_LIME}>
              Become a Seller
            </Link>
            {/* Clean slug shape — the legacy /page/ prefix only worked
                via the proxy's 301, wasting a redirect hop. */}
            <Link
              href={sellerContentUrl('/pricing-and-fees')}
              className="inline-flex items-center justify-center min-h-10 px-4 py-1 rounded-lg border border-white/40 bg-white/10 text-white font-poppins text-sm leading-[1.3] whitespace-nowrap transition hover:bg-white/20"
            >
              Explore Fees and Pricing
            </Link>
          </div>
          <ProofPoints points={CLOSING_CTA.proofPoints} tone="light" />
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * 6. FAQ
 * ──────────────────────────────────────────────────────────────── */
function Faq() {
  return (
    <section className="bg-white">
      <div className="max-w-[1000px] mx-auto px-6 sm:px-10 lg:px-20 py-16 lg:py-20 flex flex-col gap-10">
        <div className="flex flex-col items-center gap-4">
          <span className="inline-flex items-center h-8 px-2 rounded bg-[#D4FA00] font-poppins font-semibold text-sm leading-[22px] tracking-[1px] text-black">
            FAQ
          </span>
          <h2 className="font-poppins font-semibold text-[22px] sm:text-[28px] leading-[1.52] text-[#141414] text-center">
            Have any questions?
          </h2>
        </div>
        <FaqAccordion items={FAQ} />
      </div>
    </section>
  );
}
