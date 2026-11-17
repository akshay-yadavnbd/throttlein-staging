'use client';

/**
 * Seller-category landing page — template='seller-category'.
 * Figma node 4583:10494 ("Sell Helmets Online on ThrottleIn").
 *
 * Public URL: seller.throttlein.com/sell-online/<slug>
 *
 * Sections, top to bottom (header/footer come from app/seller/layout.tsx):
 *   1. Hero — H1 + 2 paragraphs + CTA + image, #FAFBF8
 *   2. Benefit cards — 5, shared
 *   3. "Expand Your … Business Online" — long copy + wide image
 *   4. "Why Sell …" — 6 cards, shared
 *   5. "Who Can Sell …" — checklist + image
 *   6. Seller Success Stories — black band, carousel
 *   7. Types — resolved from the linked category's children
 *   8. Brands — resolved from the linked category's brands
 *   9. Steps — 7 cards with illustrations, shared, + onboarding video
 *  10. Tips — 8 cards, shared
 *  11. Closing CTA — photo + gradient
 *  12. FAQ — per-page accordion
 *
 * PER-PAGE vs SHARED: only the category-specific parts come from the Page
 * record. Benefits / why / steps / video / tips / closing are defined once in
 * lib/sellerCategoryContent.ts and personalised through a {category} token, so
 * a copy change is one edit instead of one per category page.
 *
 * Button and body classes are IMPORTED from SellOnlinePage rather than
 * redeclared — both pages come from the same Figma system, and two copies of
 * the same class string drift the moment one is edited.
 */

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import FaqAccordion from '@/components/common/FaqAccordion';
import RichTextView from '@/components/common/RichTextView';
import TestimonialQuote from '@/components/common/TestimonialQuote';
import { sellerUrl } from '@/lib/sellerUrl';
import { originForSite } from '@/lib/site';
import { imageUrl } from '@/lib/api';
import { CTA_PRIMARY, CTA_SECONDARY, CTA_LIME, BODY } from '@/components/pages/SellOnlinePage';
import {
  FALLBACK_ITEMS as FALLBACK_TESTIMONIALS,
  testimonialAvatarSrc,
  testimonialInitials,
  type TestimonialItem,
} from '@/lib/testimonials';
import {
  BENEFITS, BENEFITS_HEADING,
  WHY_HEADING, WHY_INTRO, WHY_CARDS,
  STEPS, STEPS_HEADING, STEPS_INTRO,
  VIDEO, TIPS, TIPS_HEADING, CLOSING,
  TYPES_HEADING, BRANDS_HEADING, ELIGIBILITY_HEADING,
  TESTIMONIALS_HEADING, FAQ_HEADING,
  fillCategory, type IconCard,
} from '@/lib/sellerCategoryContent';

/* ── Shared section chrome ─────────────────────────────────────────── */
/* 1312 - (2 x 40px padding) = 1232px of content, matching the design's
   content column. Using max-w-[1232px] with padding gave 1072 and re-wrapped
   every heading — the hero H1 went to three lines instead of two. */
export const BAND = 'max-w-[1312px] mx-auto px-6 sm:px-10 py-16 lg:py-24 flex flex-col gap-10';
export const H2 = 'font-poppins font-medium text-[28px] lg:text-[40px] leading-[1.2] text-[#141414]';
/** Icon card — used by both the benefits grid (S3) and "why sell" (S5). The
 *  design ships one component in two fills; the icon-less variant is S11. */
const ICON_CARD = 'flex flex-col gap-3 bg-[#F3F4F2] border border-[#EEEEEE] rounded-2xl p-6';

export type CategoryTile = { name: string; slug?: string; image?: string };

/* ── Step-card illustration geometry ───────────────────────────────────
 * The design does NOT give the seven step illustrations a shared size. It
 * was implemented with one (`h-[220px] lg:h-[283px]` for all of them),
 * which is why five of the seven were the wrong height and card 06 was
 * inset when the design runs it edge to edge.
 *
 * Measured from Figma node 4583:10720. Every card is 394.67 × 536 with
 * 24px padding, and our grid reproduces that exactly at `lg`:
 * (1232 - 2 × 24 gap) / 3 = 394.67. So the `lg:` values below are the
 * design's own pixels, not approximations.
 *
 *   card  node          x        y       w × h        treatment
 *   01    4583:10726    25    252.67   345 × 283    inset, flush bottom
 *   02    4583:10732    24.33 260.06   346 × 363    inset, clipped by card
 *   03    4583:10740   103.63 317.70   208 × 127    centred, 91px below
 *   04    4583:10749    25    252.67   345 × 283    inset, flush bottom
 *   05    4583:10756    25.33 228.06   345 × 308    inset, flush bottom
 *   06    4583:10762    -0.33 206.06   395 × 330    FULL WIDTH, flush
 *   07    4583:10768    62    253.06   270 × 219    centred, 64px below
 *
 * For the bleed cards the height is simply 536 − y, since they all end at
 * the card's bottom edge (02 overruns it and is clipped, which is what
 * `object-cover object-top` reproduces).
 *
 * The smaller breakpoint scales by 420/536 ≈ 0.784, matching the reduced
 * `min-h-[420px]` card.
 *
 * Class strings are written out in full rather than composed, because
 * Tailwind only generates utilities it can see literally in source.
 */
const BLEED_IMG = 'object-cover object-top rounded-t-[22px] border border-white';
/** Card 06 spans the full card width, so the card's own rounded corners
 *  and `overflow-hidden` do the clipping — a rounded top and hairline
 *  border here would draw a seam across the middle of the card. */
const BLEED_FULL_IMG = 'object-cover object-top';
const CENTER_IMG = 'object-contain object-center';

type StepMedia = { wrap: string; img: string; bleed: boolean };

const STEP_MEDIA: Record<string, StepMedia> = {
  '01': { wrap: 'mt-auto w-full h-[222px] lg:h-[283px]', img: BLEED_IMG, bleed: true },
  '02': { wrap: 'mt-auto w-full h-[216px] lg:h-[276px]', img: BLEED_IMG, bleed: true },
  // Design gap below the artwork is 91px TOTAL. Centred cards keep the
  // card's own pb-6, so the margin is 91 − 24 = 67, not 91 — measuring the
  // rendered box caught that double-count.
  '03': {
    wrap: 'mt-auto mx-auto w-[163px] h-[100px] mb-[53px] lg:w-[208px] lg:h-[127px] lg:mb-[67px]',
    img: CENTER_IMG,
    bleed: false,
  },
  '04': { wrap: 'mt-auto w-full h-[222px] lg:h-[283px]', img: BLEED_IMG, bleed: true },
  '05': { wrap: 'mt-auto w-full h-[241px] lg:h-[308px]', img: BLEED_IMG, bleed: true },
  // -mx-6 cancels the card's 24px padding on both sides: 346.67 + 48 = 394.67.
  '06': { wrap: 'mt-auto -mx-6 h-[259px] lg:h-[330px]', img: BLEED_FULL_IMG, bleed: true },
  // 64px total gap − the card's 24px pb-6 = 40.
  '07': {
    wrap: 'mt-auto mx-auto w-[212px] h-[172px] mb-[31px] lg:w-[270px] lg:h-[219px] lg:mb-[40px]',
    img: CENTER_IMG,
    bleed: false,
  },
};

/** Used if a step number ever appears without an entry above — the most
 *  common treatment, so a new step degrades to something sensible rather
 *  than to a zero-height box. */
const STEP_MEDIA_DEFAULT: StepMedia = STEP_MEDIA['01'];

export type SellerCategoryData = {
  title: string;
  noun?: string;
  nounPlural?: string;
  heroBodyOne?: string;
  heroBodyTwo?: string;
  heroImage?: string;
  expandHeading?: string;
  expandBody?: string;
  expandImage?: string;
  /* ── "Why sell" slider (Template 2) — admin-managed, all optional.
     Blank heading/intro and an empty card list fall back to the shared
     static copy in lib/sellerCategoryContent.ts. */
  whyHeading?: string;
  whyIntro?: string;
  whyCards?: { title: string; body: string; image?: string }[];
  /* ── "How to register" steps accordion (Template 2) — admin-managed,
     all optional; blanks fall back to the shared static steps. */
  stepsHeading?: string;
  stepsIntro?: string;
  steps?: { title: string; body: string; image?: string }[];
  /** Closing CTA band background photo (Template 2) — blank keeps the built-in. */
  closingImage?: string;
  eligibilityBody?: string;
  eligibilityIntro?: string;
  eligibilityItems?: string[];
  eligibilityFootnote?: string;
  eligibilityImage?: string;
  /** Template-2 banner heading — blank falls back to the shared heading. */
  eligibilityHeading?: string;
  /** Template-2 banner photo collage, in display order. */
  eligibilityImages?: string[];
  /* ── Video block (admin-managed, per page) ──
     All three are optional; the section renders only when `videoId` is
     set, so a page that hasn't configured one shows nothing instead of
     an inert play button. */
  videoHeading?: string;
  videoThumbnail?: string;
  /** BARE YouTube id, not a URL — normalised server-side on save. */
  videoId?: string;
  faq?: { question: string; answer: string }[];
  /** Resolved server-side from the linked category — never authored by hand. */
  types?: CategoryTile[];
  brands?: CategoryTile[];
  /**
   * Published testimonials for the seller property, fetched server-side.
   * Shared across every seller-category page rather than authored per
   * page — a success story is about the marketplace, not about helmets
   * specifically. Omitted (or empty) falls back to the built-in card.
   */
  testimonials?: TestimonialItem[];
};

export default function SellerCategoryPage({ data }: { data: SellerCategoryData }) {
  const long = data.nounPlural || data.noun || 'products';
  const short = data.noun || data.nounPlural || 'products';
  const t = (s: string) => fillCategory(s, long, short);

  return (
    <div className="bg-white">
      {/* ── 1. Hero ─────────────────────────────────────────────── */}
      <section className="bg-[#FAFBF8]">
        <div className="max-w-[1312px] mx-auto px-6 sm:px-10 py-16 lg:py-20">
          <div className="flex flex-col lg:flex-row lg:items-center gap-10 lg:gap-[60px]">
            <div className="flex-1 min-w-0 flex flex-col gap-8">
              <div className="flex flex-col gap-3">
                <h1 className="font-poppins font-medium text-[40px] sm:text-[52px] lg:text-[64px] leading-[1.24] tracking-[-1.5px] lg:tracking-[-3px] text-black">
                  {data.title}
                </h1>
                {data.heroBodyOne && <p className={BODY}>{data.heroBodyOne}</p>}
                {data.heroBodyTwo && <p className={BODY}>{data.heroBodyTwo}</p>}
              </div>
              <div>
                <Link
                  href={sellerUrl('/register')}
                  className={`${CTA_PRIMARY} min-h-12 px-6 py-2 text-base`}
                >
                  Start Selling
                </Link>
              </div>
            </div>

            {/* White card holding the product shot — 608×464 in the design.
                Rendered ONLY when an image is set. There used to be a fallback
                to the Figma export here, which made the admin say "No image"
                while the page showed a photo — and since those exports are
                helmet-specific, every other category would have silently
                published with helmet imagery. A missing image should look
                missing. */}
            {data.heroImage && (
              <div className="flex-1 min-w-0 w-full rounded-2xl bg-white grid place-items-center aspect-[608/464] overflow-hidden">
                <div className="relative w-[316px] h-[316px] max-w-full">
                  <Image
                    src={imageUrl(data.heroImage)}
                    alt=""
                    fill
                    priority
                    sizes="316px"
                    className="object-contain"
                    aria-hidden
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 2. Benefits (shared) ────────────────────────────────── */}
      <section className="bg-white">
        <div className={BAND}>
          <h2 className={H2}>{BENEFITS_HEADING}</h2>
          <IconCardGrid cards={BENEFITS} t={t} />
        </div>
      </section>

      {/* ── 3. Expand your business — long copy + wide image ────── */}
      {(data.expandBody || data.expandHeading) && (
        <section className="bg-[#FAFBF8]">
          <div className={BAND}>
            {data.expandHeading && <h2 className={H2}>{data.expandHeading}</h2>}
            {/* Rich text from the admin editor. RichTextView is the project's
                existing renderer for admin-authored HTML (it sanitises and
                applies the shared typography), so this can't diverge from how
                the storefront renders Bottom Content. */}
            {data.expandBody && (
              <RichTextView
                html={data.expandBody}
                className="font-poppins text-base leading-[1.52] text-[#424242]"
              />
            )}
            {data.expandImage && (
              <div className="relative w-full aspect-[1232/526] rounded-2xl overflow-hidden">
                <Image
                  src={imageUrl(data.expandImage)}
                  alt=""
                  fill
                  sizes="(max-width: 1232px) 100vw, 1232px"
                  className="object-cover"
                  aria-hidden
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── 4. Why sell (shared) ────────────────────────────────── */}
      <section className="bg-white">
        <div className={BAND}>
          <div className="flex flex-col gap-3">
            <h2 className={H2}>{t(WHY_HEADING)}</h2>
            <p className={`${BODY} max-w-[1100px]`}>{t(WHY_INTRO)}</p>
          </div>
          <IconCardGrid cards={WHY_CARDS} t={t} />
        </div>
      </section>

      {/* ── 5. Who can sell — one rich-text block + image ────────── */}
      {(data.eligibilityBody || data.eligibilityItems?.length || data.eligibilityIntro) && (
        <section className="bg-[#FAFBF8]">
          <div className="max-w-[1312px] mx-auto px-6 sm:px-10 py-16 lg:py-24">
            {/* One column when there is no image — otherwise the checklist
                sits in a half-width column next to a gap. */}
            <div
              className={`grid grid-cols-1 gap-10 items-center ${
                data.eligibilityImage ? 'lg:grid-cols-2' : ''
              }`}
            >
              <div className="flex flex-col gap-4">
                <h2 className={H2}>{t(ELIGIBILITY_HEADING)}</h2>

                {/* One authored block: intro, list and closing note. The
                    `eligibility-rich` class swaps list bullets for the design's
                    circle-check icon, so an admin writes an ordinary <ul> and
                    still gets ticks. */}
                {data.eligibilityBody ? (
                  <RichTextView
                    html={data.eligibilityBody}
                    className={`eligibility-rich ${BODY}`}
                  />
                ) : (
                  /* Legacy records written before the three fields were merged.
                     Renders until the page is next saved, at which point the
                     admin has already composed them into eligibilityBody. */
                  <>
                    {data.eligibilityIntro && (
                      <RichTextView html={data.eligibilityIntro} className={BODY} />
                    )}
                    <ul className="flex flex-col gap-4">
                      {(data.eligibilityItems || []).map((item) => (
                        <li key={item} className="flex items-start gap-2">
                          <Image
                            src="/images/seller-category/icon-circle-check.svg"
                            alt=""
                            width={20}
                            height={20}
                            className="mt-0.5 shrink-0"
                            aria-hidden
                          />
                          <span className={BODY}>{item}</span>
                        </li>
                      ))}
                    </ul>
                    {data.eligibilityFootnote && (
                      <RichTextView
                        html={data.eligibilityFootnote}
                        className="font-poppins text-base leading-[1.52] text-[#424242]"
                      />
                    )}
                  </>
                )}
              </div>
              {data.eligibilityImage && (
                <div className="relative w-full aspect-[596/560] rounded-2xl overflow-hidden">
                  <Image
                    src={imageUrl(data.eligibilityImage)}
                    alt=""
                    fill
                    sizes="(max-width: 1024px) 100vw, 596px"
                    className="object-cover"
                    aria-hidden
                  />
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── 6. Seller success stories ───────────────────────────── */}
      <SuccessStories items={data.testimonials} />

      {/* ── 7. Types — from the linked category's children ──────── */}
      {!!data.types?.length && (
        <section className="bg-white">
          <div className={BAND}>
            <h2 className={`${H2} text-center`}>{t(TYPES_HEADING)}</h2>
            <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6">
              {data.types.map((x) => (
                <li key={x.name}>
                  <TileLink tile={x}>
                    <div className="relative w-full aspect-[309/349] rounded-lg bg-[#F3F4F2] p-3 overflow-hidden">
                      {x.image && (
                        <Image
                          src={imageUrl(x.image)}
                          alt=""
                          fill
                          sizes="309px"
                          className="object-cover rounded-lg"
                          aria-hidden
                        />
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 pl-2 py-3">
                      <span className="font-poppins font-semibold text-base leading-[1.32] text-black">
                        {x.name}
                      </span>
                      {/* 24x24 outer box with a ~7x12 glyph inside it — the
                          design insets the chevron to the middle 25%/50% of
                          its box. Sizing the image itself to 24x24 made the
                          arrow ~3x too big, because the exported SVG is 8x14
                          and was being stretched to fill the square. */}
                      <span className="w-6 h-6 shrink-0 grid place-items-center">
                        <Image
                          src="/images/seller-category/icon-chevron-right.svg"
                          alt=""
                          width={7}
                          height={12}
                          aria-hidden
                        />
                      </span>
                    </div>
                  </TileLink>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ── 8. Brands — from the linked category ────────────────── */}
      {!!data.brands?.length && (
        <section className="bg-[#FAFBF8]">
          <div className={BAND}>
            <h2 className={`${H2} text-center`}>{t(BRANDS_HEADING)}</h2>
            <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-6">
              {data.brands.map((b) => (
                <li key={b.name} className="flex flex-col gap-2">
                  <TileLink prefix="/brands" tile={b}>
                    <div className="relative w-full aspect-square rounded bg-[#F3F4F2] p-4">
                      {b.image && (
                        <Image
                          src={imageUrl(b.image)}
                          alt=""
                          fill
                          sizes="180px"
                          className="object-contain p-4"
                          aria-hidden
                        />
                      )}
                    </div>
                    <span className="block font-poppins text-base leading-[1.52] text-black text-center truncate">
                      {b.name}
                    </span>
                  </TileLink>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ── 9. Steps (shared) + onboarding video ────────────────── */}
      <section className="bg-white">
        <div className="max-w-[1312px] mx-auto px-6 sm:px-10 py-16 lg:py-24 flex flex-col gap-20">
          <div className="flex flex-col gap-10">
            <div className="flex flex-col gap-3">
              <h2 className={H2}>{t(STEPS_HEADING)}</h2>
              <p className={BODY}>{STEPS_INTRO}</p>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {STEPS.map((s) => {
                const media = STEP_MEDIA[s.n] ?? STEP_MEDIA_DEFAULT;
                return (
                  <li
                    key={s.n}
                    // pb-0 ONLY for bleed illustrations, which run off the
                    // bottom edge. Centred graphics keep their padding, or the
                    // artwork would sit against an open edge.
                    className={`relative flex flex-col gap-2 bg-[#F3F4F2] rounded-2xl p-6 overflow-hidden min-h-[420px] lg:min-h-[536px] ${
                      s.image && media.bleed ? 'pb-0' : ''
                    }`}
                  >
                    <span className="font-poppins font-semibold text-2xl leading-[1.52] text-black">
                      {s.n}
                    </span>
                    <h3 className="font-poppins font-semibold text-2xl leading-[1.52] text-black">
                      {s.title}
                    </h3>
                    <p className="font-poppins text-base leading-[1.52] text-black">{s.body}</p>
                    {s.image && (
                      <div className={`relative ${media.wrap}`}>
                        <Image
                          src={s.image}
                          alt=""
                          fill
                          sizes="(max-width: 1024px) 100vw, 395px"
                          className={media.img}
                          aria-hidden
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Video block — per-page, and only when configured. */}
          {data.videoId && (
            <div className="flex flex-col items-center gap-8">
              <h3 className="font-poppins font-semibold text-2xl lg:text-[28px] leading-[1.52] text-black text-center">
                {data.videoHeading?.trim() || VIDEO.heading}
              </h3>
              <VideoCard
                thumbnail={data.videoThumbnail}
                title={data.videoHeading?.trim() || VIDEO.title}
                videoId={data.videoId}
              />
            </div>
          )}
        </div>
      </section>

      {/* ── 10. Tips (shared, icon-less cards) ──────────────────── */}
      <section className="bg-[#FAFBF8]">
        <div className={BAND}>
          <h2 className={`${H2} text-center`}>{t(TIPS_HEADING)}</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {TIPS.map((tip) => (
              <li
                key={tip.title}
                className="flex flex-col gap-3 bg-white border border-[#EEEEEE] rounded-2xl p-6"
              >
                <h3 className="font-poppins font-semibold text-xl leading-[1.52] text-black">
                  {tip.title}
                </h3>
                <p className="font-poppins text-base leading-[1.6] text-[#424242]">{tip.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── 11. Closing CTA ────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <Image
          src={CLOSING.background}
          alt=""
          fill
          sizes="100vw"
          className="object-cover"
          aria-hidden
        />
        {/* 270deg black gradient from the design — keeps the left-hand copy
            legible over the photo. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(270deg, rgb(0,0,0) 34.5%, rgba(0,0,0,0.7) 65.6%, rgba(0,0,0,0.556) 84.9%, rgba(0,0,0,0.217) 97%, rgba(0,0,0,0) 100%)',
          }}
        />
        <div className="relative max-w-[1312px] mx-auto px-6 sm:px-10 py-20">
          <div className="max-w-[800px] mx-auto flex flex-col items-center gap-10 text-center">
            <h2 className="font-poppins font-medium text-[28px] lg:text-[40px] leading-[1.2] text-white">
              {t(CLOSING.heading)}
            </h2>
            <p className="font-poppins text-lg leading-[1.52] text-white">{CLOSING.body}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href={sellerUrl('/register')} className={CTA_LIME}>
                {CLOSING.primary}
              </Link>
              <Link
                href={sellerUrl('/login')}
                className={`${CTA_SECONDARY} !bg-transparent !border-white !text-white w-[164px]`}
              >
                {CLOSING.secondary}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── 12. FAQ (per page) ─────────────────────────────────── */}
      {!!data.faq?.length && (
        <section className="bg-white">
          <div className="max-w-[1000px] mx-auto px-6 sm:px-10 py-20 flex flex-col gap-10">
            <div className="flex flex-col items-center gap-4">
              <span className="inline-flex items-center h-8 px-2 rounded bg-[#D3FF33] font-poppins font-semibold text-sm leading-[22px] tracking-[1px] text-black">
                FAQ
              </span>
              <h2 className="font-poppins font-semibold text-2xl lg:text-[28px] leading-[1.52] text-[#141414] text-center">
                {FAQ_HEADING}
              </h2>
            </div>
            {/* FaqAccordion's contract is {q, a}; the CMS stores the fuller
                {question, answer} so the admin form reads clearly. */}
            <FaqAccordion
              items={data.faq.map((f) => ({
                q: f.question,
                // Answers are rich text from the admin's blog-style editor;
                // FaqAccordion renders nodes, never raw HTML strings.
                a: <RichTextView html={f.answer} className="[&_p+p]:mt-2" />,
              }))}
            />
          </div>
        </section>
      )}
      {/* Circle-check list markers for the eligibility block. Scoped by class
          so it can't leak into other rich text on the page. The icon is the
          exported Figma asset, used as a mask-free background at its designed
          20x20 so it stays crisp. */}
      <style jsx global>{`
        .eligibility-rich ul {
          list-style: none;
          padding-left: 0;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .eligibility-rich ul li {
          position: relative;
          padding-left: 1.75rem;
        }
        .eligibility-rich ul li::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0.2em;
          width: 20px;
          height: 20px;
          background-image: url('/images/seller-category/icon-circle-check.svg');
          background-size: 20px 20px;
          background-repeat: no-repeat;
        }
      `}</style>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────── */

/** 40×40 icon in a 64×64 tile, per the design. Both dimensions are explicit —
 *  a relative fill would collapse inside the flex column. */
function IconCardGrid({ cards, t }: { cards: IconCard[]; t: (s: string) => string }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {cards.map((c) => (
        <li key={c.title} className={ICON_CARD}>
          <span className="shrink-0 w-16 h-16 rounded-lg bg-[#F3F4F2] flex items-center justify-center">
            <Image src={c.icon} alt="" width={40} height={40} aria-hidden />
          </span>
          <h3 className="font-poppins font-semibold text-xl leading-[1.52] text-black">
            {t(c.title)}
          </h3>
          <p className="font-poppins text-base leading-[1.6] text-[#424242]">{t(c.body)}</p>
        </li>
      ))}
    </ul>
  );
}

/** Wraps a tile in a link only when there's somewhere to go — a category with
 *  no slug would otherwise render an anchor to nowhere.
 *
 *  The href is ABSOLUTE on the main origin: these tiles point at
 *  storefront pages, which don't exist on the seller property.
 *  Rendered relative, they resolved against seller.throttlein.com and
 *  404'd — flagged by the SEO audit and the product owner.
 *
 *  `prefix`: category pages live at the storefront ROOT
 *  (/full-face-helmets), but brand pages live under /brands/<slug> —
 *  the link-check found the brand tiles 404ing at /axor, /ls2, … on
 *  the main origin too. */
export function TileLink({
  tile,
  children,
  prefix = '',
}: {
  tile: CategoryTile;
  children: React.ReactNode;
  prefix?: string;
}) {
  if (!tile.slug) return <div className="block">{children}</div>;
  return (
    <Link href={`${originForSite('main')}${prefix}/${tile.slug}`} className="block group">
      {children}
    </Link>
  );
}

export function SuccessStories({ items }: { items?: TestimonialItem[] }) {
  const [idx, setIdx] = useState(0);
  // Admin-managed when there are any, otherwise the built-in card. The
  // section is never rendered with zero slides.
  const stories = items && items.length ? items : FALLBACK_TESTIMONIALS;
  const total = stories.length;
  // An out-of-range index is possible if the list shrinks between
  // renders (a story unpublished while someone has the page open).
  const item = stories[Math.min(idx, total - 1)];
  if (!item) return null;

  const avatar = testimonialAvatarSrc(item.avatar);

  return (
    <section className="bg-black">
      <div className={BAND}>
        <h2 className="font-poppins font-medium text-[28px] lg:text-[40px] leading-[1.2] text-white">
          {TESTIMONIALS_HEADING}
        </h2>
        <div className="bg-white rounded-2xl p-6 sm:p-10 flex flex-col gap-6">
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
              /* Initials rather than a broken-image icon — the avatar is
                 optional in the admin form. */
              <span
                aria-hidden
                className="w-[46px] h-[46px] rounded-full bg-[#EEEEEE] grid place-items-center font-poppins font-semibold text-sm text-[#575757]"
              >
                {testimonialInitials(item.name)}
              </span>
            )}
            <div className="flex flex-col">
              <span className="font-poppins font-semibold text-sm leading-[1.52] text-[#141414]">
                {item.name}
              </span>
              {item.company && (
                <span className="font-poppins text-xs leading-[1.52] text-[#575757]">
                  {item.company}
                </span>
              )}
            </div>
          </div>
          {/* Quotation marks come from TestimonialQuote, not the stored
              content — the admin form says so explicitly, so an author
              can't end up with doubled quotes. */}
          <TestimonialQuote html={item.quote} className={BODY} />
        </div>
        {/* Hidden with a single story — two permanently disabled arrows read
            as broken rather than as a carousel. Matches SellOnlinePage's
            Testimonials section; see the longer note there. */}
        {total > 1 && (
          <div className="flex items-center justify-end gap-2">
            {(['left', 'right'] as const).map((dir) => {
              const disabled = dir === 'left' ? idx === 0 : idx >= total - 1;
              return (
                <button
                  key={dir}
                  type="button"
                  aria-label={dir === 'left' ? 'Previous story' : 'Next story'}
                  disabled={disabled}
                  onClick={() => setIdx((i) => (dir === 'left' ? Math.max(0, i - 1) : Math.min(total - 1, i + 1)))}
                  className="w-12 h-12 rounded-full bg-[#EEEEEE] grid place-items-center shadow-[0px_1px_2px_0px_rgba(0,0,0,0.06)] transition disabled:opacity-40 enabled:hover:bg-white"
                >
                  <span aria-hidden className="text-black text-xl leading-none">
                    {dir === 'left' ? '‹' : '›'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Video poster that opens the YouTube player in a 16:9 modal.
 *
 * Plays IN PLACE rather than opening youtube.com in a new tab, which is
 * what the old hard-coded card did — sending a seller who's mid-way
 * through an onboarding page off to a site full of other videos is a
 * poor way to end a conversion funnel.
 *
 * The iframe is mounted only once the modal opens, so YouTube's player
 * bundle (~1MB and a set of cookies) isn't loaded for the majority of
 * visitors who never press play. `youtube-nocookie.com` keeps it in
 * privacy-enhanced mode until then.
 */
function VideoCard({
  videoId,
  thumbnail,
  title,
}: {
  videoId: string;
  thumbnail?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);

  // Admin thumbnail if set, else YouTube's own poster for the id — so a
  // page with only the video id still renders a real image.
  const poster = thumbnail?.trim()
    ? imageUrl(thumbnail)
    : `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={title ? `Play video: ${title}` : 'Play video'}
        className="group w-full max-w-[1080px] block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
      >
        <div className="relative w-full aspect-video rounded-xl overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={poster}
            alt=""
            className="absolute inset-0 size-full object-cover"
            aria-hidden
          />
          <div aria-hidden className="absolute inset-0 bg-[rgba(18,19,22,0.25)] transition-colors group-hover:bg-[rgba(18,19,22,0.35)]" />
          {title && (
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 p-6 bg-gradient-to-b from-[rgba(0,0,0,0.7)] to-transparent text-left"
            >
              <div className="font-poppins font-semibold text-lg leading-[1.52] text-white">
                {title}
              </div>
              <div className="font-poppins text-sm leading-[1.52] text-[#CCCCCC]">
                {VIDEO.subtitle}
              </div>
            </div>
          )}
          <div className="absolute inset-0 grid place-items-center">
            <Image
              src="/images/seller-category/icon-play.svg"
              alt=""
              width={72}
              height={48}
              className="transition-transform group-hover:scale-110"
              aria-hidden
            />
          </div>
        </div>
      </button>

      {open && <VideoModal videoId={videoId} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * 16:9 YouTube modal — EXPORTED so both seller-category layouts play the
 * onboarding video the same way (in place, never navigating to youtube.com
 * mid-funnel). Mount it only when open: the iframe (and YouTube's ~1MB
 * player bundle + cookies) loads on first play, never for visitors who
 * don't press play. youtube-nocookie keeps it privacy-enhanced. Handles
 * Escape-to-close and locks page scroll while mounted.
 */
export function VideoModal({
  videoId,
  title,
  onClose,
}: {
  videoId: string;
  title?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // Stop the page scrolling behind the dialog.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Video'}
      onClick={onClose}
      className="fixed inset-0 z-[100] grid place-items-center bg-black/80 p-4"
    >
      {/* Stop clicks INSIDE the player from closing the dialog. */}
      <div
        className="relative w-full max-w-[1080px]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close video"
          className="absolute -top-11 right-0 grid size-9 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        {/* 16:9 — the standard YouTube frame. */}
        <div className="relative w-full aspect-video overflow-hidden rounded-xl bg-black">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
            title={title || 'Video'}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="absolute inset-0 size-full"
          />
        </div>
      </div>
    </div>
  );
}
