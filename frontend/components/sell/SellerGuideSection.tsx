'use client';

/**
 * SellerGuideSection — admin-managed cards rendered AFTER the
 * "Ready to open your shop?" CTA banner on /sell.
 *
 * Fetches:
 *   GET /api/seller-guides?active=1   — the cards
 *   GET /api/seller-guide-section?active=1  — heading + subheading
 *
 * Card design mirrors BlogIndexPage's PostCard but without a category
 * badge — title + short description + "Read →" link. Clicking a card
 * navigates to /seller/guide/<slug>.
 *
 * Responsive grid: 1 col mobile → 2 tablet → 4 desktop.
 *
 * Client component because SellPage is `'use client'` itself; we
 * fetch on mount with `useEffect` and render nothing when the
 * section is toggled off or the active list is empty.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { api, imageUrl, envelopeOrLegacy } from '@/lib/api';

type Guide = {
  _id: string;
  title: string;
  slug: string;
  shortDescription?: string;
  image?: string;
  order: number;
  isActive: boolean;
};

type Section = {
  heading: string;
  subheading?: string;
  isActive: boolean;
};

export default function SellerGuideSection() {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [section, setSection] = useState<Section | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [guidesRes, sectionRes] = await Promise.all([
          api.get('/seller-guides', { params: { active: 1 } }).then(envelopeOrLegacy),
          api.get('/seller-guide-section', { params: { active: 1 } }).then(envelopeOrLegacy),
        ]);
        if (!mounted) return;
        setGuides(Array.isArray(guidesRes.data?.items) ? guidesRes.data.items : []);
        setSection(sectionRes.data?.section || null);
      } catch {
        // Silent — the section just doesn't render when fetch fails.
      } finally {
        if (mounted) setLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Don't render anything until we've fetched — avoids a flash of
  // empty heading on slow networks. Also short-circuits when there
  // are no active cards or the section was toggled off in admin.
  if (!loaded) return null;
  if (!section) return null;
  if (guides.length === 0) return null;

  return (
    <section className="bg-white py-16 md:py-20">
      <div className="container">
        <div className='max-w-[1232px] mx-auto flex flex-col gap-10'>
          <div className="flex flex-col items-center text-center gap-3">
            <h2 className="text-[28px] md:text-[32px] tracking-[-1px] font-semibold text-[#141414] leading-[1.52]">
              {section.heading || "Your seller's playbook"}
            </h2>
            {section.subheading && (
              <p className="text-base md:text-lg text-[#575757] leading-[1.52] max-w-[680px]">
                {section.subheading}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {guides.map((g) => (
              <GuideCard key={g._id} guide={g} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function GuideCard({ guide }: { guide: Guide }) {
  return (
    <Link
      href={`/seller/guide/${encodeURIComponent(guide.slug)}`}
      className="group block rounded-2xl overflow-hidden border p-2 border-[#eee] hover:bg-white hover:shadow-[0_4px_8px_-2px_rgba(0,0,0,0.12)] hover:border-[#E0E0E0] transition"
    >
      <div className="relative aspect-[384/310] bg-default-100 overflow-hidden rounded-2xl">
        {guide.image ? (
          <Image
            src={imageUrl(guide.image)}
            alt={guide.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px"
            className="object-cover group-hover:scale-[1.02] transition-transform duration-500"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-default-400 text-sm">
            No image
          </div>
        )}
      </div>
      <div className="p-3 pt-6 pb-2">

        <h3 className="text-base md:text-lg font-semibold text-[#000] leading-snug line-clamp-2 leading-[1.52]">
          {guide.title}
        </h3>
        {guide.shortDescription && (
          <p className="mt-2 line-clamp-3 text-sm text-default-600 leading-relaxed">
            {guide.shortDescription}
          </p>
        )}
      </div>
    </Link>
    // <Link
    //   href={`/seller/guide/${encodeURIComponent(guide.slug)}`}
    //   className="group flex flex-col rounded-2xl overflow-hidden border border-[#eee] bg-white hover:shadow-lg hover:border-default-300 transition"
    // >
    //   <div className="relative aspect-[4/3] bg-default-100">
    //     {guide.image ? (
    //       <Image
    //         src={imageUrl(guide.image)}
    //         alt={guide.title}
    //         fill
    //         sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 320px"
    //         className="object-cover group-hover:scale-[1.02] transition-transform duration-500"
    //       />
    //     ) : (
    //       <div className="absolute inset-0 grid place-items-center text-default-400 text-sm">
    //         No image
    //       </div>
    //     )}
    //   </div>
    //   <div className="p-4 md:p-5 flex-1 flex flex-col">
    //     <h3 className="text-lg font-semibold text-[#141414] leading-snug line-clamp-2">
    //       {guide.title}
    //     </h3>
    //     {guide.shortDescription && (
    //       <p className="mt-2 line-clamp-3 text-sm text-default-600 leading-relaxed">
    //         {guide.shortDescription}
    //       </p>
    //     )}
    //     <div className="mt-4 pt-3 border-t border-default-100 inline-flex items-center gap-1 text-sm font-semibold text-[#141414]">
    //       Read
    //       <span aria-hidden>&rarr;</span>
    //     </div>
    //   </div>
    // </Link>
  );
}
