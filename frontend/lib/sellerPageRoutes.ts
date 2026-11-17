/**
 * Where a seller CMS page lives on the public site.
 *
 * ONE definition, because getting it wrong is invisible: a sitemap or
 * llms.txt that advertises the wrong path doesn't break a page a human
 * clicks — it just feeds crawlers URLs that 404. That is exactly what
 * happened when `seller-category-2` was added: the router, the footer
 * links and the backend all learned about the new template, while the
 * sitemap and llms.txt kept testing `=== 'seller-category'` and emitted
 * every template-2 page as a bare root slug.
 *
 * Source of truth is `pageToRoute()` in backend/src/controllers/
 * pageController.js — this mirrors it for the routes the frontend has to
 * generate itself. Add a template here and there in the same change.
 */

/** Dynamic templates that render the "Sell <X> Online" landing page.
 *  These are NESTED under Sell Online; every other dynamic template sits
 *  at the property root. */
export const SELLER_CATEGORY_TEMPLATES = ['seller-category', 'seller-category-2'] as const;

export type SellerCategoryTemplate = (typeof SELLER_CATEGORY_TEMPLATES)[number];

/** Is this one of the "Sell <X> Online" landing-page templates? */
export function isSellerCategoryTemplate(template: unknown): boolean {
  return typeof template === 'string'
    && (SELLER_CATEGORY_TEMPLATES as readonly string[]).includes(template);
}

/**
 * Public path for a dynamic seller page, relative to the seller origin.
 * Returns null when the page has no slug to build one from.
 */
export function sellerDynamicPagePath(page: { slug?: string; template?: string } | null | undefined): string | null {
  if (!page?.slug) return null;
  return isSellerCategoryTemplate(page.template) ? `/sell-online/${page.slug}` : `/${page.slug}`;
}
