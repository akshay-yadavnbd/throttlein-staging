'use client';

/**
 * Seller-category landing page, LAYOUT 2 — template='seller-category-2'.
 * Figma node 4853:552 ("Sell Riding Jackets Online on ThrottleIn").
 *
 * Public URL: seller.throttlein.com/sell-online/<slug> — same prefix as
 * layout 1; the template only changes how the SAME data renders, so a
 * page can be switched between layouts in the admin without moving URL.
 *
 * Sections, top to bottom (header/footer come from app/seller/layout.tsx):
 *   1. Hero — CENTRED H1 + 2 paragraphs + black CTA, image below, stone bg
 *   2. Benefits — 5 icon ROWS in a 2-col grid (not cards), white
 *   3. "Expand Your … Business Online" — copy left, tall image right
 *   4. "Why Sell …" — interactive ACCORDION left, illustration right
 *   5. "Who Can Sell …" — image panel + white item cards grid
 *   6. Seller Success Stories — black band, carousel (shared with L1)
 *   7. Types — product-style cards with name + chevron footer
 *   8. Top Brands — square tiles, 6-up
 *   9. How to Register — vertical numbered timeline + inline video player
 *  10. Tips — check-circle rows, 2-col
 *  11. Closing CTA — photo + gradient (same treatment as L1)
 *  12. FAQ — per-page accordion
 *
 * DATA: identical `SellerCategoryData` to layout 1 — that is the point of
 * the template system: admins author one field set (SellerCategoryFields)
 * and pick a layout. Shared copy (benefits/why/steps/tips/closing) comes
 * from lib/sellerCategoryContent personalised via {category} tokens.
 *
 * Section chrome (BAND/H2), the testimonial band and tile links are
 * IMPORTED from SellerCategoryPage rather than redeclared — both layouts
 * come from the same Figma system and must not drift apart.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';
import FaqAccordion from '@/components/common/FaqAccordion';
import RichTextView from '@/components/common/RichTextView';
import { sellerUrl } from '@/lib/sellerUrl';
import { imageUrl } from '@/lib/api';
import { CTA_PRIMARY, CTA_PRIMARY_LG, CTA_SECONDARY, CTA_LIME, BODY } from '@/components/pages/SellOnlinePage';
import {
  BAND, H2, TileLink, SuccessStories, VideoModal,
  type SellerCategoryData, type CategoryTile,
} from '@/components/pages/SellerCategoryPage';
import {
  BENEFITS, BENEFITS_HEADING,
  WHY_HEADING, WHY_INTRO, WHY_CARDS,
  STEPS, STEPS_HEADING, STEPS_INTRO,
  VIDEO, TIPS, TIPS_HEADING, CLOSING,
  TYPES_HEADING, BRANDS_HEADING, ELIGIBILITY_HEADING, FAQ_HEADING,
  fillCategory,
} from '@/lib/sellerCategoryContent';

/**
 * Layout 2 renders eligibility as a GRID OF CARDS (one per audience:
 * manufacturers, distributors, …). Layout 1's editor stores that copy as
 * ONE rich-text block (`eligibilityBody`), so the items are recovered
 * from its <li> / <p> children; pages still carrying the deprecated
 * `eligibilityItems` array use it directly. Ordered by preference:
 * explicit items → parsed rich text → nothing (section hides).
 */
function eligibilityCards(data: SellerCategoryData): string[] {
  if (data.eligibilityItems && data.eligibilityItems.length) return data.eligibilityItems;
  const html = data.eligibilityBody || '';
  const li = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) =>
    m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
  );
  return li.filter(Boolean);
}

/** Lead line above the eligibility cards — first non-list paragraph of the
 *  rich text block, falling back to the legacy intro field. */
function eligibilityLead(data: SellerCategoryData): string {
  if (data.eligibilityIntro) return data.eligibilityIntro;
  const html = data.eligibilityBody || '';
  const p = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) =>
    m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
  );
  return p.find(Boolean) || '';
}

export default function SellerCategoryPage2({ data }: { data: SellerCategoryData }) {
  const long = data.nounPlural || data.noun || 'products';
  const short = data.noun || data.nounPlural || 'products';
  const t = (s: string) => fillCategory(s, long, short);

  const eligItems = eligibilityCards(data);
  const eligLead = eligibilityLead(data);

  return (
    <div className="bg-white">
      {/* ── 1. Hero — centred column, image below the CTA ───────────
        * Figma 5044-15723: SOLID #FAFBF8 fill edge to edge (sampled all
        * four corners of the node render — no gradient), Action-L CTA. */}
      <section className="bg-[#FAFBF8]">
        <div className="max-w-[1312px] mx-auto px-6 sm:px-10 py-16 lg:py-20 flex flex-col items-center gap-10">
          <div className="max-w-[800px] flex flex-col items-center gap-8 text-center">
            <div className="flex flex-col gap-3">
              <h1 className="font-poppins font-medium text-[36px] sm:text-[48px] lg:text-[64px] leading-[1.24] tracking-[-1.5px] lg:tracking-[-3px] text-black">
                {data.title}
              </h1>
              {data.heroBodyOne && <p className={BODY}>{data.heroBodyOne}</p>}
              {data.heroBodyTwo && <p className={BODY}>{data.heroBodyTwo}</p>}
            </div>
            <Link href={sellerUrl('/register')} className={CTA_PRIMARY_LG}>
              Start Selling
            </Link>
          </div>
          {data.heroImage && (
            <div className="relative w-full max-w-[496px] aspect-[496/464]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl(data.heroImage)}
                alt={t('{category} on ThrottleIn')}
                /* mix-blend-multiply: CMS product shots have baked-in white
                 * backgrounds; multiply maps white → the section's #FAFBF8
                 * so the product sits on the tint like the Figma (5044-15723),
                 * with no visible white box. */
                className="absolute inset-0 w-full h-full object-contain mix-blend-multiply"
              />
            </div>
          )}
        </div>
      </section>

      {/* ── 2. Benefits — icon ROWS, 2-col ────────────────────────── */}
      <section className="bg-white">
        <div className={BAND}>
          <h2 className={H2}>{BENEFITS_HEADING}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {BENEFITS.map((b) => (
              <div key={b.title} className="flex items-start gap-4">
                <span className="w-[60px] h-[60px] shrink-0 rounded-lg bg-[#F3F4F2] grid place-items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.icon} alt="" className="w-10 h-10" aria-hidden />
                </span>
                <div className="flex flex-col gap-2 min-w-0">
                  <h3 className="font-poppins font-semibold text-[18px] lg:text-[20px] leading-[1.52] text-black">
                    {b.title}
                  </h3>
                  <p className="font-poppins text-[16px] leading-[1.6] text-[#424242]">{t(b.body)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 3. Expand — copy left, tall image right ───────────────── */}
      {(data.expandHeading || data.expandBody) && (
        <section className="bg-[#FAFBF8]">
          <div className="max-w-[1312px] mx-auto px-6 sm:px-10 py-16 lg:py-24 flex flex-col lg:flex-row lg:items-center gap-10 lg:gap-[74px]">
            <div className="flex-1 min-w-0 lg:max-w-[560px] flex flex-col gap-4">
              {data.expandHeading && <h2 className={H2}>{data.expandHeading}</h2>}
              {data.expandBody && (
                <RichTextView
                  html={data.expandBody}
                  className="font-poppins text-[16px] leading-[1.6] text-[#424242] [&_p+p]:mt-3"
                />
              )}
            </div>
            {data.expandImage && (
              <div className="relative w-full lg:w-[596px] shrink-0 aspect-[596/528] rounded-2xl overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(data.expandImage)}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── 4. Why Sell — accordion + illustration ────────────────── */}
      <WhySell t={t} data={data} />

      {/* ── 5. Who Can Sell — dark banner + cards below (Figma 4853-678):
           full-width green-black banner (rounded-16, 400px tall on desktop)
           with the white heading + lead inside, a lime radial glow and a
           scrolling photo collage on the right; one centred white card per
           list item in a 3-col grid underneath. ── */}
      {(eligItems.length > 0 || data.eligibilityImage || (data.eligibilityImages || []).length > 0) && (
        <section className="bg-[#FAFBF8]">
          <div className={BAND}>
            <div className="relative w-full rounded-2xl overflow-hidden bg-[#0C1002] px-8 py-10 sm:p-10 min-h-[280px] lg:h-[400px] flex flex-col justify-center">
              {/* Lime radial glow centred behind the collage — colour
                  sampled from the Figma render (#90AD22 on #0C1002); the
                  Figma ellipse sits at ≈71% of the banner width. */}
              <div
                aria-hidden
                className="absolute inset-0 bg-[radial-gradient(ellipse_40%_85%_at_71%_50%,#90AD22_0%,rgba(144,173,34,0.4)_55%,transparent_80%)]"
              />
              <EligibilityCollage
                images={
                  (data.eligibilityImages && data.eligibilityImages.length
                    ? data.eligibilityImages
                    : data.eligibilityImage
                      ? [data.eligibilityImage]
                      : [])
                }
              />
              <div className="relative max-w-[600px] flex flex-col gap-4">
                <h2 className="font-poppins font-medium text-[28px] sm:text-[32px] lg:text-[40px] leading-[1.2] text-white">
                  {data.eligibilityHeading || t(ELIGIBILITY_HEADING)}
                </h2>
                {eligLead && (
                  <p className="font-poppins text-[16px] leading-[1.52] text-white">{eligLead}</p>
                )}
              </div>
            </div>
            {eligItems.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {eligItems.map((item) => (
                  <div
                    key={item}
                    className="bg-white border border-[#EEEEEE] rounded-2xl px-6 py-6 min-h-[75px] grid place-items-center text-center font-poppins text-[16px] lg:text-[18px] leading-[1.52] text-black"
                  >
                    {item}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── 6. Seller Success Stories — shared with layout 1 ──────── */}
      <SuccessStories items={data.testimonials} />

      {/* ── 7. Types — product-style cards ─────────────────────────── */}
      {data.types && data.types.length > 0 && (
        <section className="bg-white">
          <div className={BAND}>
            <h2 className={H2}>{t(TYPES_HEADING)}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {data.types.map((tile) => (
                <TileLink key={tile.name} tile={tile}>
                  <div className="rounded-xl border border-[#EEEEEE] overflow-hidden bg-white transition group-hover:border-[#bdbdbd] group-hover:shadow-md">
                    <div className="aspect-[309/349] bg-[#F3F4F2] p-3">
                      {tile.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imageUrl(tile.image)}
                          alt={tile.name}
                          className="w-full h-full object-cover rounded-lg"
                        />
                      ) : (
                        <div className="w-full h-full grid place-items-center font-poppins font-semibold text-[#9e9e9e]">
                          {tile.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 px-4 py-3">
                      <span className="font-poppins font-semibold text-[15px] text-[#141414] truncate">
                        {tile.name}
                      </span>
                      <span aria-hidden className="shrink-0 text-[#bdbdbd] transition-transform group-hover:translate-x-0.5 group-hover:text-[#141414]">
                        →
                      </span>
                    </div>
                  </div>
                </TileLink>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── 8. Top Brands — square tiles, 6-up ─────────────────────── */}
      {data.brands && data.brands.length > 0 && (
        <section className="bg-[#FAFBF8]">
          <div className={BAND}>
            <h2 className={H2}>{t(BRANDS_HEADING)}</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
              {data.brands.map((tile) => (
                <TileLink key={tile.name} tile={tile} prefix="/brands">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-full aspect-square rounded-xl bg-[#F3F4F2] grid place-items-center overflow-hidden p-4 transition group-hover:bg-[#ecEDe8]">
                      {tile.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imageUrl(tile.image)}
                          alt={tile.name}
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <span className="font-poppins font-bold text-[#9e9e9e]">
                          {tile.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="font-poppins text-[14px] text-[#141414] text-center truncate w-full">
                      {tile.name}
                    </span>
                  </div>
                </TileLink>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── 9. How to Register — steps SLIDER + video (Figma 4853-754,
           revised): centred heading + intro, then ONE stone card showing
           the active step (number/title/body left, framed image right)
           with a row of progress bars below — the active bar fills over
           4s then the next step slides in; clicking a bar jumps. ── */}
      <section className="bg-white">
        <div className={`${BAND} gap-[40px] lg:gap-[40px]`}>
          <div className="w-full flex flex-col gap-4 text-center">
            <h2 className={H2}>{data.stepsHeading || t(STEPS_HEADING)}</h2>
            <p className={BODY}>{data.stepsIntro || t(STEPS_INTRO)}</p>
          </div>

          <StepsSlider t={t} data={data} />

          <InlineVideo data={data} t={t} />
        </div>
      </section>

      {/* ── 10. Tips — check rows, 3-col (Figma 4853-828): LEFT-aligned
           40px heading, 24px grid gaps, 30px filled check, 20px semibold
           title with 4px gap to a 16px/1.6 #6B6B6B body. ── */}
      <section className="bg-[#FAFBF8]">
        <div className={BAND}>
          <h2 className={H2}>{t(TIPS_HEADING)}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {TIPS.map((tip) => (
              <div key={tip.title} className="flex items-start gap-2">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-[30px] h-[30px] shrink-0 text-[#141414]" aria-hidden>
                  <path fillRule="evenodd" clipRule="evenodd" d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm4.28-12.72a.75.75 0 0 0-1.06-1.06L11 12.44l-2.22-2.22a.75.75 0 1 0-1.06 1.06l2.75 2.75a.75.75 0 0 0 1.06 0l5.75-5.75z" />
                </svg>
                <div className="min-w-0">
                  <h3 className="font-poppins font-semibold text-[18px] lg:text-[20px] leading-[1.52] text-black">
                    {t(tip.title)}
                  </h3>
                  <p className="mt-1 font-poppins text-[16px] leading-[1.6] text-[#6B6B6B]">{t(tip.body)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 11. Closing CTA — photo + DIRECTIONAL gradient (Figma
           4853-916): the photo shows through on the left, the right two
           thirds fade to solid black behind the centred copy. Background
           photo is per-page (closingImage) with the shared static shot
           as fallback. ── */}
      <section className="relative overflow-hidden bg-black">
        {data.closingImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl(data.closingImage)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            aria-hidden
          />
        ) : (
          <Image
            src={CLOSING.background}
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
            aria-hidden
          />
        )}
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(270deg,#000_34.55%,rgba(0,0,0,0.7)_65.56%,rgba(0,0,0,0.56)_84.9%,rgba(0,0,0,0.22)_97%,rgba(0,0,0,0)_100%)]"
        />
        <div className="relative max-w-[900px] mx-auto px-6 sm:px-10 py-16 lg:py-20 flex flex-col items-center gap-8 lg:gap-10 text-center">
          <div className="flex flex-col gap-3">
            <h2 className="font-poppins font-medium text-[28px] lg:text-[40px] leading-[1.2] text-white">
              {t(CLOSING.heading)}
            </h2>
            <p className="font-poppins text-[16px] lg:text-[18px] leading-[1.52] text-white">
              {t(CLOSING.body)}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href={sellerUrl('/register')} className={CTA_LIME}>
              {t(CLOSING.primary)}
            </Link>
            {/* CTA_SECONDARY is white-filled; on this dark photo band it
                needs the outline treatment or the label vanishes
                white-on-white (caught live). */}
            <Link
              href={sellerUrl('/login')}
              className={`${CTA_SECONDARY} !bg-transparent !text-white !border !border-white/60 hover:!bg-white/10`}
            >
              {t(CLOSING.secondary)}
            </Link>
          </div>
        </div>
      </section>

      {/* ── 12. FAQ ────────────────────────────────────────────────── */}
      {data.faq && data.faq.length > 0 && (
        <section className="bg-white">
          <div className="max-w-[1000px] mx-auto px-6 sm:px-10 py-16 lg:py-20 flex flex-col gap-10 items-center">
            <div className="flex flex-col items-center gap-4">
              <span className="bg-[#D4FA00] rounded px-2 py-1 font-poppins font-semibold text-[14px] tracking-[1px] text-black">
                FAQ
              </span>
              <h2 className="font-poppins font-semibold text-[24px] lg:text-[28px] leading-[1.52] text-[#141414] text-center">
                {FAQ_HEADING}
              </h2>
            </div>
            {/* FaqAccordion's contract is {q, a}; the CMS stores the
                fuller {question, answer} — same mapping layout 1 does.
                Passing the CMS shape directly rendered EMPTY accordion
                rows (caught live). */}
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
    </div>
  );
}

/* ── Why Sell — auto-advancing slider (Figma 5044-11289) ──────────────
   One slide per WHY_CARDS entry. The active row shows its paragraph and
   a 3px scrubber whose fill grows top-to-bottom over WHY_SLIDE_MS; when
   it reaches the bottom the next slide opens (wrapping). Clicking any
   title jumps straight to that slide and re-arms a full timer. Each
   slide swaps the illustration on the right (crossfade).

   prefers-reduced-motion: the auto-advance and the fill animation are
   both disabled — the section degrades to the click-only accordion. */
const WHY_SLIDE_MS = 4000;

/** One slide: CMS-authored (title/body/uploaded image) or a static
 *  fallback entry from WHY_CARDS (which carries an icon instead). */
type WhySlide = { title: string; body: string; image?: string; icon?: string };

function WhySell({ t, data }: { t: (s: string) => string; data: SellerCategoryData }) {
  // CMS-first: any admin-authored cards replace the ENTIRE built-in set
  // (mixing the two would make slide order unpredictable for editors).
  // Heading and intro fall back independently, so an admin can retitle
  // the section without re-authoring six slides.
  const cms = (data.whyCards || []).filter((c) => c && c.title);
  const slides: WhySlide[] = cms.length
    ? cms.map((c) => ({ title: c.title, body: c.body || '', image: c.image || '' }))
    : WHY_CARDS.map((c, i) => ({
        title: c.title,
        body: c.body,
        icon: c.icon,
        // "-2" file — the asset was re-cropped (padding trimmed); a NEW
        // filename busts Next's image-optimizer cache and browser caches,
        // which both kept serving the old padded 720×540 render. (A ?v=
        // query can't be used: next/Image rejects query strings on local
        // src paths at render time.)
        image: i === 0 ? '/images/seller-category/why-illustration-2.webp' : '',
      }));
  const heading = data.whyHeading || WHY_HEADING;
  const intro = data.whyIntro || WHY_INTRO;

  const [active, setActive] = useState(0);
  const reduceMotion = useReducedMotion();

  // One timeout per active slide (not an interval) so a manual click and
  // an auto-advance both get exactly WHY_SLIDE_MS before the next move —
  // the cleanup cancels the pending timer whenever `active` changes.
  useEffect(() => {
    if (reduceMotion || slides.length < 2) return undefined;
    const id = setTimeout(
      () => setActive((a) => (a + 1) % slides.length),
      WHY_SLIDE_MS,
    );
    return () => clearTimeout(id);
  }, [active, reduceMotion, slides.length]);

  /* ── Layout-shift guard ──
     Slide paragraphs differ in height, so animating each open row to its
     OWN height changed the section's total height every 4s and made the
     whole page bob. Instead, an invisible replica of every paragraph is
     measured at the real column width (re-measured on resize) and every
     open row expands to the TALLEST one — the section height is constant,
     so the auto-advance can't move the rest of the page. */
  const measureRef = useRef<HTMLDivElement>(null);
  const [maxBodyH, setMaxBodyH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return undefined;
    const measure = () => {
      const h = Math.max(0, ...[...el.children].map((c) => (c as HTMLElement).offsetHeight));
      setMaxBodyH(h > 0 ? h : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [slides.length]);

  return (
    <section className="bg-white">
      {/* Scoped keyframes for the scrubber fill — the fill element is
          remounted (key) on every slide change so the animation restarts
          from 0 even when the same row is re-selected later. */}
      <style>{'@keyframes scp2-why-fill { from { height: 0% } to { height: 100% } }'}</style>
      {/* Column split per Figma 5044-11289: 1232 = 596 copy + 80 gap +
          556 illustration column (image box 356×335 centred inside). */}
      <div className="max-w-[1312px] mx-auto px-6 sm:px-10 py-16 lg:py-24 flex flex-col lg:flex-row lg:items-center gap-10 lg:gap-[80px]">
        <div className="min-w-0 lg:w-[596px] lg:shrink-0 flex flex-col gap-10">
          <div className="flex flex-col gap-4">
            <h2 className={H2}>{t(heading)}</h2>
            <p className={BODY}>{t(intro)}</p>
          </div>
          <div className="relative flex flex-col">
            {/* Invisible replica of every paragraph at the true column
                width (19px = scrubber 3px + gap 16px) — see maxBodyH. */}
            <div
              ref={measureRef}
              aria-hidden
              className="absolute invisible pointer-events-none left-[19px] right-0 top-0"
            >
              {slides.map((card, i) => (
                <span
                  key={`m-${card.title}-${i}`}
                  className="block font-poppins text-[16px] leading-[1.6]"
                >
                  {t(card.body)}
                </span>
              ))}
            </div>
            {slides.map((card, i) => {
              const open = i === active;
              return (
                <button
                  key={`${card.title}-${i}`}
                  type="button"
                  onClick={() => setActive(i)}
                  aria-expanded={open}
                  className="relative flex border-b border-[#E0E0E0] py-4 text-left"
                >
                  {/* Scrubber — ABSOLUTE, so its 41px track can't set a
                      row-height floor: rows size purely from their text,
                      which keeps the open/close height swap perfectly
                      symmetric (no transient section-height wobble). */}
                  <span
                    aria-hidden
                    className={`absolute left-0 top-4 w-[3px] h-[41px] rounded-full overflow-hidden bg-black/25 ${open ? '' : 'opacity-0'}`}
                  >
                    {open && (
                      <span
                        key={`fill-${active}`}
                        className="block w-full rounded-full bg-black"
                        style={
                          reduceMotion
                            ? { height: '100%' }
                            : { animation: `scp2-why-fill ${WHY_SLIDE_MS}ms linear forwards` }
                        }
                      />
                    )}
                  </span>
                  <span className="flex-1 min-w-0 pl-[19px]">
                    {/* Line-height is pinned to the OPEN size so the
                        18↔20px weight/size change can't nudge the row. */}
                    <span
                      className={`block font-poppins leading-[27.4px] lg:leading-[30.4px] transition-[font-size,color] duration-300 ${
                        open
                          ? 'font-semibold text-[18px] lg:text-[20px] text-black'
                          : 'text-[16px] lg:text-[18px] text-[#141414]'
                      }`}
                    >
                      {t(card.title)}
                    </span>
                    {/* Paragraph stays mounted and every row expands to the
                        TALLEST paragraph's height (maxBodyH), so the section
                        height never changes as slides advance — no page
                        shake. Falls back to auto height pre-measurement. */}
                    <span
                      className="block overflow-hidden transition-[height,opacity] duration-500 ease-in-out motion-reduce:transition-none"
                      style={{
                        height: open ? (maxBodyH != null ? maxBodyH + 8 : undefined) : 0,
                        opacity: open ? 1 : 0,
                      }}
                    >
                      <span className="mt-2 block font-poppins text-[16px] leading-[1.6] text-[#424242]">
                        {t(card.body)}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {/* Illustration panel — one layer per slide, crossfaded.
            Priority per slide: admin-uploaded image → local static asset
            (built-in slide 1) → the hub-and-spoke illustration recreated
            in the design's visual language, using the slide's icon (or a
            cycled built-in icon for CMS slides, which have none). */}
        <div className="flex-1 min-w-0 flex items-center justify-center">
          <div className="relative w-full max-w-[356px] aspect-[356/335]">
          {slides.map((card, i) => (
            <div
              key={`${card.title}-${i}`}
              aria-hidden
              className={`absolute inset-0 transition-opacity duration-500 ${i === active ? 'opacity-100' : 'opacity-0'}`}
            >
              {card.image ? (
                card.image.startsWith('/images/') ? (
                  <Image src={card.image} alt="" fill sizes="356px" className="object-contain" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl(card.image)}
                    alt=""
                    className="absolute inset-0 w-full h-full object-contain"
                  />
                )
              ) : (
                <WhyIllustration icon={card.icon || WHY_CARDS[i % WHY_CARDS.length].icon} />
              )}
            </div>
          ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── "How to register" steps slider (Figma 4853-754, revised) ─────────
   ONE stone card (rounded-24, p-32) shows the active step: number, title
   and body on the left (2/5, vertically centred), the step image on a
   white rounded frame right (3/5, aspect 720/520). Below, one progress
   bar per step: the active bar FILLS over STEP_SLIDE_MS, then the next
   step fades in (wrapping); clicking any bar jumps to that step and
   re-arms a full timer. CMS-first with the shared STEPS as fallback —
   a CMS step without its own image borrows the built-in illustration
   at the same position, so seeded pages stay visually complete.

   Layout-shift guard: the text column's minHeight is the TALLEST step's
   text (measured from an invisible replica, re-measured on resize), so
   auto-advance can't change the card height — no page shake, on any
   breakpoint. prefers-reduced-motion disables the timer and the fill. */
const STEP_SLIDE_MS = 4000;

function StepsSlider({ t, data }: { t: (s: string) => string; data: SellerCategoryData }) {
  const cms = (data.steps || []).filter((s) => s && s.title);
  const steps = cms.length
    ? cms.map((s, i) => ({
        title: s.title,
        body: s.body || '',
        image: s.image || (STEPS[i] ? STEPS[i].image : '') || '',
      }))
    : STEPS.map((s) => ({ title: s.title, body: s.body, image: s.image || '' }));

  const [active, setActive] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion || steps.length < 2) return undefined;
    const id = setTimeout(() => setActive((a) => (a + 1) % steps.length), STEP_SLIDE_MS);
    return () => clearTimeout(id);
  }, [active, reduceMotion, steps.length]);

  const measureRef = useRef<HTMLDivElement>(null);
  const [textMinH, setTextMinH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return undefined;
    const measure = () => {
      const h = Math.max(0, ...[...el.children].map((c) => (c as HTMLElement).offsetHeight));
      setTextMinH(h > 0 ? h : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [steps.length]);

  const step = steps[active];

  const textBlock = (s: { title: string; body: string }, i: number) => (
    <>
      <span className="block font-poppins font-semibold text-[16px] leading-[1.32] text-[#424242]">
        {String(i + 1).padStart(2, '0')}
      </span>
      <span className="mt-4 flex flex-col gap-2">
        <span className="block font-poppins font-semibold text-[20px] lg:text-[24px] leading-[1.52] text-black">
          {t(s.title)}
        </span>
        {s.body && (
          <span className="block font-poppins text-[16px] leading-[1.52] text-[#424242]">
            {t(s.body)}
          </span>
        )}
      </span>
    </>
  );

  return (
    <div className="w-full flex flex-col items-center gap-10">
      <style>{`
        @keyframes scp2-step-fill { from { width: 0% } to { width: 100% } }
        @keyframes scp2-step-fade { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
      <div className="w-full bg-[#F3F4F2] rounded-3xl p-6 sm:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-0 lg:items-center relative">
          {/* Invisible replica of every step's text at the real column
              width — see textMinH above. */}
          <div
            ref={measureRef}
            aria-hidden
            className="absolute invisible pointer-events-none inset-x-0 top-0 lg:right-[60%] lg:pr-8"
          >
            {steps.map((s, i) => (
              <div key={`m-${s.title}-${i}`}>{textBlock(s, i)}</div>
            ))}
          </div>
          <div
            key={`txt-${active}`}
            className="lg:col-span-2 lg:pr-8 motion-safe:[animation:scp2-step-fade_450ms_ease-out]"
            style={textMinH != null ? { minHeight: textMinH } : undefined}
          >
            {textBlock(step, active)}
          </div>
          <div className="lg:col-span-3 relative w-full aspect-[720/520] bg-white rounded-3xl overflow-hidden">
            {steps.map((s, i) => (
              <div
                key={`img-${s.title}-${i}`}
                aria-hidden={i !== active}
                className={`absolute inset-2 transition-opacity duration-500 ${i === active ? 'opacity-100' : 'opacity-0'}`}
              >
                {s.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.image.startsWith('/images/') ? s.image : imageUrl(s.image)}
                    alt=""
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center font-poppins font-semibold text-[64px] text-[#E0E0E0]">
                    {String(i + 1).padStart(2, '0')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Progress bars — one per step; active fills over STEP_SLIDE_MS.
          Each button is taller than the 4px bar for a usable hit area. */}
      <div className="w-full max-w-[802px] px-2 flex items-center gap-3 sm:gap-6" role="tablist" aria-label="Registration steps">
        {steps.map((s, i) => (
          <button
            key={`bar-${s.title}-${i}`}
            type="button"
            onClick={() => setActive(i)}
            aria-label={`Step ${i + 1}: ${t(s.title)}`}
            aria-current={i === active}
            className="flex-1 py-2 group"
          >
            <span className="block h-[4px] rounded-xl bg-black/25 overflow-hidden transition-colors group-hover:bg-black/40">
              {i === active && (
                <span
                  key={`fill-${active}`}
                  className="block h-full rounded-xl bg-black"
                  style={
                    reduceMotion
                      ? { width: '100%' }
                      : { animation: `scp2-step-fill ${STEP_SLIDE_MS}ms linear forwards` }
                  }
                />
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── "Who can sell" banner photos — per the Figma design (4853-678) ───
   TWO square photos, diagonally offset and overlapping: the first sits
   top-left of the pair, the second bottom-right and IN FRONT, both
   fully inside the banner (≈220px tiles, ≈40px off the top/bottom
   edges, ≈136px in from the banner's right at full width — measured
   from the design). Only the first two CMS photos are shown; a single
   photo renders alone. Hidden below md — on phones the glow alone
   keeps the banner composed. */
function EligibilityCollage({ images }: { images: string[] }) {
  const clean = images.filter(Boolean);
  if (!clean.length) return null;
  const [first, second] = clean;
  const TILE =
    'absolute aspect-square w-[170px] lg:w-[220px] rounded-[11px] border-2 border-white overflow-hidden bg-[#d9d9d9]';
  return (
    <div
      aria-hidden
      className="hidden md:block absolute inset-y-[30px] lg:inset-y-[38px] right-8 lg:right-[136px] w-[290px] lg:w-[378px]"
    >
      <div className={`${TILE} top-0 left-0`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl(first)} alt="" className="w-full h-full object-cover" />
      </div>
      {second && (
        <div className={`${TILE} bottom-0 right-0 z-10`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl(second)} alt="" className="w-full h-full object-cover" />
        </div>
      )}
    </div>
  );
}

/* Hub-and-spoke illustration matching the style of the slide-1 asset:
   soft radial wash, dashed cross spokes, lime centre circle with the
   slide's icon, four white satellite circles echoing it. */
function WhyIllustration({ icon }: { icon: string }) {
  const satellites = [
    'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2',
    'left-full top-1/2 -translate-x-1/2 -translate-y-1/2',
    'left-1/2 top-full -translate-x-1/2 -translate-y-1/2',
    'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2',
  ];
  return (
    /* Sized to match the slide-1 Figma export: the hub + satellites span
       nearly the whole 356×335 image box (orbit ≈ 85% of it), centre
       circle ≈ 124px with a 96px lime core, satellites ≈ 56px. The old
       210px canvas made these slides read visibly smaller than slide 1. */
    <div className="w-full h-full grid place-items-center bg-[radial-gradient(closest-side,#F3F4F2_60%,rgba(243,244,242,0))]">
      <div className="relative w-[82%] h-[80%]">
        <span aria-hidden className="absolute left-1/2 top-0 bottom-0 -translate-x-1/2 border-l border-dashed border-black/60" />
        <span aria-hidden className="absolute top-1/2 left-0 right-0 -translate-y-1/2 border-t border-dashed border-black/60" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[124px] h-[124px] rounded-full bg-white border border-black grid place-items-center">
          <div className="w-[96px] h-[96px] rounded-full bg-[#D3FF33] grid place-items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={icon} alt="" className="w-11 h-11" />
          </div>
        </div>
        {satellites.map((pos) => (
          <div
            key={pos}
            className={`absolute ${pos} w-[56px] h-[56px] rounded-full bg-white border border-black grid place-items-center`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={icon} alt="" className="w-6 h-6" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── YouTube player frame ─────────────────────────────────────────────
   The design draws a real player: dark frame, title overlay at top,
   centred play button, "Watch on YouTube" chip. Clicking opens the SAME
   16:9 modal as Template 1 (shared VideoModal) — playing in a popup, not
   swapped inline — so both layouts behave identically. Renders nothing
   without a videoId, same rule as layout 1 — no inert play buttons. */
function InlineVideo({ data, t }: { data: SellerCategoryData; t: (s: string) => string }) {
  const [playing, setPlaying] = useState(false);
  if (!data.videoId) return null;
  const heading = data.videoHeading || t(VIDEO.heading);
  const thumb = data.videoThumbnail
    ? imageUrl(data.videoThumbnail)
    : `https://i.ytimg.com/vi/${data.videoId}/maxresdefault.jpg`;

  return (
    <div className="w-full max-w-[1080px] mx-auto flex flex-col gap-6">
      <h3 className="font-poppins font-semibold text-[20px] lg:text-[24px] leading-[1.52] text-black text-center">
        {heading}
      </h3>
      <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
        {playing && (
          <VideoModal videoId={data.videoId} title={heading} onClose={() => setPlaying(false)} />
        )}
        {
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={`Play: ${heading}`}
            className="group absolute inset-0 w-full h-full text-left"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <span aria-hidden className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/70 to-transparent" />
            <span className="absolute top-4 left-5 right-5 flex flex-col gap-0.5">
              <span className="font-poppins font-semibold text-[15px] text-white truncate">{heading}</span>
              <span className="font-poppins text-[12px] text-white/80">
                {VIDEO.subtitle}
              </span>
            </span>
            {/* YouTube-red play pill, centred */}
            <span
              aria-hidden
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[72px] h-[48px] rounded-[12px] bg-[#f00] grid place-items-center transition-transform group-hover:scale-105"
            >
              <span className="ml-0.5 border-y-[10px] border-y-transparent border-l-[16px] border-l-white" />
            </span>
            <span
              aria-hidden
              className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-[rgba(18,19,22,0.9)] px-4 py-2 font-poppins text-[13px] text-white"
            >
              Watch on <span className="font-semibold">YouTube</span>
            </span>
          </button>
        }
      </div>
    </div>
  );
}
