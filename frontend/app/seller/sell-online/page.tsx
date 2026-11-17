import type { Metadata } from 'next';
import SellOnlinePage from '@/components/pages/SellOnlinePage';
import JsonLd from '@/components/seo/JsonLd';
import { buildStaticPageMetadata } from '@/lib/staticMeta';
import { originForSite } from '@/lib/site';
import { FAQ } from '@/lib/sellOnlineContent';
import { fetchTestimonials } from '@/lib/testimonials';
import { fetchSellerCategoryLinks } from '@/lib/sellerCategoryLinks';
import {
  sellerServiceJsonLd,
  sellerWebPageGraphJsonLd,
} from '@/lib/structuredData';

/**
 * Sell Online — the seller property's long-form onboarding guide.
 *
 * Public URL:    seller.throttlein.com/sell-online
 * Internal path: /seller/sell-online   (rewritten by proxy.ts)
 *
 * A hard-coded route rather than a CMS prose page: the layout has a
 * sticky anchor rail, a 9-row comparison table, numbered step journeys
 * and ~125 checklist items across 12 cards. None of that is expressible
 * in the rich-text editor.
 *
 * Its SEO meta IS editable, though — from Admin → (switch to Seller) →
 * Pages → "Sell Online", backed by a `site: 'seller',
 * staticRoute: '/sell-online'` record. Same arrangement as Seller home
 * and Seller blog.
 */

export async function generateMetadata(): Promise<Metadata> {
  return buildStaticPageMetadata({
    site: 'seller',
    route: '/sell-online',
    defaultTitle: 'Sell Motorcycle Gear Online in India · THROTTLEIN Seller Hub',
    defaultDescription:
      'Create your Throttlein seller account and sell helmets, riding gear, bike accessories and performance parts to riders across India. Zero setup fee, 0% commission, 24-48 hour verification.',
    siteName: 'THROTTLEIN Sellers',
  });
}

export default async function Page() {
  const origin = originForSite('seller');
  // Shared with the seller footer's "Popular categories" band, so the two
  // lists can't disagree — see lib/sellerCategoryLinks.
  const [categoryPages, testimonials] = await Promise.all([
    fetchSellerCategoryLinks(),
    fetchTestimonials('seller'),
  ]);

  /**
   * FAQPage structured data, built from the same array the accordion
   * renders so the two can't drift. Google can surface an expandable FAQ
   * block in the SERP entry from this.
   */
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  /** HowTo for the account-creation journey — the page's primary intent. */
  const howToJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: 'How to start selling motorcycle gear online on Throttlein',
    description:
      'Register a Throttlein seller account, complete verification, list your products and start receiving orders from riders across India.',
    step: [
      { '@type': 'HowToStep', name: 'Create your seller account', url: `${origin}/sell-online#create-account` },
      { '@type': 'HowToStep', name: 'Choose a category', url: `${origin}/sell-online#choose-a-category` },
      { '@type': 'HowToStep', name: 'List your products', url: `${origin}/sell-online#list-products` },
      { '@type': 'HowToStep', name: 'Manage orders', url: `${origin}/sell-online#manage-orders` },
      { '@type': 'HowToStep', name: 'Pack and ship', url: `${origin}/sell-online#packing-and-shipping` },
      { '@type': 'HowToStep', name: 'Receive payments', url: `${origin}/sell-online#receive-payments` },
    ],
  };

  /* [WebPage + BreadcrumbList] @graph and the Service block — shapes,
     names and descriptions per the templates supplied by the product
     owner (FAQ + HowTo above were already in). */
  const pageUrl = `${origin}/sell-online`;
  const webPageGraphLd = sellerWebPageGraphJsonLd({
    name: 'Sell Riding Gear & Motorcycle Accessories Online | Throttlein',
    description:
      'Start selling riding gear, helmets, bike parts and motorcycle accessories online across India with Throttlein. Reach more buyers and grow your business.',
    url: pageUrl,
    crumbs: [
      { name: 'Seller Home', url: `${origin}/` },
      { name: 'Sell Online', url: pageUrl },
    ],
  });
  const serviceLd = sellerServiceJsonLd({
    name: 'Sell Riding Gear & Motorcycle Accessories Online',
    description:
      'Register as a seller on Throttlein to list and sell riding gear, helmets, bike parts and motorcycle accessories to buyers across India.',
    url: pageUrl,
  });

  return (
    <>
      <JsonLd data={webPageGraphLd} />
      <JsonLd data={serviceLd} />
      <JsonLd data={faqJsonLd} />
      <JsonLd data={howToJsonLd} />
      <SellOnlinePage categoryPages={categoryPages} testimonials={testimonials} />
    </>
  );
}
