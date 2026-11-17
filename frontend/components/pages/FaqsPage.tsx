'use client';

/**
 * FAQs page — `/faqs`
 *
 * Built from Figma node 2686:950. Layout:
 *   1. Breadcrumb (Home / FAQ)
 *   2. Dark rounded hero banner with title + tagline + decorative
 *      question-mark mosaic on the right
 *   3. Two-column body:
 *      - LEFT: 7 FAQ sections, each with collapsible accordion cards
 *        (one open by default; toggling another closes the first)
 *      - RIGHT: sticky "Still have questions?" contact card with mailto
 *
 * Header (Navbar) + Footer come from the root layout, so this file
 * only renders the body sections. Marked 'use client' for the
 * accordion state — metadata is exported from the server-side
 * wrapper at app/faqs/page.tsx so SEO + admin overrides still work.
 *
 * Each FAQ carries a stable `id` (section + question slug) so the
 * accordion remembers which item is open across re-renders without
 * needing an array-index hack.
 */

import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import Breadcrumbs from '@/components/common/Breadcrumbs';

type FaqItem = { _id: string; question: string; answer: string };
type FaqSection = { _id: string; title: string; faqs: FaqItem[] };


export default function FaqsPage({ sections = [] }: { sections?: FaqSection[] }) {
  // First FAQ on the page is open by default — matches the Figma comp
  // where "What is ThrottleIn?" is shown expanded with its answer.
  const firstId = useMemo(() => {
    const s0 = sections[0];
    const f0 = s0?.faqs?.[0];
    return f0?._id ? `${s0._id}:${f0._id}` : null;
  }, [sections]);
  const [openId, setOpenId] = useState<string | null>(firstId);

  function toggle(id: string) {
    setOpenId((cur) => (cur === id ? null : id));
  }

  // Section-level accordion — collapses/expands an entire section's FAQ
  // list (separate from `openId`, which tracks the individual open Q&A
  // within whichever section is expanded). First section starts open,
  // matching the Figma comp where "About ThrottleIn" is shown expanded
  // and the rest are collapsed to just their title + chevron.
  const [openSectionId, setOpenSectionId] = useState<string | null>(
    sections[0]?._id ?? null,
  );
  function toggleSection(id: string) {
    setOpenSectionId((cur) => (cur === id ? null : id));
  }

  return (
    <div className="bg-white text-[#141414]">
      {/* ─── Breadcrumb — shared strip, matches the products page ─── */}
      <Breadcrumbs items={[{ label: 'FAQ' }]} />

      {/* ─── Hero banner ─────────────────────────────────────── */}
      <section className="container py-12 d:py-16">
        {/* Banner background per Figma spec:
              - borderRadius: 24px
              - background: gradient (black -> transparent left-to-right)
                stacked over a solid #0D0D0D base. The gradient keeps the
                left half jet-black behind the headline, then fades to
                expose the base colour on the right where the
                question-mark graphic lives. */}
        <div
          className="relative w-full overflow-hidden flex items-center lg:h-[273px]"
          style={{
            borderRadius: '16px',
            background:
              'linear-gradient(90deg, #000 25.63%, rgba(0, 0, 0, 0.70) 48.64%, rgba(0, 0, 0, 0.56) 62.99%, rgba(0, 0, 0, 0.22) 71.99%, rgba(0, 0, 0, 0.00) 74.19%), #0D0D0D',
          }}
        >
          {/* Decorative question-mark stack — top-right.
              Static SVG asset at /public/faqs/hero-questionmark-image.svg.
              Hidden below md because the tilted graphic crowds the
              headline on narrow screens. Plain <img> (not next/image)
              because Next's optimizer skips SVGs anyway. */}
          <div
            aria-hidden
            className="hidden md:block absolute top-0 right-0 h-full w-[42%] pointer-events-none"
          >
            <div className="relative w-full h-full overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/faqs/hero-questionmark-image.svg"
                alt=""
                className="absolute inset-y-0 right-0 h-full max-w-none object-contain object-right"
              />
            </div>
          </div>
          <div className="relative px-6 sm:px-10 md:px-14 py-16 md:py-[120px] lg:py-0 max-w-[680px]">
            <h1 className="font-medium text-white text-4xl md:text-5xl leading-[1.38] tracking-[-1.2px] md:tracking-[-1.8px]">
              FAQ
            </h1>
            <p className="mt-5 text-base md:text-xl leading-[1.52] text-white/68">
              Find answers to common questions about shopping, selling, orders,
              returns, and everything ThrottleIn.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Body: sections + sticky sidebar ─────────────────── */}
      <section className="container pb-20 md:pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_386px] gap-6 lg:gap-10 items-start">
          {/* LEFT — accordion stack */}
          <div className="space-y-6 min-w-0">
            {sections.length === 0 && (
              <p className="text-base text-[#6b6b6b]">
                No FAQs yet. Check back soon.
              </p>
            )}
            {sections.map((section, sectionIdx) => {
              const sectionOpen = openSectionId === section._id;
              return (
                <div
                  key={section._id}
                  className={[
                    'space-y-6',
                    sectionIdx > 0 ? 'pt-6 border-t border-[#eee]' : '',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    onClick={() => toggleSection(section._id)}
                    aria-expanded={sectionOpen}
                    aria-controls={`${section._id}-section-panel`}
                    className="w-full flex items-center justify-between gap-4 text-left"
                  >
                    <h2 className="font-semibold text-lg md:text-xl leading-[1.52] text-[#141414]">
                      {section.title}
                    </h2>
                    <span
                      aria-hidden
                      className={`shrink-0 w-6 h-6 grid place-items-center text-[#212121] transition-transform duration-200 ${sectionOpen ? 'rotate-180' : ''}`}
                    >
                      <ChevronDownIcon />
                    </span>
                  </button>
                  {sectionOpen && (
                    <div id={`${section._id}-section-panel`} className="space-y-4">
                      {section.faqs.map((faq) => {
                        const id = `${section._id}:${faq._id}`;
                        const open = openId === id;
                        return (
                          <article
                            key={id}
                            className={[
                              'rounded-xl border border-[#eee] overflow-hidden transition-colors',
                              open ? 'bg-[#EEE]' : 'bg-white hover:bg-[#F5F5F5]',
                            ].join(' ')}
                          >
                            <button
                              type="button"
                              onClick={() => toggle(id)}
                              aria-expanded={open}
                              aria-controls={`${id}-panel`}
                              className="w-full flex items-center justify-between gap-4 p-4 sm:px-6 sm:py-4 text-left"
                            >
                              <span className="text-base leading-[1.52] text-black font-semibold">
                                {faq.question}
                              </span>
                              <span
                                aria-hidden
                                className="shrink-0 w-6 h-6 grid place-items-center text-[#141414]"
                              >
                                {open ? <CrossIcon /> : <PlusIcon />}
                              </span>
                            </button>
                            {open && (
                              <div
                                id={`${id}-panel`}
                                role="region"
                                className="p-4 pt-0 sm:px-6 sm:pb-4 -mt-1"
                              >
                                {/* answer is admin-authored HTML (TipTap) —
                                rendered with prose styling to inherit
                                the page's text colour + line-height. */}
                                <div
                                  className="text-sm text-[#575757] leading-[1.52] [&_a]:underline [&_a]:underline-offset-2 [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold"
                                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(faq.answer) }}
                                />
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* RIGHT — sticky contact card */}
          <aside className="lg:sticky lg:top-24 self-start w-full">
            <div className="rounded-2xl border border-[#eee] p-6 space-y-4 bg-white">
              <ChatBubbleIcon />
              <h3 className="font-semibold text-lg md:text-xl leading-[1.52] text-black">
                Still have questions?
              </h3>
              <p className="text-base text-[#424242] leading-[1.52]">
                Contact our support team anytime at{' '}
                <a
                  href="mailto:info@throttlein.com"
                  className="underline underline-offset-2 text-[#141414] hover:text-black/70 transition"
                >
                  info@throttlein.com
                </a>
                {' '}or start a chat — we&apos;re happy to help!
              </p>
              <Link
                href="mailto:info@throttlein.com"
                className="inline-flex w-full h-10 items-center justify-center px-4 py-3 border border-[#BDBDBD] rounded-lg bg-white text-[#212121] text-sm font-medium hover:bg-[#F5F5F5] transition active:bg-[#EEE] active:shadow-[inset_0_2px_2px_0_rgba(0,0,0,0.22),inset_1px_0_1px_0_rgba(0,0,0,0.22),inset_-1px_0_1px_0_rgba(0,0,0,0.22)]"
              >
                Contact us
              </Link>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

/* ─────── Icons ─────── */

function ChevronDownIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 9L12 15L18 9" stroke="#212121" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 5V19M5 12H19" stroke="#212121" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M5 12H19" stroke="#212121" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChatBubbleIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
      <path d="M10.0928 18.3767H27.178M10.0928 14.0315H19.9997M7.72306 29.7663C5.2656 29.7663 3.27344 27.7742 3.27344 25.3167L3.27344 8.0726C3.27344 5.61515 5.2656 3.62299 7.72306 3.62299H32.2763C34.7338 3.62299 36.726 5.61515 36.726 8.0726L36.726 25.3167C36.726 27.7742 34.7338 29.7663 32.2763 29.7663H22.9422V36.377L16.8039 29.7663H7.72306Z" stroke="black" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

