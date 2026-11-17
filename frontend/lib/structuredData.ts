import { SITE_URL } from './siteUrl';
import { originForSite } from './site';

/**
 * Property-level JSON-LD, one block per property.
 *
 * These used to live inline in the ROOT layout, which meant the seller
 * subdomain emitted the STOREFRONT's Organization/WebSite schema —
 * wrong origin, wrong property (flagged by the schema audit as 🟠).
 * Now each property's layout renders its own:
 *
 *   app/(storefront)/layout.tsx → orgJsonLd + siteJsonLd
 *   app/seller/layout.tsx       → sellerGraphJsonLd (combined @graph)
 */

// ─── Storefront (throttlein.com) ─────────────────────────────────────

/** Organization — brand card for the knowledge panel. */
export const orgJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${SITE_URL}/#organization`,
  name: 'Throttlein',
  legalName: 'Noseberry Private Limited',
  url: SITE_URL,
  logo: {
    '@type': 'ImageObject',
    // /images/throttlein-logo.png is the file that actually exists in
    // public/ (same asset the Wordmark renders) — the previous
    // /logo.png 404'd (flagged by the schema audit).
    url: `${SITE_URL}/images/throttlein-logo.png`,
    width: 200,
    height: 60,
  },
  description:
    'Shop authentic motorcycle helmets, riding jackets, gloves & bike parts from verified sellers across India on Throttlein. Fast delivery, easy returns, trusted brands.',
  email: 'info@throttlein.com',
  telephone: '+91-9599888940',
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'customer support',
    telephone: '+91-9599888940',
    areaServed: 'IN',
    availableLanguage: ['English'],
    hoursAvailable: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      opens: '09:00',
      closes: '18:00',
    },
  },
  address: {
    '@type': 'PostalAddress',
    streetAddress:
      'TS-1201, 12th Floor, Galaxy Blue Sapphire Plaza, Plot No. C-03, Sector-4, Greater Noida West',
    addressLocality: 'Greater Noida',
    addressRegion: 'Uttar Pradesh',
    postalCode: '201309',
    addressCountry: 'IN',
  },
  areaServed: {
    '@type': 'Country',
    name: 'India',
  },
  sameAs: [
    'https://www.instagram.com/throttlein_india/',
    'https://www.facebook.com/throttleinmarketplace/',
    'https://www.youtube.com/@throttlein',
    'https://www.linkedin.com/company/throttlein/',
  ],
  knowsAbout: [
    'Motorcycle Helmets',
    'Riding Gear',
    'Bike Parts',
    'Motorcycle Accessories',
    'Rider Safety Equipment',
  ],
};

/** WebSite — wires up the Sitelinks Search Box experiment. */
export const siteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE_URL}/#website`,
  name: 'Throttlein',
  url: SITE_URL,
  description:
    'Shop authentic motorcycle helmets, riding jackets, gloves & bike parts from verified sellers across India on Throttlein. Fast delivery, easy returns, trusted brands.',
  inLanguage: 'en-IN',
  publisher: { '@id': `${SITE_URL}/#organization` },
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${SITE_URL}/products?q={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
  copyrightYear: '2026',
  copyrightHolder: { '@id': `${SITE_URL}/#organization` },
};

// ─── Seller property (seller.throttlein.com) ─────────────────────────

const SELLER_ORIGIN = originForSite('seller');

/**
 * Property-wide @graph — Organization + WebSite, per the structure
 * supplied by the product owner. Rendered from app/seller/layout.tsx on
 * EVERY seller page, so page-level nodes can reference the two @ids.
 * The home page adds the supplied Service + WebPage nodes on top (see
 * sellerHomeGraphJsonLd) — together the four nodes form the exact
 * home-page schema that was specified.
 *
 * One deliberate deviation: the supplied block's logo URL was
 * /logo.png, which 404s — the @id and dimensions are kept but the URL
 * points at /images/throttlein-logo.png, the file that exists.
 */
export const sellerGraphJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'ThrottleIn',
      legalName: 'Noseberry Private Limited',
      url: `${SITE_URL}/`,
      logo: {
        '@type': 'ImageObject',
        '@id': `${SITE_URL}/#logo`,
        url: `${SITE_URL}/images/throttlein-logo.png`,
        width: 200,
        height: 60,
      },
      description:
        'ThrottleIn is an Indian motorcycle marketplace connecting riders with sellers of motorcycle helmets, riding gear, bike parts and motorcycle accessories.',
      email: 'info@throttlein.com',
      telephone: '+91-9599888940',
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        telephone: '+91-9599888940',
        areaServed: 'IN',
        availableLanguage: ['English'],
        hoursAvailable: {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          opens: '09:00',
          closes: '18:00',
        },
      },
      address: {
        '@type': 'PostalAddress',
        streetAddress:
          'TS-1201, 12th Floor, Galaxy Blue Sapphire Plaza, Plot No. C-03, Sector-4, Greater Noida West',
        addressLocality: 'Greater Noida',
        addressRegion: 'Uttar Pradesh',
        postalCode: '201309',
        addressCountry: 'IN',
      },
      areaServed: {
        '@type': 'Country',
        name: 'India',
      },
      sameAs: [
        'https://www.instagram.com/throttlein_india/',
        'https://www.facebook.com/throttleinmarketplace/',
        'https://www.youtube.com/@throttlein',
        'https://www.linkedin.com/company/throttlein/',
      ],
      knowsAbout: [
        'Motorcycle Helmets',
        'Riding Gear',
        'Bike Parts',
        'Motorcycle Accessories',
        'Rider Safety Equipment',
      ],
    },
    {
      '@type': 'WebSite',
      '@id': `${SELLER_ORIGIN}/#website`,
      url: `${SELLER_ORIGIN}/`,
      name: 'ThrottleIn Seller',
      alternateName: 'ThrottleIn Seller Hub',
      publisher: { '@id': `${SITE_URL}/#organization` },
      inLanguage: 'en-IN',
    },
  ],
};

/**
 * Seller HOME's own nodes — the Service + WebPage half of the supplied
 * home schema. Rendered by app/seller/page.tsx; the @id references
 * resolve against the layout's Organization/WebSite nodes on the same
 * page.
 */
export const sellerHomeGraphJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Service',
      '@id': `${SELLER_ORIGIN}/#seller-service`,
      name: 'ThrottleIn Seller Marketplace Service',
      description:
        'ThrottleIn enables sellers in India to list and sell motorcycle helmets, riding gear, bike parts and motorcycle accessories through the ThrottleIn marketplace.',
      serviceType: 'Online marketplace seller service',
      provider: { '@id': `${SITE_URL}/#organization` },
      areaServed: { '@type': 'Country', name: 'India' },
      audience: {
        '@type': 'BusinessAudience',
        audienceType: 'Motorcycle riding gear, accessories and bike parts sellers',
      },
      url: `${SELLER_ORIGIN}/`,
    },
    {
      '@type': 'WebPage',
      '@id': `${SELLER_ORIGIN}/#webpage`,
      url: `${SELLER_ORIGIN}/`,
      name: 'ThrottleIn Seller',
      isPartOf: { '@id': `${SELLER_ORIGIN}/#website` },
      about: { '@id': `${SELLER_ORIGIN}/#seller-service` },
      publisher: { '@id': `${SITE_URL}/#organization` },
      inLanguage: 'en-IN',
    },
  ],
};

// ─── Shared page-level builders ──────────────────────────────────────
// Shapes follow the per-page templates supplied by the product owner:
// one @graph of [WebPage, BreadcrumbList] cross-referenced by @id, and
// a standalone Service block with mainEntityOfPage → the WebPage @id.

/**
 * WebPage + BreadcrumbList @graph for a seller-property page.
 * `url` must be the canonical page URL — the node @ids derive from it
 * (`<url>#webpage`, `<url>#breadcrumb`).
 */
export function sellerWebPageGraphJsonLd(opts: {
  name: string;
  description?: string;
  url: string;
  crumbs: Array<{ name: string; url: string }>;
  /** Extra fields merged into the WebPage node (dateModified etc.). */
  webPageExtra?: Record<string, unknown>;
}) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${opts.url}#webpage`,
        url: opts.url,
        name: opts.name,
        ...(opts.description ? { description: opts.description } : {}),
        isPartOf: { '@id': `${SELLER_ORIGIN}/#website` },
        publisher: { '@id': `${SITE_URL}/#organization` },
        breadcrumb: { '@id': `${opts.url}#breadcrumb` },
        inLanguage: 'en',
        ...(opts.webPageExtra || {}),
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${opts.url}#breadcrumb`,
        itemListElement: opts.crumbs.map((it, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: it.name,
          item: it.url,
        })),
      },
    ],
  };
}

/** Service node for the seller-acquisition pages (sell-online + the
 *  per-category landing pages). `mainEntityOfPage` ties it to the
 *  page's WebPage node from sellerWebPageGraphJsonLd. */
export function sellerServiceJsonLd(opts: {
  name: string;
  description?: string;
  url: string;
  serviceType?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${opts.url}#service`,
    name: opts.name,
    ...(opts.description ? { description: opts.description } : {}),
    serviceType: opts.serviceType || 'Online Marketplace Seller Registration',
    provider: { '@id': `${SITE_URL}/#organization` },
    areaServed: { '@type': 'Country', name: 'India' },
    audience: {
      '@type': 'Audience',
      audienceType: 'Motorcycle gear and accessories sellers/businesses',
    },
    url: opts.url,
    mainEntityOfPage: `${opts.url}#webpage`,
  };
}

/**
 * FAQPage derived from question-style headings in a markdown body.
 *
 * Prose pages (seller-faq, pricing-and-fees, the policies, the
 * onboarding guide) are authored as markdown with `## Question?`
 * headings followed by the answer. When a body contains at least two
 * such headings, that IS an FAQ — surface it as structured data built
 * from the same source the page renders, so the two can't drift.
 * Returns null when the body doesn't have Q&A shape (no schema is
 * better than an invented one).
 */
export function faqFromMarkdown(body: string): Record<string, unknown> | null {
  if (!body) return null;

  const lines = body.split(/\r?\n/);
  const qa: Array<{ q: string; a: string[] }> = [];
  let current: { q: string; a: string[] } | null = null;

  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (heading) {
      const text = heading[1].replace(/[*_`]/g, '').trim();
      if (/\?$/.test(text)) {
        current = { q: text, a: [] };
        qa.push(current);
      } else {
        current = null; // a non-question heading ends the previous answer
      }
      continue;
    }
    if (current) current.a.push(line);
  }

  const entries = qa
    .map(({ q, a }) => ({
      q,
      a: a
        .join(' ')
        // Strip the markdown that survives into plain text poorly.
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`>#]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    }))
    .filter((e) => e.a.length > 0);

  if (entries.length < 2) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e.q,
      acceptedAnswer: { '@type': 'Answer', text: e.a },
    })),
  };
}
