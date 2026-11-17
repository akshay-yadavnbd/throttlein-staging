'use client';

/**
 * Category listing page — `/<slug>` (root-level URL).
 *
 * Layout follows the Figma "list page" design:
 *  - Title strip at top (eyebrow + heading + subtitle)
 *  - Two-column: 280px filter sidebar on the left, product grid on the right
 *  - Filter sections: Availability, Price range, Brand multi-select, Size pills
 *  - Top sort bar above the grid with sort dropdown + total count
 *  - Each card has a Hot badge / wishlist heart / brand kicker / name /
 *    price + MRP / "Add to cart" button — matches the Figma cell.
 *
 * Filtering is currently client-side over the items returned by /products
 * since the backend doesn't yet accept brand[], size[], minPrice/maxPrice
 * params. When those are added the filters can be moved server-side.
 *
 * Non-leaf categories (Shop by Bike, Royal Enfield, etc.) keep the
 * existing subcategory grid path — the filter layout only kicks in when
 * there are actual products to filter.
 */

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Button, Chip, Checkbox, Slider, Input, Spinner,
  Dropdown, DropdownTrigger, DropdownMenu, DropdownItem,
} from '@heroui/react';
import { api, imageUrl, unwrap, envelopeOrLegacy } from '@/lib/api';
import { customerApi } from '@/lib/customerApi';
import { getStoredCustomer } from '@/lib/customerAuth';
import { nameToSlug, slugToName } from '@/lib/categorySlug';
import ProductCard, { type Product } from '@/components/common/ProductCard';
// Custom checkbox built to Figma spec (18px square, 6px radius,
// #1a1410 fill when checked). Replaces HeroUI's Checkbox in the
// filter sidebar — see components/common/FigmaCheckbox.tsx for
// rationale.
import FigmaCheckbox from '@/components/common/FigmaCheckbox';
import RichTextView from '@/components/common/RichTextView';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';

type CategoryNode = {
  _id: string;
  name: string;
  slug?: string;
  icon?: string;
  parent?: string | null;
  isActive: boolean;
  children: CategoryNode[];
  // Admin-authored on-page SEO copy — Top Content replaces the H1 +
  // intro line; Bottom Content renders after the product grid
  // (bottomDescription is sanitised rich-text HTML).
  contentTitle?: string;
  contentDescription?: string;
  bottomTitle?: string;
  bottomDescription?: string;
};

function findNode(nodes: CategoryNode[], target: string): CategoryNode | null {
  for (const n of nodes) {
    if ((n.slug || nameToSlug(n.name)) === target) return n;
    const hit = findNode(n.children || [], target);
    if (hit) return hit;
  }
  return null;
}

/** Build a flat _id → node map from a nested tree. Needed for parent-chain
 *  traversal (we use this to detect the Shop-by-Bike subtree). */
function flattenById(nodes: CategoryNode[], into = new Map<string, CategoryNode>()) {
  for (const n of nodes) {
    into.set(n._id, n);
    flattenById(n.children || [], into);
  }
  return into;
}

/** Walk up the parent chain looking for a "Shop by Bike" ancestor.
 *  When that's true, the subcategories are bike makes/models — show the
 *  decorative tile grid rather than the product-aggregation filter view. */
function isUnderShopByBike(
  node: CategoryNode | null,
  byId: Map<string, CategoryNode>
): boolean {
  if (!node) return false;
  if ((node.slug || '').toLowerCase() === 'shop-by-bike' || node.name === 'Shop by Bike') return true;
  const parentId = typeof node.parent === 'string' ? node.parent : null;
  if (!parentId) return false;
  return isUnderShopByBike(byId.get(parentId) || null, byId);
}

/** Collect every descendant slug under `node` (including the node itself).
 *  Used to fan out /products requests one per category and merge results. */
function collectSlugs(node: CategoryNode | null): string[] {
  if (!node) return [];
  const out: string[] = [];
  const visit = (n: CategoryNode) => {
    if (!n.isActive) return;
    out.push(n.slug || nameToSlug(n.name));
    (n.children || []).forEach(visit);
  };
  visit(node);
  return out;
}

const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'rating', label: 'Top rated' },
];

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

function brandOf(b: Product['brand']): string {
  if (!b) return '';
  return typeof b === 'string' ? b : b.name;
}

function categoryOf(c: Product['category']): string {
  if (!c) return '';
  return typeof c === 'string' ? c : c.name;
}

/** Short, single-line feature/spec text for a card — mirrors the Figma
 *  cell ("ECE 22.06 Certified · Mirror Vi…"). Derived from the product
 *  description (HTML stripped, trimmed) and falling back to brand ·
 *  category when there's no description. */
function featureLine(p: Product): string {
  const raw = (p as any).description as string | undefined;
  const text = raw
    ? String(raw)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
    : '';
  if (text) return text.length > 70 ? `${text.slice(0, 70).trimEnd()}…` : text;
  return [brandOf(p.brand), categoryOf(p.category)].filter(Boolean).join(' · ');
}

/**
 * CategoryPage is used in two places:
 *
 * 1. As the route page at `/<slug>` — Next.js hands
 *    in `params` and the component reads the slug from there.
 *
 * 2. As the products-list template inside admin-managed dynamic pages
 *    (DynamicPage). The dynamic-page caller knows the slug + brand
 *    + custom title + rich intro up-front and passes them via the
 *    `slugOverride`, `titleOverride`, `introNode`, `breadcrumbNode`
 *    and `initialBrandFilter` props — `params` can be a noop promise.
 *
 * Both code paths share the same filter sidebar / facets / grid below,
 * which is the whole reason the dynamic page reuses this component
 * rather than duplicating ~1k lines of UI.
 */
export default function CategoryPage({
  params,
  slugOverride,
  titleOverride,
  descriptionOverride,
  introNode,
  breadcrumbNode,
  initialBrandFilter,
  allProductsMode,
  collectionSlugs,
  hideHeader,
  bottomTitle,
  bottomDescriptionHtml,
  initialItems = [],
  initialTotal,
}: {
  params?: Promise<{ slug: string }>;
  slugOverride?: string;
  titleOverride?: string;
  descriptionOverride?: string;
  introNode?: React.ReactNode;
  breadcrumbNode?: React.ReactNode;
  /** Brand name(s) to pre-tick in the sidebar — a single name or an
   *  array of names (multi-brand dynamic pages). */
  initialBrandFilter?: string | string[];
  /**
   * Suppresses the breadcrumb + title strip the component normally renders.
   * Use this when the caller (a server component) wants to render those
   * pieces itself so they show up in the SSR'd HTML — useful because this
   * component is `'use client'` and gets replaced with the Suspense
   * fallback at static-prerender time, hiding its H1 from view-source.
   */
  hideHeader?: boolean;
  /**
   * `allProductsMode = true` skips the category lookup entirely and
   * fetches the full catalogue. Used by the `/products` route to give
   * the customer a single page with every product + the full filter
   * sidebar (price, all top-level categories, brands, sizes,
   * availability). The Category panel of the sidebar pivots to render
   * top-level categories instead of the current node's subcategories.
   */
  allProductsMode?: boolean;
  /**
   * Collection mode — a curated landing page that aggregates SEVERAL
   * top-level categories (e.g. /riding-gears = Helmets + Riding
   * Jackets + Gloves + …). Behaves like allProductsMode but restricted
   * to the given category slugs: the sidebar's Category panel lists
   * exactly these parents (with their children indented) and the grid
   * pulls each one's subtree from the backend.
   */
  collectionSlugs?: string[];
  /** Bottom Content overrides for listing pages that don't map to a
   *  Category record (e.g. /products fed from its static-meta Page).
   *  Category pages read the same fields off the Category itself. */
  bottomTitle?: string;
  bottomDescriptionHtml?: string;
  // (see prop declaration above for hideHeader)
  // SSR-fetched first page of products. Crawlers / View Source see
  // real product cards in the initial HTML instead of skeletons.
  // The client useEffect below still re-fetches to apply
  // user-selected sort / filter changes.
  initialItems?: Product[];
  initialTotal?: number;
}) {
  // `use()` is fine to call conditionally in React 19 — it's not a
  // regular Hook. We only resolve `params` when the caller actually
  // routed through Next (real Promise reference); the dynamic-page
  // caller passes `slugOverride` instead, sidestepping `use()` so we
  // don't blow up on a freshly-created `Promise.resolve(...)` reference.
  const routeParams = params ? use(params) : null;
  const slug = slugOverride || routeParams?.slug || '';
  const sp = useSearchParams();
  const router = useRouter();
  const sort = sp?.get('sort') || 'newest';
  const q = sp?.get('q') || '';
  // exact=1 → force the original spelling (skip spell-correct retry).
  const exactSearch = sp?.get('exact') === '1';

  const categoryName = titleOverride || slugToName(slug);
  // Spell-corrected query echoed by the backend when the raw search
  // found nothing (e.g. "hemlets" → "helmets"). Shown in the header.
  const [correctedQuery, setCorrectedQuery] = useState<string | null>(null);
  useEffect(() => { setCorrectedQuery(null); }, [q]);
  // Category slugs present in the UNFILTERED search results — captured
  // once per query (before any category checkbox is ticked) so the
  // sidebar's option list stays stable while the user filters. Deriving
  // it from the live `items` made unticked options vanish, because
  // ticking a category narrows the server fetch itself.
  const [searchScopeSlugs, setSearchScopeSlugs] = useState<Set<string> | null>(null);
  useEffect(() => { setSearchScopeSlugs(null); }, [q]);

  const [items, setItems] = useState<Product[]>(initialItems);
  // Loading is false when we already have SSR items — keeps the
  // grid visible during the post-hydration refetch.
  const [loading, setLoading] = useState<boolean>(initialItems.length === 0);
  const [total, setTotal] = useState<number>(
    typeof initialTotal === 'number' ? initialTotal : initialItems.length,
  );

  // Category tree (for subcategory grid on non-leaf categories).
  // `treeLoaded` flips to true once the /categories request settles
  // (success OR failure). The product-fetch effect below blocks until
  // that point, so we don't kick off TWO product requests (one with the
  // bare slug, then a second with the resolved subtree) which used to
  // make the spinner flash twice on first load.
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [treeLoaded, setTreeLoaded] = useState(false);
  useEffect(() => {
    api
      .get('/categories').then(envelopeOrLegacy)
      .then(({ data }) => setTree(data.tree || []))
      .catch(() => setTree([]))
      .finally(() => setTreeLoaded(true));
  }, []);

  // Wishlisted product IDs — fetched once on mount so the heart icons
  // can be pre-filled when the customer reloads the page. Skipped when
  // no customer is signed in (the /wishlist call would 401 anyway).
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!getStoredCustomer()) return;
    customerApi
      .get('/wishlist')
      .then((r) => {
        const products = unwrap<{ wishlist?: { products?: any[] } }>(r).wishlist?.products || [];
        // The /wishlist endpoint returns populated product docs, so we
        // extract the IDs. Some shapes return raw ObjectIDs — handle both.
        const ids = products.map((p: any) =>
          typeof p === 'string' ? p : p?._id
        ).filter(Boolean);
        setWishlistIds(new Set<string>(ids));
      })
      .catch(() => {
        // Silent failure — worst case the hearts start outlined, and a
        // re-add returns "already saved" from the backend which we treat
        // as a no-op below.
      });
  }, []);

  const byId = useMemo(() => flattenById(tree), [tree]);
  const currentNode = useMemo(() => findNode(tree, slug), [tree, slug]);
  // Category filter slot.
  //  - single-category mode: the current node's direct children
  //    (subcategories of "Helmets & Accessories", etc.).
  //  - all-products mode: a *flat* walk of the full tree minus the
  //    Shop-by-Bike subtree (bike makes/models aren't useful as
  //    catalogue filters). Each node carries a `_depth` so the UI can
  //    indent subcategories under their parents.
  const subcategories = useMemo(() => {
    // Collection mode: list exactly the curated parent categories (in
    // the order given) with their children indented underneath.
    if (collectionSlugs?.length) {
      const out: Array<CategoryNode & { _depth: number }> = [];
      const visit = (nodes: CategoryNode[], depth: number) => {
        for (const n of nodes) {
          if (!n.isActive) continue;
          out.push({ ...n, _depth: depth });
          if (n.children?.length) visit(n.children, depth + 1);
        }
      };
      for (const s of collectionSlugs) {
        const node = findNode(tree, s);
        if (node && node.isActive) {
          out.push({ ...node, _depth: 0 });
          if (node.children?.length) visit(node.children, 1);
        }
      }
      return out;
    }
    if (allProductsMode) {
      // Flatten tree with depth; skip Shop by Bike + every descendant.
      // Top level is ordered rider-gear-first (same priority as the
      // navbar menus) so the most-shopped categories lead the list.
      const GEAR_FIRST = [
        'riding-jackets', 'helmets', 'riding-gloves', 'riding-boots',
        'riding-pants', 'riding-suits', 'protection-gear', 'rain-gear',
      ];
      const rank = (n: CategoryNode) => {
        const i = GEAR_FIRST.indexOf((n.slug || '').toLowerCase());
        return i === -1 ? GEAR_FIRST.length : i;
      };
      const orderedRoots = [...tree].sort((a, b) => rank(a) - rank(b));
      const out: Array<CategoryNode & { _depth: number }> = [];
      const visit = (nodes: CategoryNode[], depth: number) => {
        for (const n of nodes) {
          if (!n.isActive) continue;
          const isShopByBike =
            (n.slug || '').toLowerCase() === 'shop-by-bike' ||
            n.name === 'Shop by Bike';
          if (isShopByBike) continue; // skip node AND its subtree
          out.push({ ...n, _depth: depth });
          if (n.children?.length) visit(n.children, depth + 1);
        }
      };
      visit(orderedRoots, 0);
      return out;
    }
    return (currentNode?.children || [])
      .filter((c) => c.isActive)
      .map((c) => ({ ...c, _depth: 0 }));
  }, [allProductsMode, collectionSlugs, currentNode, tree]);
  const hasSubcategories = subcategories.length > 0;
  // Search-scoped Category filter — when the grid is showing SEARCH
  // results, only offer the categories the matching products actually
  // belong to (parents kept so the hierarchy still reads). A
  // "gloves" search shouldn't list Riding Jackets as a filter option.
  // Uses the scope snapshot captured from the UNFILTERED results so
  // ticking a category doesn't hide its sibling options.
  const sidebarSubcategories = useMemo(() => {
    if (!q || !searchScopeSlugs || searchScopeSlugs.size === 0) return subcategories;
    const subtreeHas = (n: CategoryNode): boolean =>
      (!!n.slug && searchScopeSlugs.has(n.slug)) ||
      (n.children || []).some(subtreeHas);
    return subcategories.filter(subtreeHas);
  }, [subcategories, searchScopeSlugs, q]);
  // The Shop-by-Bike subtree keeps the decorative tile grid — for every
  // other parent category we aggregate descendants and show the filter
  // sidebar + product grid layout.
  const isBikeBrowse = useMemo(
    () => isUnderShopByBike(currentNode, byId),
    [currentNode, byId]
  );

  // Filter state — kept in component state for now. URL persistence can
  // come later once the backend accepts these as query params.
  const [inStockOnly, setInStockOnly] = useState(false);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 50000]);
  // Tracks whether the customer has actually touched the price slider /
  // min-max inputs. Until they do, the sync effect below is free to
  // resize the bounds to fit the real catalogue range. Once true the
  // user's chosen bounds are sticky — even if facets shift, we don't
  // yank the slider out from under them.
  const [priceTouched, setPriceTouched] = useState(false);
  // `initialBrandFilter` lets the dynamic-page caller pre-tick a brand —
  // e.g. an admin's "LS2 Helmet in Noida" page comes in with the LS2
  // brand pre-selected so the grid only renders LS2 products.
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(
    () => new Set(
      Array.isArray(initialBrandFilter)
        ? initialBrandFilter.filter(Boolean)
        : initialBrandFilter
          ? [initialBrandFilter]
          : []
    )
  );
  const [selectedSizes, setSelectedSizes] = useState<Set<string>>(new Set());
  // Subcategory filter — the child category slugs the user has ticked.
  // Empty set means "all subcategories shown".
  const [selectedSubs, setSelectedSubs] = useState<Set<string>>(new Set());
  // Free-text filter inside the Brand panel — narrows the visible
  // brand checkboxes as the customer types. Doesn't affect which
  // brands are selected, just which are rendered.
  const [brandQuery, setBrandQuery] = useState('');
  // Same idea for the Category panel — useful on /products where the
  // flat list spans every catalogue category.
  const [categoryQuery, setCategoryQuery] = useState('');

  // ── Filter persistence in the URL ────────────────────────────────
  // Applied filters are mirrored into the query string (?subs=…&brands=…
  // &sizes=…&instock=1&pmin=…&pmax=…) so a reload — or a shared link —
  // restores them. Restore runs ONCE on mount; the mirror effect below
  // only starts writing after the restore has run.
  const urlSyncReadyRef = useRef(false);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const list = (k: string) =>
        (q.get(k) || '').split(',').map((s) => decodeURIComponent(s)).filter(Boolean);
      const subs = list('subs');
      const brands = list('brands');
      const sizes = list('sizes');
      if (subs.length) setSelectedSubs(new Set(subs));
      if (brands.length) setSelectedBrands(new Set(brands));
      if (sizes.length) setSelectedSizes(new Set(sizes));
      if (q.get('instock') === '1') setInStockOnly(true);
      if (q.has('pmin') || q.has('pmax')) {
        const pmin = Number(q.get('pmin'));
        const pmax = Number(q.get('pmax'));
        setPriceRange([
          Number.isFinite(pmin) && pmin >= 0 ? pmin : 0,
          Number.isFinite(pmax) && pmax > 0 ? pmax : 50000,
        ]);
        // Mark as touched so the facet-sync effect doesn't overwrite
        // the restored bounds once the catalogue range resolves.
        setPriceTouched(true);
      }
    } catch { /* malformed query — ignore */ }
    urlSyncReadyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!urlSyncReadyRef.current) return;
    try {
      const q = new URLSearchParams(window.location.search);
      const setOrDel = (k: string, v: string) => { if (v) q.set(k, v); else q.delete(k); };
      const enc = (set: Set<string>) => [...set].map(encodeURIComponent).join(',');
      setOrDel('subs', enc(selectedSubs));
      setOrDel('brands', enc(selectedBrands));
      setOrDel('sizes', enc(selectedSizes));
      setOrDel('instock', inStockOnly ? '1' : '');
      if (priceTouched) {
        q.set('pmin', String(priceRange[0]));
        q.set('pmax', String(priceRange[1]));
      } else {
        q.delete('pmin');
        q.delete('pmax');
      }
      const qs = q.toString();
      // history.replaceState (not router.replace) — updates the URL
      // without triggering a Next.js navigation/re-render per checkbox.
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    } catch { /* ignore */ }
  }, [selectedSubs, selectedBrands, selectedSizes, inStockOnly, priceRange, priceTouched]);

  // Mobile drawer toggle for the filter sidebar.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // True once the first products fetch has settled — refetches caused
  // by filter toggles then skip the full-page skeleton (which would
  // flash the whole layout on every checkbox tick).
  const firstLoadDoneRef = useRef(false);

  // Any filter change scrolls the viewport back to the top of the
  // results (Myntra-style). Without this, filtering while scrolled deep
  // strands the user near the footer of the (now much shorter) page
  // with the sidebar out of view above them.
  //
  // Deliberately INSTANT, not smooth: when the filtered list is small
  // the document collapses while a smooth scroll is still animating,
  // and Chrome cancels the animation mid-flight — leaving the user
  // stranded at the clamped bottom anyway. An instant jump can't be
  // cancelled. No scroll-position guard either, for the same reason:
  // by the time this effect reads scrollY it may already be clamped
  // small; scrolling to 0 from anywhere is always safe.
  useEffect(() => {
    if (!firstLoadDoneRef.current) return;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [selectedSubs, selectedBrands, selectedSizes, inStockOnly, priceRange]);

  useEffect(() => {
    // Wait for the category tree before deciding whether to fetch products.
    // Without this guard the effect fires once with `currentNode = null`
    // (bare-slug query) and again once the tree resolves, causing the
    // loading spinner to flash twice and double-spending an API call.
    if (!treeLoaded) return;

    // For the bike-browse subtree we don't need products — the tile grid
    // renders without them. Skip the network round-trip.
    if (isBikeBrowse && hasSubcategories) {
      setLoading(false);
      setItems([]);
      setTotal(0);
      return;
    }

    // Decide which slugs to query. If the current node has children we
    // aggregate from the whole subtree (e.g. "Helmets And Accessories"
    // pulls from Full Face / Half Face / Offroad / Accessories / Rider
    // Tech). For a true leaf we just query the leaf's slug. In
    // `allProductsMode` we skip the category param entirely and pull
    // the full catalogue in a single request.
    // In all-products mode, ticked category checkboxes become SERVER
    // queries (one per ticked slug — the backend expands descendants).
    // Filtering them client-side against the capped product list broke
    // badly: with a large catalogue the newest-N fetch simply didn't
    // contain most categories' products, so ticking e.g. "Helmets"
    // rendered an empty grid even though helmets exist.
    const slugsToQuery: (string | null)[] = collectionSlugs?.length
      // Collection mode: ticked categories narrow the query; otherwise
      // fetch every curated parent (backend expands descendants).
      ? selectedSubs.size > 0
        ? Array.from(selectedSubs)
        : collectionSlugs
      : allProductsMode
        ? selectedSubs.size > 0
          ? Array.from(selectedSubs)
          : [null] // single fetch with no category param
        : currentNode
          ? collectSlugs(currentNode)
          : [slug];

    // Always mark loading = true while a client fetch is in flight.
    // The full-page skeleton (see render below) hides the entire
    // sidebar+grid until this settles, so no piecemeal reveal happens.
    setLoading(true);
    // Catalog / marketplace refactor was reverted (commit d49860e) —
    // fall back to the plain `/products` list endpoint, which returns
    // full product docs (price already discount-decorated by the
    // Phase-2 resolveOffers middleware). No lowestPrice/offersCount
    // aggregation needed; product.price is the shopper-facing price
    // straight from the backend.
    Promise.all(
      slugsToQuery.map((s) =>
        api
          .get('/products', {
            params: {
              // null skips the category filter entirely (all-products
              // mode). Empty-string would 0-out the results because the
              // backend tries to resolve "" as a category and fails.
              ...(s === null ? {} : { category: s }),
              q: q || undefined,
              // exact=1 forces the original spelling (no spell-correct
              // retry) — set by the "Search instead for …" link.
              exact: exactSearch ? '1' : undefined,
              sort: sort || 'newest',
              // 300 (was 96) so the client-side brand/size/price facets
              // see (practically) the whole catalogue instead of only
              // the newest slice of it.
              limit: 300,
            },
          }).then(envelopeOrLegacy)
          .then(({ data }) => {
            // Spell-corrected search — the backend retried a fixed
            // query ("hemlets" → "helmets") when the raw one had no
            // hits. Surface it so the header can say so.
            if (data.correctedQuery) setCorrectedQuery(String(data.correctedQuery));
            return ((data.items as any[]) || []) as Product[];
          })
          .catch(() => [])
      )
    )
      .then((lists) => {
        // De-duplicate by _id — a product mis-tagged on two categories
        // would otherwise show up twice in the merged grid.
        const merged = new Map<string, Product>();
        for (const list of lists) {
          for (const p of list) merged.set(p._id, p);
        }
        const arr = Array.from(merged.values());

        // Apply the chosen sort on the merged list (each per-category
        // request was sorted independently, so a merge breaks the order).
        if (sort === 'price_asc') arr.sort((a, b) => a.price - b.price);
        else if (sort === 'price_desc') arr.sort((a, b) => b.price - a.price);
        else if (sort === 'rating')
          arr.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
        // 'newest' relies on backend order; without createdAt we leave
        // the natural API order.

        setItems(arr);
        setTotal(arr.length);
        // Capture the search's category scope from the UNFILTERED
        // response (no category checkboxes ticked). Later filtered
        // fetches leave the snapshot alone so sidebar options persist.
        if (q && selectedSubs.size === 0) {
          const present = new Set<string>();
          for (const p of arr) {
            const c = (p as any).category;
            if (c && typeof c === 'object' && c.slug) present.add(c.slug);
          }
          setSearchScopeSlugs(present);
        }
        // Price range gets synced separately from the facets effect
        // below — keeping it there avoids two places fighting over the
        // same state.
      })
      .finally(() => {
        setLoading(false);
        firstLoadDoneRef.current = true;
      });
    // selectedSubs is a Set — every toggle creates a fresh instance, so
    // ticking/unticking a category checkbox re-runs the fetch.
  }, [slug, q, exactSearch, sort, currentNode, isBikeBrowse, hasSubcategories, treeLoaded, allProductsMode, collectionSlugs, selectedSubs]);

  // Facet derivation — unique brands and sizes seen across the items.
  // The slider always starts at ₹0 (customers expect the lower bound to
  // be zero so they can use the slider as a "max price" filter). The
  // upper bound is the most expensive product in the category, rounded
  // up to a nice 100 so the readout doesn't show ₹8,947 etc.
  const facets = useMemo(() => {
    const brands = new Map<string, number>();
    const sizes = new Map<string, number>();
    let priceHi = 0;
    for (const p of items) {
      const b = brandOf(p.brand);
      if (b) brands.set(b, (brands.get(b) || 0) + 1);
      (p.sizes || []).forEach((s) => sizes.set(s, (sizes.get(s) || 0) + 1));
      if (p.price > priceHi) priceHi = p.price;
    }
    // Always anchor the slider at 0. When there are no products, give
    // it a sensible 0–100,000 range so HeroUI doesn't degenerate.
    const lo = 0;
    let hi = priceHi > 0 ? Math.ceil(priceHi / 100) * 100 : 100000;
    if (hi <= lo) hi = 100; // last-line defence — never let lo===hi.
    return {
      brands: [...brands.entries()].sort((a, b) => b[1] - a[1]),
      sizes: [...sizes.entries()].sort(),
      priceLo: lo,
      priceHi: hi,
    };
  }, [items]);

  // Re-sync the slider's value when the facet bounds change (initial
  // load, when filters narrow the available range, etc.).
  //
  // Two distinct behaviours depending on whether the customer has
  // touched the slider:
  //   • Untouched → snap to the facet bounds exactly. This catches
  //     the case where the hard-coded initial [0, 50000] would have
  //     hidden a category's only product because its price is above
  //     50,000 (e.g. a Z 900 exhaust). Without this, the page lies
  //     to the user with "Showing 0 of 1 product" and a Filters: 1
  //     badge for a filter they never set.
  //   • Touched   → only clamp inward to keep the user's bounds
  //     inside the new facet range. Never widen against their will.
  useEffect(() => {
    setPriceRange(([curLo, curHi]) => {
      if (!priceTouched) {
        return [facets.priceLo, facets.priceHi];
      }
      const lo = curLo < facets.priceLo || curLo > facets.priceHi ? facets.priceLo : curLo;
      const hi = curHi > facets.priceHi || curHi < facets.priceLo ? facets.priceHi : curHi;
      return [lo, hi];
    });
    // We deliberately depend ONLY on the bounds + touched flag,
    // not on the current value, otherwise this becomes a feedback
    // loop with the slider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facets.priceLo, facets.priceHi, priceTouched]);

  // Client-side filter pass — keeps the UI snappy while the backend
  // catches up to multi-facet querying.
  const filtered = useMemo(() => {
    // Expand each ticked category slug to include every descendant slug
    // so checking a parent ("Motorcycle Accessories") also matches
    // products that live in its children ("Crash Guard", "Bike
    // Protection", …). Without this, ticking a parent always renders
    // an empty grid because product.category.slug is always the leaf.
    const expandedSlugs = (() => {
      if (selectedSubs.size === 0) return new Set<string>();
      const out = new Set<string>();
      const addSubtree = (node: CategoryNode | null) => {
        if (!node) return;
        const s = node.slug || nameToSlug(node.name);
        if (s) out.add(s);
        (node.children || []).forEach(addSubtree);
      };
      for (const s of selectedSubs) {
        out.add(s); // always include the ticked slug itself
        const node = findNode(tree, s);
        if (node) addSubtree(node);
      }
      return out;
    })();

    return items.filter((p) => {
      // Availability: default shows everything (including out of stock);
      // "In Stock Only" narrows to products with positive stock.
      if (inStockOnly && (p.stock ?? 0) <= 0) return false;
      if (p.price < priceRange[0] || p.price > priceRange[1]) return false;
      if (selectedBrands.size && !selectedBrands.has(brandOf(p.brand))) return false;
      if (selectedSizes.size) {
        const has = (p.sizes || []).some((s) => selectedSizes.has(s));
        if (!has) return false;
      }
      // Category filter — compare against the product's category slug
      // PLUS every descendant of the ticked slug (so parent selections
      // include all subcategory products).
      if (expandedSlugs.size) {
        const c = (p as any).category;
        const catSlug = typeof c === 'object' && c
          ? (c.slug || nameToSlug(c.name || ''))
          : null;
        if (!catSlug || !expandedSlugs.has(catSlug)) return false;
      }
      return true;
    });
  }, [items, inStockOnly, priceRange, selectedBrands, selectedSizes, selectedSubs, tree]);

  const activeFilterCount =
    (inStockOnly ? 1 : 0) +
    selectedBrands.size +
    selectedSizes.size +
    selectedSubs.size +
    (priceRange[0] !== facets.priceLo || priceRange[1] !== facets.priceHi ? 1 : 0);

  function clearAll() {
    setInStockOnly(false);
    setSelectedBrands(new Set());
    setSelectedSizes(new Set());
    setSelectedSubs(new Set());
    setPriceTouched(false);
    setPriceRange([facets.priceLo, facets.priceHi]);
  }

  function toggleBrand(b: string) {
    setSelectedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });
  }
  function toggleSize(s: string) {
    setSelectedSizes((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }
  function toggleSub(s: string) {
    setSelectedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  // BIKE-BROWSE TILE GRID — only the Shop-by-Bike subtree gets the
  // decorative tile view. For "Helmets and Accessories" and every other
  // parent category, we aggregate descendants into the filter+grid
  // layout below.
  if (isBikeBrowse && hasSubcategories) {
    return (
      <SubcategoryView
        categoryName={categoryName}
        subcategories={subcategories}
        slug={slug}
        items={items}
        loading={loading}
      />
    );
  }

  // Full-page skeleton — shown until BOTH the categories tree has
  // loaded AND the current products fetch has settled. Renders the
  // exact grid layout (breadcrumb + filter sidebar + product grid) so
  // the skeleton doesn't shift when the real content appears. Removes
  // the piecemeal reveal (tree first, then filters, then price range
  // resnap, then grid) that made refreshes feel like 2-3 loads.
  const showSkeleton = (loading && !firstLoadDoneRef.current) || !treeLoaded;
  if (showSkeleton) {
    return (
      <div className="bg-white min-h-full">
        {/* Breadcrumb strip — render the REAL nav even on the skeleton pass
          so search engines and view-source see the trail on the initial
          HTML. `categoryName` is derived from the slug at line 211 and is
          SSR-safe (no client-only data needed). */}
        {!hideHeader && (
          <div className="border-b border-[#eeeeee] bg-white">
            <div className="container py-3">
              {breadcrumbNode ?? (
                <nav className="flex items-center gap-1 font-poppins text-[14px] font-medium leading-none">
                  <Link href="/" className="text-[#7e746e] hover:text-[#1a1410] transition">
                    Home
                  </Link>
                  <span className="text-[#7e746e] mx-1" aria-hidden>/</span>
                  <span className="text-[#1a1410]">{categoryName}</span>
                </nav>
              )}
            </div>
          </div>
        )}
        <div className="container py-8">
          <div className="grid lg:grid-cols-[236px_minmax(0,1fr)] gap-5 lg:gap-6">
            {/* Filter sidebar skeleton */}
            <aside className="hidden lg:block">
              <div className="lg:pr-6 space-y-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="border-b border-[#eaeaea] pb-4">
                    <div className="h-4 w-24 rounded bg-[#f3f4f2] animate-pulse mb-3" />
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, j) => (
                        <div key={j} className="flex items-center gap-3">
                          <div className="w-5 h-5 rounded bg-[#f3f4f2] animate-pulse" />
                          <div className="h-3 w-32 rounded bg-[#f3f4f2] animate-pulse" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </aside>
            {/* Products grid skeleton */}
            <main className="min-w-0">
              {/* Render the REAL header (h1 + subtitle) on the skeleton
                pass — SSR emits it into initial HTML so Google, view-source,
                and screen readers pick it up before the client-side
                categories tree resolves. Only the grid tiles below stay as
                animated placeholders. */}
              {/* MUST stay visually identical to the loaded header
                  further down this file — same tag, same classes, same
                  inline styles, same fallback chain. It isn't a
                  placeholder: it renders the REAL copy, then gets
                  replaced by the loaded header once the category tree
                  resolves. Any difference between the two shows up as a
                  flash a couple of seconds into the page.

                  It previously set the subtitle to 18px/1.52 while the
                  loaded header used 15px/1.6, so the intro visibly
                  shrank mid-load, and the h1 ignored `titleOverride` so
                  curated pages briefly showed the wrong heading. */}
              {!hideHeader && (
                <header className="mb-10 font-poppins">
                  <h1
                    className="font-poppins font-semibold"
                    style={{
                      fontSize: '24px',
                      lineHeight: 1.52,
                      color: '#1a1410',
                    }}
                  >
                    {titleOverride || categoryName}
                  </h1>
                  <p
                    className="font-poppins mt-2 max-w-full"
                    style={{ fontSize: '15px', lineHeight: 1.6, color: '#424242' }}
                  >
                    {descriptionOverride ?? 'Curated products from verified sellers.'}
                  </p>
                </header>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-5 gap-y-8">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i}>
                    <div className="aspect-square rounded-xl bg-[#f3f4f2] animate-pulse" />
                    <div className="mt-3 h-4 w-3/4 rounded bg-[#f3f4f2] animate-pulse" />
                    <div className="mt-2 h-4 w-1/3 rounded bg-[#f3f4f2] animate-pulse" />
                    <div className="mt-2 h-3 w-full rounded bg-[#f3f4f2] animate-pulse" />
                  </div>
                ))}
              </div>
            </main>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white min-h-full">
      {/* Breadcrumb strip — Figma node 3035:7194. Full-width bar with a
        1px #eee bottom border, 40px tall, Poppins Medium 14px. "Home"
        + separator are tertiary #7e746e; the current page label is
        primary #1a1410. Renders only when the caller hasn't disabled
        the header chrome and hasn't supplied a custom breadcrumbNode. */}
      {!hideHeader && (
        <div className="border-b border-[#eeeeee] bg-white">
          <div className="container py-3">
            {breadcrumbNode ?? (
              <nav className="flex items-center gap-1 font-poppins text-[14px] font-medium leading-none">
                <Link href="/" className="text-[#7e746e] hover:text-[#1a1410] transition">
                  Home
                </Link>
                <span className="text-[#7e746e] mx-1" aria-hidden>/</span>
                <span className="text-[#1a1410]">{categoryName}</span>
              </nav>
            )}
          </div>
        </div>
      )}
      {/* No outer padding — keeps the filter sidebar flush with the
        breadcrumb strip's bottom border so the right divider has no
        gap. Vertical breathing room (py-8) is applied only on the
        right `<main>` so the products column gets 32px top + bottom
        without pushing the sidebar down. */}
      <div className="container">


        {/* Optional intro from the dynamic page's rich-text body — sits
          above the filter sidebar / grid so admins can write a real
          opening paragraph, link to related pages, etc. */}
        {introNode && (
          <div className="mb-6">
            {introNode}
          </div>
        )}


        {/* MAIN GRID — sidebar + content. Sidebar fixed at 260px wide
          (matches the Figma spec), 16px (p-4) inner padding. */}
        <div className="grid lg:grid-cols-[260px_minmax(0,1fr)] gap-5 lg:gap-8 font-poppins">
          {/* Mobile filter trigger */}
          <div className="lg:hidden flex items-center justify-between gap-3 bg-white border border-default-200 rounded-xl px-3 py-2.5 mt-10">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand-black"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-1 bg-[#aad900] text-[#1a1410] text-[10px] font-bold rounded-full w-5 h-5 grid place-items-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <span className="text-xs text-default-600">
              {filtered.length} of {items.length} items
            </span>
          </div>

          {/* FILTER SIDEBAR — desktop sticky, mobile slide-out drawer.
            On lg+ the column gets `bg-white`, no radius, and a 1px
            `#EEE` right border per Figma spec (background-default /
            border-default tokens) so the sidebar reads as a divided
            column rather than a floating panel. */}
          <aside
            className={`lg:block lg:bg-white lg:rounded-none lg:border-r lg:border-[#EEE] lg:self-stretch lg:min-h-full ${filtersOpen
              ? 'fixed inset-y-0 left-0 z-50 w-80 max-w-[85vw] bg-white shadow-2xl overflow-y-auto lg:relative lg:w-auto lg:max-w-none lg:shadow-none lg:overflow-visible lg:z-auto'
              : 'hidden'
              }`}
          >
            {/* Figma sidebar — plain white column per node 3139:2359.
              No gray panel, no rounded background, no count badge. Width
              ~236px, sticky on lg+, section dividers in #EAEAEA. Right
              padding gives content breathing room before the column's
              right divider line. */}
            <div className="lg:sticky lg:top-[77px] w-full lg:max-w-[260px] p-4 font-poppins">
              {/* Header — "Filters" label (tertiary gray, SemiBold), "Clear
                All" as an underlined text link in top-right. */}
              <div className="flex items-center justify-between gap-2 pb-3">
                <span
                  className="font-poppins font-semibold"
                  style={{ fontSize: 14, color: '#9e9e9e' }}
                >
                  Filters
                </span>
                {/* "Clear All" — always mounted, opacity-toggled based on
                  filter state so the show/hide fades smoothly instead
                  of popping in via display:block/none. When no filter
                  is active, `opacity-0 pointer-events-none` hides it
                  visually and blocks clicks; the moment a filter is
                  ticked, opacity animates back to 1.

                  Typography per Figma: `Action/Action S` (Poppins
                  Regular 12px, line-height 140%, color #212121). The
                  underline is a rounded 1.5px pill (bg #BDBDBD)
                  rendered as an absolutely-positioned span so its
                  `border-radius` can take effect — a native
                  `text-decoration: underline` can't round its
                  endpoints. On hover, a second dark bar overlays the
                  gray one and animates its width from 0 → 100%
                  left-to-right for a subtle sweep effect. */}
                <button
                  type="button"
                  onClick={clearAll}
                  aria-hidden={activeFilterCount === 0}
                  tabIndex={activeFilterCount === 0 ? -1 : 0}
                  className={`relative inline-block group font-poppins pb-[6px] outline-none focus:outline-none transition-opacity duration-200 ${activeFilterCount > 0
                    ? 'opacity-100'
                    : 'opacity-0 pointer-events-none'
                    }`}
                  style={{
                    color: '#212121',
                    fontSize: 12,
                    fontWeight: 400,
                    lineHeight: '140%',
                  }}
                >
                  Clear All
                  {/* Base underline — always visible, #BDBDBD gray */}
                  <span
                    aria-hidden
                    className="absolute left-0 right-0 bottom-0 h-[1.5px] rounded-lg"
                    style={{ background: '#BDBDBD' }}
                  />
                  {/* Hover overlay — dark bar that expands left→right
                    on hover to visually replace the gray bar. */}
                  <span
                    aria-hidden
                    className="absolute left-0 bottom-0 h-[1.5px] w-0 rounded-lg transition-[width] duration-300 ease-out group-hover:w-full"
                    style={{ background: '#212121' }}
                  />
                </button>
              </div>

              {/* Availability — single "In Stock Only" toggle. Default
                  (unchecked) shows EVERYTHING including out-of-stock;
                  checked narrows to in-stock products. */}
              <FilterSection title="Availability">
                <FigmaCheckbox checked={inStockOnly} onChange={setInStockOnly}>
                  In Stock Only
                </FigmaCheckbox>
              </FilterSection>

              {/* Category panel.
                  - On a single-category page, lists that category's
                    direct children (Full Face / Half Face / Offroad /
                    Accessories / Rider Tech).
                  - On /products (allProductsMode), lists every
                    category in the tree (excluding Shop-by-Bike) with
                    a search input + nested indent so subcategories
                    read as a hierarchy. */}
              {sidebarSubcategories.length > 0 && (
                <FilterSection title="Category">
                  {(allProductsMode || !!collectionSlugs?.length) && (
                    <Input
                      size="sm"
                      variant="bordered"
                      placeholder="Search category"
                      value={categoryQuery}
                      onValueChange={setCategoryQuery}
                      isClearable
                      onClear={() => setCategoryQuery('')}
                      startContent={
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-default-500 shrink-0">
                          <circle cx="11" cy="11" r="8" />
                          <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                      }
                      classNames={{
                        inputWrapper:
                          'h-9 bg-white border border-default-200 data-[hover=true]:border-default-400 group-data-[focus=true]:border-brand-black rounded-lg',
                        input: 'text-sm',
                      }}
                    />
                  )}
                  {(() => {
                    // Filter the rendered list by typed query. Comparison
                    // is case-insensitive and matches against the
                    // displayed category name.
                    const q = categoryQuery.trim().toLowerCase();
                    const visible = q
                      ? sidebarSubcategories.filter((s) => s.name.toLowerCase().includes(q))
                      : sidebarSubcategories;
                    if (visible.length === 0) {
                      return (
                        <div className="text-xs text-default-500 italic py-1">
                          No categories match &ldquo;{categoryQuery}&rdquo;.
                        </div>
                      );
                    }
                    return (
                      <div
                        // `relative` is load-bearing: the checkbox rows hide
                        // their native <input> with sr-only (absolute
                        // positioning). Without a positioned scroll parent
                        // those inputs anchor to the sticky sidebar box
                        // thousands of px down, inflating its scrollHeight —
                        // which rendered a giant phantom scrollbar + blank
                        // space under the filters.
                        className={`relative flex flex-col gap-3 ${visible.length > 12
                          ? 'max-h-56 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-default-300 [&::-webkit-scrollbar-thumb]:rounded-full'
                          : ''
                          }`}
                      >
                        {visible.map((sub) => {
                          const subSlug = sub.slug || nameToSlug(sub.name);
                          // Count includes this row's slug PLUS every
                          // descendant, so a parent row shows the rollup
                          // total (e.g. "Motorcycle Accessories" reads as
                          // 1 when Crash Guard has 1, matching what the
                          // filter would actually show if ticked).
                          const subtreeSlugs = (() => {
                            const set = new Set<string>([subSlug]);
                            const visit = (n: CategoryNode | null) => {
                              if (!n) return;
                              const s = n.slug || nameToSlug(n.name);
                              if (s) set.add(s);
                              (n.children || []).forEach(visit);
                            };
                            visit(findNode(tree, subSlug));
                            return set;
                          })();
                          const count = items.filter((p) => {
                            const c = (p as any).category;
                            const s = typeof c === 'object' && c
                              ? (c.slug || nameToSlug(c.name || ''))
                              : null;
                            return !!s && subtreeSlugs.has(s);
                          }).length;
                          const depth = (sub as any)._depth ?? 0;

                          return (
                            <div
                              key={sub._id}
                              className="flex items-center gap-1"
                              // Indent subcategories so the hierarchy is
                              // visually readable. 14px per depth keeps
                              // the labels legible at narrow widths.
                              style={depth > 0 ? { paddingLeft: depth * 14 } : undefined}
                            >
                              <FigmaCheckbox
                                checked={selectedSubs.has(subSlug)}
                                onChange={() => toggleSub(subSlug)}
                                className="flex-1 min-w-0"
                              >
                                {sub.name}
                              </FigmaCheckbox>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </FilterSection>
              )}

              {/* Price */}
              <FilterSection title="Price">
                {/* Min / Max input pair sits ABOVE the slider with their
                  labels centered, matching the Figma layout. Each input
                  is a rounded-full pill; the slider underneath drives
                  the same priceRange state. */}
                <div className="grid grid-cols-2 gap-3 mt-1">
                  <div className="flex flex-col items-center">
                    <label className="text-[11px] text-default-600 mb-1">
                      Min
                    </label>
                    <Input labelPlacement="outside"
                      size="sm"
                      variant="bordered"
                      type="number"
                      aria-label="Minimum price"
                      value={String(priceRange[0])}
                      onChange={(e) => {
                        const v = Math.max(facets.priceLo, Number(e.target.value) || 0);
                        setPriceRange([Math.min(v, priceRange[1]), priceRange[1]]);
                        setPriceTouched(true);
                      }}
                      startContent={<span className="text-xs text-default-500">₹</span>}
                      classNames={{
                        base: 'w-full',
                        inputWrapper:
                          'h-9 bg-white border border-default-200 data-[hover=true]:border-default-400 group-data-[focus=true]:border-brand-black rounded-full justify-center',
                        input: 'text-center text-sm tabular-nums',
                      }}
                    />
                  </div>
                  <div className="flex flex-col items-center">
                    <label className="text-[11px] text-default-600 mb-1">
                      Max
                    </label>
                    <Input labelPlacement="outside"
                      size="sm"
                      variant="bordered"
                      type="number"
                      aria-label="Maximum price"
                      value={String(priceRange[1])}
                      onChange={(e) => {
                        const v = Math.min(facets.priceHi, Number(e.target.value) || 0);
                        setPriceRange([priceRange[0], Math.max(v, priceRange[0])]);
                        setPriceTouched(true);
                      }}
                      startContent={<span className="text-xs text-default-500">₹</span>}
                      classNames={{
                        base: 'w-full',
                        inputWrapper:
                          'h-9 bg-white border border-default-200 data-[hover=true]:border-default-400 group-data-[focus=true]:border-brand-black rounded-full justify-center',
                        input: 'text-center text-sm tabular-nums',
                      }}
                    />
                  </div>
                </div>
                {/* HeroUI Slider in range mode — sits below the inputs.
                  Explicit width / 100% on the track and a black filler
                  so the rail is visible against the white sidebar. */}
                <Slider
                  size="sm"
                  step={100}
                  minValue={facets.priceLo}
                  maxValue={facets.priceHi}
                  value={priceRange}
                  onChange={(v) => {
                    setPriceRange(v as [number, number]);
                    setPriceTouched(true);
                  }}
                  className="w-full mt-3"
                  showTooltip
                  classNames={{
                    base: 'gap-2',
                    track: 'bg-default-200 h-1.5',
                    filler: 'bg-brand-black',
                    thumb: [
                      'bg-brand-black border-2 border-brand-black shadow-md',
                      'data-[dragging=true]:shadow-lg data-[dragging=true]:scale-110',
                    ].join(' '),
                  }}
                  aria-label="Price range"
                />
              </FilterSection>

              {/* Brand */}
              {facets.brands.length > 0 && (
                <FilterSection title="Brand" defaultExpanded={false}>
                  {/* Inline search — narrows the visible brand list to
                    matches of the typed query. Useful once the brand
                    list grows past ~10 entries; harmless when it
                    doesn't. The query is purely visual — it doesn't
                    deselect anything the customer has already ticked. */}
                  <Input
                    size="sm"
                    variant="bordered"
                    placeholder="Search brand"
                    value={brandQuery}
                    onValueChange={setBrandQuery}
                    isClearable
                    onClear={() => setBrandQuery('')}
                    startContent={
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-default-500 shrink-0">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                    }
                    classNames={{
                      inputWrapper:
                        'h-9 bg-white border border-default-200 data-[hover=true]:border-default-400 group-data-[focus=true]:border-brand-black rounded-lg',
                      input: 'text-sm',
                    }}
                  />

                  {/* Each brand row is a row-flex containing the checkbox
                    and a separate trailing count chip. Keeping the
                    count outside the Checkbox gives us full control
                    over the layout. */}
                  {(() => {
                    const q = brandQuery.trim().toLowerCase();
                    const visible = q
                      ? facets.brands.filter(([b]) => b.toLowerCase().includes(q))
                      : facets.brands;
                    if (visible.length === 0) {
                      return (
                        <div className="text-xs text-default-500 italic py-1">
                          No brands match &ldquo;{brandQuery}&rdquo;.
                        </div>
                      );
                    }
                    return (
                      <div
                        // `relative` for the same sr-only containment reason
                        // as the Category list above.
                        className={`relative flex flex-col gap-3 ${visible.length > 8
                          ? 'max-h-56 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-default-300 [&::-webkit-scrollbar-thumb]:rounded-full'
                          : ''
                          }`}
                      >
                        {visible.map(([b, count]) => (
                          <div key={b} className="flex items-center gap-1">
                            <FigmaCheckbox
                              checked={selectedBrands.has(b)}
                              onChange={() => toggleBrand(b)}
                              className="flex-1 min-w-0"
                            >
                              {b}
                            </FigmaCheckbox>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </FilterSection>
              )}

              {/* Size */}
              {facets.sizes.length > 0 && (
                <FilterSection title="Size" lastChild defaultExpanded={false}>
                  <div className="flex flex-wrap gap-1.5">
                    {facets.sizes.map(([s]) => {
                      const active = selectedSizes.has(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => toggleSize(s)}
                          className={`min-w-[40px] h-9 px-2.5 rounded-lg border-2 text-xs font-semibold transition ${active
                            ? 'bg-brand-black text-white border-brand-black'
                            : 'bg-white text-default-700 border-default-200 hover:border-default-400'
                            }`}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </FilterSection>
              )}

              {/* Mobile-only close button */}
              <div className="lg:hidden mt-5 pt-4 border-t border-default-100">
                <Button
                  color="primary"
                  className="font-semibold w-full"
                  onPress={() => setFiltersOpen(false)}
                >
                  Show {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
                </Button>
              </div>
            </div>
          </aside>

          {/* Backdrop for mobile drawer */}
          {filtersOpen && (
            <div
              className="lg:hidden fixed inset-0 bg-black/50 z-40"
              onClick={() => setFiltersOpen(false)}
              aria-hidden
            />
          )}

          {/* PRODUCT GRID + RIGHT COLUMN — H1, subtitle, sort by, then grid.
            Spacing per Figma 3126:3975 — 40px (spacing/2xl) between the
            subtitle and the sort-by row, then a smaller gap to the grid.
            `py-8` gives the column 32px top + bottom breathing room
            without pushing the filter sidebar's border-top down. */}
          <main className="min-w-0 py-8">
            {!hideHeader && (
              <header className="mb-10 font-poppins">
                {/* Figma node 3035:7193 → token `Display Secondary`:
                  Poppins SemiBold 24px, line-height 1.52, color #1a1410.
                  Subtitle uses `Body L` — Poppins Regular 18px, #424242. */}
                {/* Top Content — admin-authored contentTitle /
                    contentDescription (Category record or static-meta
                    for /products) win over the auto-derived copy.
                    Explicit page-level overrides (dynamic pages) rank
                    highest. */}
                <h1
                  className="font-poppins font-semibold"
                  style={{
                    fontSize: '24px',
                    lineHeight: 1.52,
                    color: '#1a1410',
                  }}
                >
                  {/* Search queries get a query-specific heading instead
                      of the generic page title. When the query was
                      spell-corrected, the heading shows the CORRECTED
                      term (Flipkart pattern: `Showing results for X`,
                      with a "search instead" escape hatch below). */}
                  {q
                    ? `Showing results for "${correctedQuery || q}"`
                    : titleOverride || currentNode?.contentTitle || categoryName}
                </h1>
                <p
                  className="font-poppins mt-2 max-w-full"
                  style={{ fontSize: '15px', lineHeight: 1.6, color: '#424242' }}
                >
                  {q ? (
                    correctedQuery ? (
                      <>
                        Search instead for{' '}
                        <Link
                          href={`/products?q=${encodeURIComponent(q)}&exact=1`}
                          className="font-medium text-[#1a1410] underline underline-offset-2 hover:opacity-80"
                        >
                          &ldquo;{q}&rdquo;
                        </Link>
                      </>
                    ) : (
                      `${total} ${total === 1 ? 'product' : 'products'} found`
                    )
                  ) : (
                    descriptionOverride ??
                    (currentNode?.contentDescription ||
                      (currentNode?._id
                        ? `Quality ${categoryName.toLowerCase()} from trusted brands.`
                        : 'Curated products from verified sellers.'))
                  )}
                </p>
              </header>
            )}

            {/* SORT BY — plain text + chevron, right-aligned above the grid. */}
            <div className="flex items-center justify-end mb-4">

              <Dropdown placement="bottom-end">
                <DropdownTrigger>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-[15px] text-[#1a1410] outline-none focus:outline-none"
                  >
                    Sort by
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-[#1a1410]" aria-hidden>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                </DropdownTrigger>
                <DropdownMenu
                  aria-label="Sort by"
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={new Set([sort])}
                  onAction={(key) => {
                    const value = String(key);
                    // Build from window.location (NOT the useSearchParams
                    // snapshot) so filter params written by the URL-sync
                    // effect via history.replaceState aren't dropped.
                    const usp = new URLSearchParams(
                      typeof window !== 'undefined' ? window.location.search : (sp?.toString() || ''),
                    );
                    if (value === 'newest') usp.delete('sort');
                    else usp.set('sort', value);
                    const base = allProductsMode ? '/products' : `/${slug}`;
                    const qs = usp.toString();
                    router.push(qs ? `${base}?${qs}` : base);
                  }}
                >
                  {SORTS.map((s) => (
                    <DropdownItem key={s.value}>{s.label}</DropdownItem>
                  ))}
                </DropdownMenu>
              </Dropdown>
            </div>

            {/* Grid */}
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-5 gap-y-8">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="aspect-[3/4] rounded-2xl bg-default-200/50 animate-pulse" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              // "Catalog empty" vs "filters matched nothing" — since ticked
              // categories are now fetched server-side, an empty `items`
              // list with active filters just means THIS filter combination
              // has no products, not that the catalog is empty. Only show
              // the nothing-here-yet copy when no filters are involved.
              <div className="text-center py-12 md:py-20 rounded-2xl border-2 border-dashed border-default-200 bg-white">
                <Chip variant="flat" color="primary" className="mb-3">
                  {items.length === 0 && activeFilterCount === 0 ? 'No products found' : 'No matches'}
                </Chip>
                <p className="text-default-600 max-w-md mx-auto px-4">
                  {items.length === 0 && activeFilterCount === 0
                    ? <>Nothing in <strong>{categoryName}</strong> yet — check back soon, or browse other categories.</>
                    : 'No products match these filters yet. Try loosening them or clearing them all.'}
                </p>
                {activeFilterCount > 0 && (
                  <Button color="primary" className="mt-5 font-semibold" onPress={clearAll}>
                    Clear filters
                  </Button>
                )}
                {items.length === 0 && activeFilterCount === 0 && (
                  <Link href="/">
                    <Button color="primary" className="mt-5 font-semibold">Back to home</Button>
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-4">
                {filtered.map((p, i) => (
                  <ProductCard
                    key={p._id}
                    product={p}
                    /* First row (4 across on xl) is above the fold — see ProductCard. */
                    priority={i < 4}
                  />
                ))}
              </div>
            )}

            {/* Bottom Content — admin-authored SEO block rendered after
                the grid. Title + rich-text HTML from the Category record
                (category pages) or the props (listing pages like
                /products, fed from their static-meta record). */}
            {(() => {
              const bTitle = bottomTitle || currentNode?.bottomTitle || '';
              const bHtml = bottomDescriptionHtml || currentNode?.bottomDescription || '';
              if (!bTitle && !bHtml) return null;
              return (
                <section className="mt-14 pt-8 border-t border-[#eaeaea] font-poppins">
                  {bTitle && (
                    <h2 className="text-xl font-semibold text-[#1a1410] mb-3">
                      {bTitle}
                    </h2>
                  )}
                  {bHtml && (
                    <RichTextView
                      html={bHtml}
                      className="text-[15px] leading-relaxed text-[#424242]"
                    />
                  )}
                </section>
              );
            })()}
          </main>
        </div>
      </div>
    </div>
  );
}

/* ─── Filter section wrapper ───────────────────────────────────────── */
function FilterSection({
  title,
  children,
  lastChild = false,
  defaultExpanded = true,
}: {
  title: string;
  children: React.ReactNode;
  lastChild?: boolean;
  /**
   * Whether the section starts open. The Figma has Availability /
   * Category / Price open by default, Brand / Size closed — callers
   * set this per-section to mirror that.
   */
  defaultExpanded?: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);
  return (
    <div
      className={`py-4 ${lastChild ? '' : 'border-b'} first:pt-2`}
      // Section dividers — Figma `Stroke/Sections` = #EAEAEA.
      style={lastChild ? undefined : { borderBottomColor: '#EAEAEA' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        // Section header — Figma HS-6: Poppins SemiBold 14px, black.
        className="w-full flex items-center justify-between font-poppins font-semibold text-[14px] text-black outline-none focus:outline-none focus-visible:ring-0"
      >
        <span>{title}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`w-4 h-4 text-[#353535] transition-transform duration-200 ${open ? 'rotate-180' : ''
            }`}
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="flex flex-col gap-3 mt-3">{children}</div>
      )}
    </div>
  );
}

/* ─── Product card — clean Figma cell: image · name · price · feature ─── */
function ListingProductCard({
  product: p,
  initialWishlisted = false,
}: {
  product: Product;
  /** Seeded from the parent's /wishlist fetch so the heart starts in
   *  the correct state on page load / refresh. The card still owns
   *  the live state once the user toggles. */
  initialWishlisted?: boolean;
}) {
  const img = (p as any).listingImage || p.images?.[0];
  const outOfStock = (p.stock ?? 1) === 0;
  const feature = featureLine(p);
  const hasMrp = !!(p.mrp && p.mrp > p.price);
  const discount = hasMrp ? Math.round(((p.mrp! - p.price) / p.mrp!) * 100) : 0;
  const isHot = p.isFeatured || discount >= 15;

  const [wishlisted, setWishlisted] = useState(initialWishlisted);
  const [wishLoading, setWishLoading] = useState(false);

  // If the parent's wishlist fetch finishes after the card has already
  // mounted, sync the local state from the prop.
  useEffect(() => {
    setWishlisted(initialWishlisted);
  }, [initialWishlisted]);

  async function toggleWishlist(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const u = getStoredCustomer();
    if (!u) {
      window.location.href = `/signin?returnTo=/product/${(p as any).slug || p._id}`;
      return;
    }
    setWishLoading(true);
    try {
      if (wishlisted) {
        await customerApi.delete(`/wishlist/${p._id}`);
        setWishlisted(false);
        notifySuccess(M.category.removedFromWishlist);
      } else {
        await customerApi.post('/wishlist', { productId: p._id });
        setWishlisted(true);
        notifySuccess(M.category.savedToWishlist);
      }
    } catch (e: any) {
      notifyError(e, M.category.couldntSave);
    } finally {
      setWishLoading(false);
    }
  }

  // Strapline — short one-line spec below the price. Defensive fallback
  // chain: product description (first sentence/snippet) → brand → category
  // name → em-dash placeholder.
  // Short one-line spec below the price. featureLine() strips HTML from the
  // product description (so cards never render raw <p>/<strong> markup) and
  // falls back to brand · category. `feature` is the same value, computed above.
  const strapline = feature || '—';

  return (
    <Link
      href={`/product/${(p as any).slug || p._id}`}
      className="group block font-poppins"
    >
      <article className="font-poppins">
        {/* IMAGE AREA — square, rounded-xl per Figma 3126:3975. Card UI is
            deliberately bare: no card wrapper, no inner padding, no Hot
            badge, no discount tag, no wishlist heart, no add-to-cart.
            Just image flush with the cell, then text directly below. */}
        <div className="relative aspect-square rounded-xl bg-default-50 overflow-hidden">
          {outOfStock && (
            <div className="absolute inset-0 z-10 bg-white/70 grid place-items-center backdrop-blur-[1px]">
              <span className="px-3 py-1 bg-[#1a1410] text-white text-[10px] uppercase tracking-widest font-semibold rounded-full">
                Out of stock
              </span>
            </div>
          )}

          {img ? (
            <Image
              src={imageUrl(img)}
              alt={p.name}
              fill
              sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
              className="object-cover group-hover:scale-[1.04] transition-transform duration-500 ease-out"
            />
          ) : (
            <div className="w-full h-full grid place-items-center text-[#9a9a9a] text-xs uppercase tracking-widest">
              No image
            </div>
          )}
        </div>

        {/* INFO AREA — flush left, tight gap. Figma 3126:3975 puts the
            name/price/feature directly under the image with no card
            chrome and a small (~4px) vertical rhythm between rows. */}
        <div className="pt-3 flex flex-col gap-1 font-poppins">
          {/* Name — Figma HS-5: Poppins SemiBold 16px, single-line truncate */}
          <h3 className="font-poppins text-[16px] font-semibold text-[#1a1410] truncate leading-snug" title={p.name}>
            {p.name}
          </h3>

          {/* Price — Figma HS-5: Poppins SemiBold 16px, tabular-nums.
              No MRP strikethrough in this design — just the selling price. */}
          <div className="font-poppins text-[16px] font-semibold text-[#1a1410] tabular-nums leading-snug">
            ₹{inr(p.price)}
          </div>

          {/* Strapline — Figma Body S: Poppins Regular 12px, color
              content/secondary (#424242), single-line truncate. */}
          <div
            className="font-poppins text-[12px] truncate"
            style={{ color: '#424242' }}
            title={typeof strapline === 'string' ? strapline : undefined}
          >
            {strapline}
          </div>

          {/* Available-from-N-sellers signal (catalog dedup, M2). Shown only
              when more than one seller offers this product. */}
          {((p as any).offersCount ?? 0) > 1 && (
            <div className="font-poppins text-[11px]" style={{ color: '#9a9a9a' }}>
              {(p as any).offersCount} sellers
            </div>
          )}
        </div>
      </article>
    </Link>
  );
}

/* ─── Subcategory grid view — unchanged from before ─────────────────── */
function SubcategoryView({
  categoryName, subcategories, slug, items, loading,
}: {
  categoryName: string;
  subcategories: CategoryNode[];
  slug: string;
  items: Product[];
  loading: boolean;
}) {
  return (
    <div className="container py-6 md:py-8">
      <nav className="text-xs text-default-500 mb-3">
        <Link href="/" className="hover:text-brand-black">Home</Link>
        <span className="mx-1.5">/</span>
        <span className="text-brand-black font-medium">{categoryName}</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">{categoryName}</h1>
        {/* Suppress the "Loading…" string while the fetch is in flight
            — skeleton tiles below already cover the loading state. */}
        {!loading && (
          <div className="text-sm text-default-600 mt-1">
            {items.length} {items.length === 1 ? 'product' : 'products'}
          </div>
        )}
      </div>

      <div className="mb-10">
        <div className="text-[11px] uppercase tracking-widest font-bold text-brand-black/70 mb-3">
          Browse {categoryName.toLowerCase()}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {subcategories.map((sub) => {
            const subSlug = sub.slug || nameToSlug(sub.name);
            return (
              <Link
                key={sub._id}
                href={`/${subSlug}`} className="group flex flex-col"
              >
                <div
                  className={`w-full aspect-square rounded-2xl transition overflow-hidden flex items-center justify-center ${sub.icon
                    ? 'bg-default-100 hover:bg-default-200/70 p-4'
                    : 'bg-gradient-to-br from-default-100 via-default-50 to-default-100 hover:from-default-200/70 hover:to-default-100 border border-default-200/60 relative p-5'
                    }`}
                >
                  {sub.icon ? (
                    <div className="relative w-full h-full">
                      <Image
                        src={imageUrl(sub.icon)}
                        alt={sub.name}
                        fill
                        sizes="(min-width: 768px) 160px, 33vw"
                        className="object-contain group-hover:scale-105 transition duration-300"
                      />
                    </div>
                  ) : (
                    <>
                      <svg
                        viewBox="0 0 120 60"
                        className="absolute inset-x-4 bottom-6 w-[calc(100%-2rem)] text-default-300/60"
                        fill="currentColor"
                        aria-hidden
                      >
                        <circle cx="22" cy="48" r="3.5" />
                        <circle cx="96" cy="48" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" />
                        <circle cx="96" cy="48" r="3.5" />
                        <path d="M22 48 L42 32 L78 32 L96 48" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M44 32 L52 22 L72 22 L80 32 Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                        <path d="M82 32 L96 18 L108 18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                      </svg>
                      <div className="relative z-10 text-center px-2">
                        <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-default-500">Model</div>
                        <div className="mt-1 text-lg sm:text-xl font-bold text-brand-black tracking-tight leading-tight">
                          {sub.name}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {sub.icon && (
                  <div className="mt-3 text-sm font-bold tracking-wider uppercase text-brand-black text-center">
                    {sub.name}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
