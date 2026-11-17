import { sellerUrl, sellerContentUrl } from './sellerUrl';
import { originForSite } from './site';

/**
 * Navigation for the SELLER property (seller.throttlein.com).
 *
 * Single source of truth for BOTH the header dropdowns and the footer
 * columns — the Figma design uses the same groupings in both places
 * ("Sell Online", "Grow", "Learn"), and letting them drift apart is how
 * you end up with a footer link the header swears doesn't exist.
 *
 * URLs go through `sellerUrl()` so they resolve correctly on either
 * host: on seller.throttlein.com it yields clean paths against the
 * seller origin, and in local dev (NEXT_PUBLIC_SELLER_URL unset) it
 * yields the /seller/* paths the app router actually serves.
 *
 * ── ON DESTINATIONS THAT DON'T EXIST YET ──────────────────────────
 * Several links in the design point at marketing pages nobody has
 * written ("Throttlein Ads", "Shopping Festivals", …). Rather than
 * invent routes or ship dead `#` links, they point at seller-site CMS
 * paths — `/page/<slug>` — which an admin can now create from
 * Admin → (switch to Seller) → Pages → Create page.
 *
 * Until such a page exists the URL resolves to the seller catch-all,
 * which permanently redirects to the main site rather than 404ing. Each
 * one is marked `needsCmsPage` below so it's greppable; drop the flag
 * once the page is live.
 */

export type SellerNavLink = {
  label: string;
  href: string;
  /** True when the destination is a seller CMS page that still has to
   *  be authored in the admin panel. Purely informational — nothing
   *  reads it at runtime. */
  needsCmsPage?: boolean;
};

export type SellerNavGroup = {
  /** Header pill label (short) — e.g. "Grow". */
  label: string;
  /** Footer column heading (longer) — e.g. "Grow Your Business".
   *  Falls back to `label` when omitted. */
  footerLabel?: string;
  links: SellerNavLink[];
};

/** CMS page on the seller property — a bare slug at the property root:
 *  `seller.throttlein.com/<slug>` in prod, `/seller/<slug>` in dev.
 *
 *  The `/page/` prefix these used to carry is gone; the proxy 301s the old
 *  shape to the clean one so existing links and any indexed URLs still land.
 *  Slugs are protected from colliding with real routes by
 *  RESERVED_SLUGS_BY_SITE in backend/src/models/Page.js. */
const cms = (slug: string) => sellerContentUrl(`/${slug}`);

/**
 * Seller system documents — seeded by `backend/src/utils/seedPages.js`
 * with `site: 'seller'`, so these slugs are REAL and live. Named here
 * rather than inlined so a rename shows up as one edit.
 */
const SELLER_DOCS = {
  terms: cms('seller-terms'),
  faq: cms('seller-faq'),
  fees: cms('pricing-and-fees'),
  onboarding: cms('seller-onboarding-guide'),
  help: cms('seller-help-and-support'),
  privacy: cms('seller-privacy-policy'),
  shipping: cms('shipping-delivery-policy'),
};

export const SELLER_NAV: SellerNavGroup[] = [
  {
    label: 'Sell Online',
    links: [
      // The long-form guide is the natural first stop for this menu —
      // a real route at /sell-online, and the anchors below jump
      // straight to its relevant sections.
      { label: 'How Selling Works', href: sellerUrl('/sell-online') },
      { label: 'Create Account', href: sellerUrl('/register') },
      { label: 'How to List Products', href: sellerUrl('/sell-online#list-products') },
      { label: 'Packing & Shipping', href: sellerUrl('/sell-online#packing-and-shipping') },
      { label: 'Fees & Commission', href: SELLER_DOCS.fees },
      // Help & Support now has its own authored page — it used to
      // point at the FAQ as a stand-in.
      { label: 'Help & Support', href: SELLER_DOCS.help },
    ],
  },
  {
    label: 'Fees and Commission',
    // No footer column of its own in the design — the fees link lives
    // under "Sell Online" there, so this group is filtered out of the
    // footer by `SELLER_FOOTER_NAV`.
    links: [
      { label: 'Pricing & Fees Schedule', href: SELLER_DOCS.fees },
      { label: 'Seller Terms & Conditions', href: SELLER_DOCS.terms },
      { label: 'Payment & Settlement Cycle', href: cms('payment-cycle'), needsCmsPage: true },
    ],
  },
  {
    label: 'Grow',
    footerLabel: 'Grow Your Business',
    links: [
      { label: 'Insights & Tools', href: cms('insights-and-tools'), needsCmsPage: true },
      { label: 'Throttlein Ads', href: cms('throttlein-ads'), needsCmsPage: true },
      { label: 'Throttlein Value Services', href: cms('value-services'), needsCmsPage: true },
      { label: 'Shopping Festivals', href: cms('shopping-festivals'), needsCmsPage: true },
    ],
  },
  {
    label: 'Learn',
    footerLabel: 'Learn More',
    links: [
      { label: 'Seller FAQ', href: SELLER_DOCS.faq },
      { label: 'Onboarding Handbook', href: SELLER_DOCS.onboarding },
      { label: 'Seller Success Stories', href: cms('success-stories'), needsCmsPage: true },
      // Public path renamed from /blog — see BLOG_BASE in lib/blogUrl.ts.
      { label: 'Seller Blogs', href: sellerUrl('/seller-blogs') },
    ],
  },
  {
    // Footer-only column (see HEADER_HIDDEN_GROUPS) collecting the
    // authored policy/support pages from Admin → Seller → Pages, per
    // product decision. Every href here is a LIVE page.
    label: 'Seller policies',
    footerLabel: 'Seller Policies',
    // No fees or help links here — "Fees & Commission" and
    // "Help & Support" already live in the Sell Online column; one
    // destination, one link.
    links: [
      { label: 'Seller Terms & Conditions', href: SELLER_DOCS.terms },
      { label: 'Seller Privacy Policy', href: SELLER_DOCS.privacy },
      { label: 'Shipping & Delivery Policy', href: SELLER_DOCS.shipping },
    ],
  },
];

/**
 * Groups TEMPORARILY hidden from the header, by label.
 *
 * "Grow" is parked because all four of its destinations are still
 * `needsCmsPage` — nobody has written Insights & Tools, Throttlein Ads,
 * Value Services or Shopping Festivals — so the dropdown opened onto four
 * links that 404. The group itself is left fully defined above rather than
 * deleted: bringing it back is removing one string from this array, once
 * those pages exist.
 *
 * Scope is the HEADER only. The footer's "Grow Your Business" column is
 * untouched — remove it from SELLER_FOOTER_NAV below if that should go
 * too.
 */
const HEADER_HIDDEN_GROUPS: string[] = ['Grow', 'Seller policies'];

/** Groups shown as header dropdowns. `needsCmsPage` links are filtered
 *  here too — "Payment & Settlement Cycle" (Fees dropdown) was still
 *  reaching the header as a live 404 while its page is unwritten. */
export const SELLER_HEADER_NAV = SELLER_NAV.filter(
  (g) => !HEADER_HIDDEN_GROUPS.includes(g.label),
)
  .map((g) => ({ ...g, links: g.links.filter((l) => !l.needsCmsPage) }))
  .filter((g) => g.links.length > 0);

/** Groups shown as footer columns. "Fees and Commission" is header-only
 *  — the design folds it into the Sell Online column downstairs.
 *
 *  `needsCmsPage` links are filtered out here too, exactly like the
 *  header's parked "Grow" group: the SEO audit flagged every one of
 *  them (insights-and-tools, throttlein-ads, value-services,
 *  shopping-festivals, success-stories) as a live 404 on the seller
 *  property. They come back automatically the moment the flag is
 *  dropped after the page is authored. A group whose links are all
 *  unauthored disappears entirely rather than rendering an empty
 *  column. */
export const SELLER_FOOTER_NAV = SELLER_NAV.filter(
  (g) => g.label !== 'Fees and Commission',
)
  .map((g) => ({ ...g, links: g.links.filter((l) => !l.needsCmsPage) }))
  .filter((g) => g.links.length > 0);

/**
 * "Popular categories to sell across India" — the 16-link block at the
 * top of the seller footer. These are SEO landing pages, one per
 * category a seller might list in.
 *
 * All are CMS pages on the seller property, so marketing can write and
 * re-title them without a deploy.
 */
export const SELLER_FOOTER_CATEGORIES: SellerNavLink[] = [
  'Helmets',
  'Riding Gear',
  'Bike Parts',
  'Accessories',
  'Exhaust Systems',
  'Performance Parts',
  'Motorcycle Apparel',
  'Tools & Maintenance',
  'Tyres & Wheels',
  'Lubricants',
  'GPS & Electronics',
  'Vintage Parts',
  'Custom Parts',
  'Safety Equipment',
  'Touring Accessories',
  'Racing Gear',
].map((name) => ({
  label: `Sell ${name} Online`,
  href: cms(
    `sell-${name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-online`,
  ),
  needsCmsPage: true,
}));

/** Primary conversion actions, used by the header and the hero CTAs. */
export const SELLER_CTA = {
  // "Login" only — the Figma header said "Login/Signup", but signup has
  // its own dedicated CTA next to it ("Start Selling"), so the combined
  // label was offering the same action twice.
  login: { label: 'Login', href: sellerUrl('/login') },
  register: { label: 'Start Selling', href: sellerUrl('/register') },
  /** The hero + closing banner use warmer wording for the same action. */
  becomeSeller: { label: 'Become a Seller', href: sellerUrl('/register') },
};

/**
 * Legal links for the footer strip.
 *
 * Seller Terms and the Seller Privacy Policy are seller-property pages
 * (the seller privacy policy has since been authored in the admin, so
 * the strip no longer borrows the storefront one). Contact is NOT
 * duplicated onto the seller site, so it points at the main origin
 * absolutely — a relative path would send the seller catch-all into a
 * redirect hop to reach the same place.
 */
export const SELLER_LEGAL_LINKS: SellerNavLink[] = [
  { label: 'Seller Terms', href: SELLER_DOCS.terms },
  { label: 'Privacy Policy', href: SELLER_DOCS.privacy },
  { label: 'Contact', href: `${originForSite('main')}/contact` },
];

/** Social profiles for the footer's "Follow us" row. */
export const SELLER_SOCIALS = [
  { key: 'fb', label: 'Facebook', href: 'https://www.facebook.com/throttleinmarketplace/' },
  { key: 'ig', label: 'Instagram', href: 'https://www.instagram.com/throttlein_india' },
  { key: 'in', label: 'LinkedIn', href: 'https://www.linkedin.com/company/throttlein/' },
  { key: 'yt', label: 'YouTube', href: 'https://www.youtube.com/@throttlein' },
  // X removed per product decision — Throttlein doesn't operate a
  // profile there; the link pointed at an account that doesn't exist.
] as const;
