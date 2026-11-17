import { sanitizeHtml } from '@/lib/sanitizeHtml';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { buildStaticPageMetadata } from '@/lib/staticMeta';
import JsonLd from '@/components/seo/JsonLd';
import { aboutPageSchema } from '@/lib/jsonLd';

/**
 * About Us — /about
 *
 * Sections (top to bottom, matching Figma design node 2686:4114):
 *   1. Hero — dark rider photo + lime-highlighted headline
 *   2. Intro paragraph on solid black (bleeds from hero)
 *   3. "What we offer" — two alternating cards (For Buyers, For Sellers)
 *   4. "What we believe" — 4 value cards in a row (icons + copy)
 *   5. Founder — full-bleed portrait with rounded overlay card
 *   6. "Gear up with Throttlein" — dark CTA banner
 *
 * The global site Navbar + Footer come from app/layout.tsx, so this
 * file renders only the body sections between them.
 */

export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    route: '/about',
    defaultTitle: 'About Throttlein — India’s Marketplace Built for Riders',
    defaultDescription:
      'Throttlein is India’s dedicated online marketplace for motorcycle riders — authentic helmets, riding gear, parts, and accessories from trusted brands. Learn why we started and what we believe.',
  });
}

// Inline outline icons for the four "What we believe" value cards.
// Match Figma's 2px stroke, round joins.
function ShieldCheckIcon({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function BikeIcon({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <path d="M15 6h3l3 6-4 2-2-4-6-2 3-2z" />
    </svg>
  );
}
function TrendingIcon({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </svg>
  );
}
function UsersIcon({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

const BELIEFS = [
  {
    title: 'Authentic, Always',
    body: 'Real products from real sellers because your safety depends on it.',
    Icon: ShieldCheckIcon,
  },
  {
    title: 'Built For Riders',
    body: 'Every decision starts with the person on the bike.',
    Icon: BikeIcon,
  },
  {
    title: 'Local Businesses, Bigger Reach',
    body: 'When we help a shop grow, we strengthen the whole riding community.',
    Icon: TrendingIcon,
  },
  {
    title: 'One Ride, One Community',
    body: 'From daily commuters to weekend tourers, this is a marketplace for everyone who rides.',
    Icon: UsersIcon,
  },
];

export default function AboutPage() {
  return (
    <main className="bg-white text-[#141414] font-poppins">
      <JsonLd data={aboutPageSchema()} />

      {/* ─── HERO ────────────────────────────────────────────────────
          Dark rider photo. Bottom fades to black so the headline lands
          on solid black — the next section (intro paragraph) extends
          that black downward without a visible seam. */}
      <section className="relative w-full h-[560px] md:h-[660px] overflow-hidden bg-black">
        <Image
          src="/about/hero-riders.webp"
          alt="Two motorcyclists riding through open terrain"
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/95 pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 px-6 md:px-10 pb-14 md:pb-20">
          <div className="max-w-[850px] mx-auto text-center">
            <h1 className="font-medium text-white leading-[1.15] tracking-[-1.5px] text-[36px] md:text-[56px] lg:text-[64px]">
              A Motorbike Community platform build for both{' '}
              <span className="text-[#deff66]">buyers and sellers</span>
            </h1>
          </div>
        </div>
      </section>

      {/* ─── INTRO ON BLACK ─────────────────────────────────────────── */}
      <section className="bg-black px-6 md:px-10 pt-4 pb-20 md:pb-24">
        <div className="max-w-[850px] mx-auto flex flex-col gap-4 text-center text-[16px] md:text-[18px] leading-[1.55]">
          <p className="text-white">
            Buying for your motorcycle in India has always been harder than it should be. Genuine gear is
            scattered across dozens of shops, fakes are everywhere, and finding the right helmet or jacket
            online often means second-guessing whether it&rsquo;s the real thing. Meanwhile, the local shops
            and brands that know this gear best struggle to reach riders beyond their own street.
          </p>
          <p className="text-[#e0e0e0]">
            We built Throttlein to fix both sides of that problem to give riders one trusted place to shop, and
            to give sellers a real platform to grow.
          </p>
        </div>
      </section>

      {/* ─── WHAT WE OFFER ─────────────────────────────────────────── */}
      <section className="px-6 md:px-10 pt-20 md:pt-24">
        <div className="max-w-[1232px] mx-auto flex flex-col items-center gap-10">
          <header className="max-w-[550px] text-center flex flex-col gap-4">
            <h2 className="font-medium text-[32px] md:text-[48px] leading-[1.2] tracking-[-1.4px] text-[#141414]">
              What we offer
            </h2>
            <p className="text-[15px] md:text-[16px] leading-[1.55] text-[#424242]">
              Buying for your motorcycle in India has always been harder than it should be. Genuine gear is
              scattered across dozens of shops, fakes are everywhere, and finding the right helmet or jacket
              online often means second-guessing whether it&rsquo;s the real thing.
            </p>
          </header>
          <OfferCard
            heading="For Buyers"
            body="Throttlein gives accessory shops, distributors, and brands a direct line to riders across India. Whether you&rsquo;ve been selling offline for years or you&rsquo;re an established brand looking for a focused channel, we help you take your business online."
            cta={{ label: 'Explore Products', href: '/products' }}
            image={{ src: '/about/buyers.webp', alt: 'Rider unboxing a fresh Throttlein package' }}
            reversed={false}
          />
          <OfferCard
            heading="For Sellers"
            body="Throttlein gives accessory shops, distributors, and brands a direct line to riders across India. Whether you&rsquo;ve been selling offline for years or you&rsquo;re an established brand looking for a focused channel, we help you take your business online."
            cta={{ label: 'Become a Vendor', href: '/seller' }}
            image={{ src: '/about/sellers.webp', alt: 'Seller managing Throttlein storefront on a laptop' }}
            reversed
          />
        </div>
      </section>

      {/* ─── WHAT WE BELIEVE ───────────────────────────────────────── */}
      <section className="px-6 md:px-10 pt-20 md:pt-24">
        <div className="max-w-[1232px] mx-auto flex flex-col gap-10">
          <header className="max-w-[550px] mx-auto text-center">
            <h2 className="font-medium text-[32px] md:text-[48px] leading-[1.2] tracking-[-1.4px] text-[#141414]">
              What we believe
            </h2>
          </header>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {BELIEFS.map(({ title, body, Icon }) => (
              <article
                key={title}
                className="bg-[#f3f4f2] border border-[#eee] rounded-2xl p-6 flex flex-col gap-3 h-full"
              >
                <span
                  aria-hidden
                  className="w-16 h-16 rounded-lg bg-[#eaebe7] grid place-items-center text-[#141414]"
                >
                  <Icon className="w-9 h-9" />
                </span>
                <h3 className="font-semibold text-[18px] md:text-[20px] leading-[1.4] text-black">
                  {title}
                </h3>
                <p className="text-[15px] leading-[1.55] text-[#424242]">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FOUNDER ───────────────────────────────────────────────── */}
      {/* <section className="px-6 md:px-10 pt-20 md:pt-24">
        <div className="max-w-[1232px] mx-auto relative rounded-2xl overflow-hidden bg-[#111]">
          <div className="relative aspect-[16/10] md:aspect-[16/9] lg:aspect-[1232/698]">
            <Image
              src="/about/ceo.webp"
              alt="Atul Kumar Yadav, Founder & CEO"
              fill
              sizes="(max-width: 1024px) 100vw, 1232px"
              className="object-cover"
            />
            <div className="hidden md:flex absolute bottom-8 right-8 w-[541px] max-w-[calc(100%-4rem)] bg-[#fafbf8] rounded-2xl p-8 flex-col gap-5">
              <div className="flex flex-col gap-2">
                <p className="font-medium text-[36px] lg:text-[48px] leading-[1.2] tracking-[-1.4px] text-black">
                  Atul Kumar Yadav
                </p>
                <p className="text-[16px] lg:text-[18px] leading-[1.5] text-[#757575]">
                  Founder &amp; Chief Executive Officer
                </p>
              </div>
              <p className="text-[15px] lg:text-[16px] leading-[1.55] text-[#424242]">
                Atul founded Noseberry Digitals in 2019 and continues to lead the company as CEO, setting vision
                and growth strategy across brand, software, marketing, and AI for the property industry.
              </p>
            </div>
          </div>
          <div className="md:hidden bg-[#fafbf8] p-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <p className="font-medium text-[28px] leading-[1.2] tracking-[-1px] text-black">
                Atul Kumar Yadav
              </p>
              <p className="text-[14px] text-[#757575]">Founder &amp; Chief Executive Officer</p>
            </div>
            <p className="text-[14px] leading-[1.6] text-[#424242]">
              Atul founded Noseberry Digitals in 2019 and continues to lead the company as CEO, setting vision
              and growth strategy across brand, software, marketing, and AI for the property industry.
            </p>
          </div>
        </div>
      </section> */}

      {/* ─── GEAR UP CTA ───────────────────────────────────────────── */}
      <section className="relative w-full mt-20 md:mt-24 overflow-hidden bg-black py-16 md:py-24">
        <Image
          src="/about/gearup-jackets.webp"
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-right"
          aria-hidden
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(90deg, rgba(0,0,0,1) 34%, rgba(0,0,0,0.7) 65%, rgba(0,0,0,0.55) 85%, rgba(0,0,0,0.2) 97%, rgba(0,0,0,0) 100%)',
          }}
        />
        <div className="container">
          <div className="relative w-full">
            <div className="max-w-[770px] flex flex-col gap-8 text-white text-center mx-auto">
              <div className="flex flex-col gap-3">
                <h2 className="font-medium text-[32px] md:text-[48px] leading-[1.8] tracking-[-1.8px]">
                  Gear up with Throttlein
                </h2>
                <p className="text-base md:text-lg leading-[1.52] text-white">
                  Whether you&rsquo;re gearing up for your next ride or looking to grow your business, Throttlein is
                  built for you.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <Link
                  href="/products"
                  className="inline-flex items-center justify-center bg-[#d3ff33] hover:bg-[#c8f428] text-black font-semibold text-sm px-5 h-10 rounded-lg transition min-w-[145px]"
                >
                  Shop Now
                </Link>
                <Link
                  href="/seller"
                  className="inline-flex items-center justify-center bg-transparent border border-[#bdbdbd] hover:border-white text-white font-semibold text-sm px-5 h-10 rounded-lg transition"
                >
                  Become a Seller
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

// Reusable 2-column card for the "What we offer" section. `reversed`
// flips the image to the left side so successive rows alternate.
function OfferCard({
  heading,
  body,
  cta,
  image,
  reversed,
}: {
  heading: string;
  body: string;
  cta: { label: string; href: string };
  image: { src: string; alt: string };
  reversed: boolean;
}) {
  const textBlock = (
    <div className="flex-1 flex flex-col gap-6 justify-center md:p-10">
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold text-[22px] md:text-[24px] leading-[1.4] text-[#141414]">
          {heading}
        </h3>
        <p
          className="text-[15px] md:text-[16px] leading-[1.55] text-[#424242]"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }}
        />
      </div>
      <div>
        <Link
          href={cta.href}
          className="inline-flex items-center justify-center bg-black hover:bg-[#212121] text-white font-semibold text-sm px-5 h-10 rounded-lg transition"
        >
          {cta.label}
        </Link>
      </div>
    </div>
  );

  const imageBlock = (
    <div className="flex-1 relative aspect-[4/3] md:aspect-auto md:h-[464px] rounded-2xl overflow-hidden bg-white">
      <Image
        src={image.src}
        alt={image.alt}
        fill
        sizes="(max-width: 768px) 100vw, 600px"
        className="object-cover"
      />
    </div>
  );

  return (
    <div className="w-full bg-[#f3f4f2] rounded-3xl p-4 flex flex-col md:flex-row items-stretch gap-4">
      {reversed ? (
        <>
          {imageBlock}
          {textBlock}
        </>
      ) : (
        <>
          {textBlock}
          {imageBlock}
        </>
      )}
    </div>
  );
}
