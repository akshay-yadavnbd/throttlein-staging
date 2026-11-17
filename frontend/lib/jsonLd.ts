/**
 * JSON-LD schema generators for the ThrottleIn storefront.
 *
 * Each helper returns a plain object ready to be passed straight into
 * `<JsonLd data={...} />` (see components/seo/JsonLd.tsx). All URLs use
 * the canonical SITE_URL from lib/siteUrl so dev / staging / prod all
 * emit the right origin without per-page hardcoding.
 *
 * Why this lives here (not in each page): every page that wants a
 * specific schema (WebPage, AboutPage, Brand, Product, ...) can just
 * import the right helper and stay focussed on its own data. The
 * Organization + WebSite schemas are emitted from the root layout —
 * those are inline because they don't take any per-page parameters.
 */

import { SITE_URL } from '@/lib/siteUrl';
import { API_URL } from '@/lib/api';

type Json = Record<string, unknown>;

/* --------------- Shared helpers --------------- */

/** Reusable Organization @id pointer used by `publisher` / `copyrightHolder`. */
const ORG_REF = { '@id': `${SITE_URL}/#organization` };

/**
 * Absolute URL of the site-wide fallback social image (hero banner).
 * Used by:
 *   - the root layout's `openGraph.images` default
 *   - every helper below whenever a page doesn't have a more specific
 *     image (product images, blog featured image, category image, ...)
 * Owned + shipped in `frontend/public/images/home-banner-img.png` so
 * social crawlers can always fetch a real 200-OK response.
 */
export const DEFAULT_OG_IMAGE = `${SITE_URL}/images/home-banner-img.png`;

/** Convert a stored S3 key / relative path into an absolute URL. */
export function absoluteImageUrl(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
  if (raw.startsWith('/')) return `${SITE_URL}${raw}`;
  const apiOrigin = API_URL.replace(/\/api$/, '');
  return `${apiOrigin}/api/files/${raw}`;
}

/** Quick HTML->text helper for description fields. */
function stripHtml(s?: string): string {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* --------------- WebPage --------------- */

export function webPageSchema(opts: {
  url: string;
  name: string;
  headline?: string;
  description?: string;
  datePublished?: string;
  dateModified?: string;
  image?: string | string[];
  breadcrumb?: Json;
}): Json {
  const {
    url,
    name,
    headline,
    description,
    datePublished,
    dateModified,
    image,
    breadcrumb,
  } = opts;
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name,
    ...(headline ? { headline } : {}),
    ...(description ? { description } : {}),
    ...(datePublished ? { datePublished } : {}),
    ...(dateModified ? { dateModified } : {}),
    ...(image ? { image } : {}),
    inLanguage: 'en-IN',
    isPartOf: { '@id': `${SITE_URL}/#website` },
    publisher: ORG_REF,
    ...(breadcrumb ? { breadcrumb } : {}),
  };
}

/* --------------- AboutPage --------------- */

export function aboutPageSchema(): Json {
  const url = `${SITE_URL}/about`;
  return {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    '@id': `${url}#aboutpage`,
    url,
    name: "About ThrottleIn — India's Marketplace Built for Riders",
    headline: 'About ThrottleIn',
    description:
      "ThrottleIn is India's dedicated online marketplace for motorcycle riders — authentic helmets, riding gear, parts, and accessories from trusted brands. Learn why we started and what we believe.",
    inLanguage: 'en-IN',
    isPartOf: { '@id': `${SITE_URL}/#website` },
    about: ORG_REF,
    mainEntity: ORG_REF,
    publisher: ORG_REF,
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: 'About', item: url },
      ],
    },
  };
}

/* --------------- ContactPage --------------- */

export function contactPageSchema(): Json {
  const url = `${SITE_URL}/contact`;
  return {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    '@id': `${url}#contactpage`,
    url,
    name: 'Contact ThrottleIn — Support, Sellers & Help',
    headline: 'Contact ThrottleIn',
    description:
      'Get in touch with ThrottleIn for help with orders, returns, payments, seller accounts and more. Our team responds within 24 business hours.',
    inLanguage: 'en-IN',
    isPartOf: { '@id': `${SITE_URL}/#website` },
    about: ORG_REF,
    mainEntity: ORG_REF,
    publisher: ORG_REF,
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: 'Contact', item: url },
      ],
    },
  };
}

/* --------------- CollectionPage --------------- */

export function collectionPageSchema(opts: {
  url: string;
  name: string;
  description: string;
  image?: string;
}): Json {
  const { url, name, description, image } = opts;
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${url}#collectionpage`,
    url,
    name,
    description,
    ...(image ? { image } : {}),
    inLanguage: 'en-IN',
    isPartOf: { '@id': `${SITE_URL}/#website` },
    publisher: ORG_REF,
  };
}

/* --------------- Brand --------------- */

export function brandSchema(opts: {
  slug: string;
  name: string;
  alternateName?: string;
  description?: string;
  logo?: string;
  image?: string;
  sameAs?: string[];
}): Json {
  const { slug, name, alternateName, description, logo, image, sameAs } = opts;
  const url = `${SITE_URL}/brands/${slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Brand',
    '@id': `${url}#brand`,
    name,
    ...(alternateName ? { alternateName } : {}),
    url,
    ...(description ? { description } : {}),
    ...(logo ? { logo: absoluteImageUrl(logo) } : {}),
    ...(image ? { image: absoluteImageUrl(image) } : {}),
    ...(sameAs && sameAs.length ? { sameAs } : {}),
  };
}

/* --------------- Product --------------- */

export function productSchema(product: any): Json {
  const slug = product?.slug || '';
  const url = `${SITE_URL}/product/${slug}`;

  const brandName =
    (typeof product?.brand === 'object' && product?.brand?.name) ||
    (typeof product?.brand === 'string' ? product.brand : '') ||
    '';
  const brandSlug =
    typeof product?.brand === 'object' && product?.brand?.slug
      ? product.brand.slug
      : '';

  const categoryName =
    typeof product?.category === 'object' && product?.category?.name
      ? product.category.name
      : '';

  const imageUrls: string[] = [];
  for (const raw of product?.images || []) {
    const abs = absoluteImageUrl(raw);
    if (abs) imageUrls.push(abs);
  }

  const description =
    stripHtml(product?.description) ||
    product?.shortDescription ||
    product?.name ||
    '';

  const inStock = (product?.stock ?? 0) > 0;
  const price = String(product?.price ?? 0);

  const out: Json = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: product?.name,
    description,
    sku: product?._id || product?.sku || slug,
    ...(slug ? { url } : {}),
    ...(imageUrls.length ? { image: imageUrls } : {}),
    ...(brandName
      ? {
          brand: {
            '@type': 'Brand',
            name: brandName,
            ...(brandSlug ? { '@id': `${SITE_URL}/brands/${brandSlug}#brand` } : {}),
          },
        }
      : {}),
    ...(categoryName ? { category: categoryName } : {}),
    offers: {
      '@type': 'Offer',
      price,
      priceCurrency: 'INR',
      availability: inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      url,
      seller: ORG_REF,
    },
  };

  // Aggregate rating — real values when available; otherwise we omit
  // the field entirely (Google warns about review schemas with no data).
  if (product?.rating && product?.reviewsCount) {
    out.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: String(product.rating),
      reviewCount: String(product.reviewsCount),
    };
  }

  return out;
}

/* --------------- ItemList --------------- */

export function itemListSchema(opts: {
  name: string;
  description?: string;
  items: Array<{ name?: string; slug?: string }>;
  url?: string;
}): Json {
  const { name, description, items, url } = opts;
  const filtered = (items || []).filter((p) => p?.slug && p?.name);
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    ...(description ? { description } : {}),
    ...(url ? { url } : {}),
    numberOfItems: filtered.length,
    itemListElement: filtered.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/product/${p.slug}`,
      name: p.name,
    })),
  };
}

/* --------------- HowTo --------------- */

/**
 * Static HowTo schema for "How to Choose the Right Motorcycle Helmet".
 * Emitted on pages where this guidance is shown (currently unused by
 * default — call from a helmet-related page when ready).
 */
export function howToSchema(): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: 'How to Choose the Right Motorcycle Helmet',
    description:
      'A step-by-step guide to picking the right motorcycle helmet — covering certification, size, type, and fit so you ride safer.',
    inLanguage: 'en-IN',
    totalTime: 'PT15M',
    estimatedCost: {
      '@type': 'MonetaryAmount',
      currency: 'INR',
      value: '3000',
    },
    supply: [
      { '@type': 'HowToSupply', name: 'Soft measuring tape' },
      { '@type': 'HowToSupply', name: 'Your bike riding style notes (commute / touring / track)' },
    ],
    tool: [
      { '@type': 'HowToTool', name: 'Mirror (to check fit visually)' },
    ],
    step: [
      {
        '@type': 'HowToStep',
        position: 1,
        name: 'Pick a certified helmet',
        text: 'Always start with safety certification. In India, look for ISI (IS 4151) certification. International certifications like DOT, ECE 22.06, SNELL or SHARP indicate higher safety standards.',
        url: `${SITE_URL}/blog/how-to-choose-motorcycle-helmet#certification`,
      },
      {
        '@type': 'HowToStep',
        position: 2,
        name: 'Choose the right helmet type',
        text: 'Full-face for maximum protection, modular for versatility, open-face for city/cruiser riding, off-road for trails. Pick based on your riding style.',
        url: `${SITE_URL}/blog/how-to-choose-motorcycle-helmet#type`,
      },
      {
        '@type': 'HowToStep',
        position: 3,
        name: 'Measure your head correctly',
        text: "Wrap a soft measuring tape around your head about an inch above your eyebrows — that's your circumference. Compare it against the brand's size chart (sizes vary slightly between brands).",
        url: `${SITE_URL}/blog/how-to-choose-motorcycle-helmet#size`,
      },
      {
        '@type': 'HowToStep',
        position: 4,
        name: 'Check the fit',
        text: "The helmet should feel snug but not painful. Cheeks should be lightly pressed, no gaps at the forehead, and it shouldn't rotate when you shake your head. If it moves, go a size down.",
        url: `${SITE_URL}/blog/how-to-choose-motorcycle-helmet#fit`,
      },
      {
        '@type': 'HowToStep',
        position: 5,
        name: 'Look for must-have features',
        text: 'Anti-fog visor, removable + washable liner, good ventilation, double-D ring or micrometric strap, and Pinlock-ready visor. Sun visor is a big quality-of-life win for Indian conditions.',
        url: `${SITE_URL}/blog/how-to-choose-motorcycle-helmet#features`,
      },
      {
        '@type': 'HowToStep',
        position: 6,
        name: 'Buy from a trusted source',
        text: 'Stick to authorised sellers — fake helmets are a real problem in India. ThrottleIn lists only verified sellers and authentic stock.',
        url: `${SITE_URL}/blog/how-to-choose-motorcycle-helmet#trusted-source`,
      },
    ],
  };
}
