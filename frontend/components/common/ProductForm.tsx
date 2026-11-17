'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, Input, Textarea, Spinner, Switch } from '@heroui/react';
import Button from '@/components/common/SellerButton';
import toast from 'react-hot-toast';
import { api, imageUrl, envelopeOrLegacy } from '@/lib/api';
import RichTextEditor from '@/components/common/RichTextEditor';
import MediaPickerModal from '@/components/common/MediaPickerModal';
import ProductUrlImport from '@/components/common/ProductUrlImport';
import styles from './ProductForm.module.css';
import SellerSelect from '@/components/common/SellerSelect';
import { clampText, IMPORT_FIELD_LIMITS, mergeImportedFields, type ProductImportResult } from '@/lib/productUrlImport';
import { getStoredUser } from '@/lib/auth';
import { loadProductCreateDraft, saveProductCreateDraft, clearProductCreateDraft } from '@/lib/productCreateDraft';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { MAX_PRICE_LABEL, overPriceLimit } from '@/lib/priceLimit';
import { M } from '@/lib/messages';

/** Find a category's path (root → leaf) by id, for edit-mode prefill. */
function findPath(
  nodes: { _id: string; children: any[] }[],
  targetId: string,
  acc: string[] = []
): string[] | null {
  for (const n of nodes) {
    const here = [...acc, n._id];
    if (n._id === targetId) return here;
    const sub = findPath(n.children || [], targetId, here);
    if (sub) return sub;
  }
  return null;
}

type CategoryNode = {
  _id: string;
  name: string;
  parent: string | null;
  isActive: boolean;
  children: CategoryNode[];
};

type ProductInitial = {
  name?: string;
  category?: any; // populated object {_id,name} or string id
  bike?: any;
  brand?: any; // populated {_id,name} or string id
  description?: string;
  price?: number;
  mrp?: number;
  stock?: number;
  sku?: string;
  color?: string;
  sizes?: string[];
  // Per-(size, color) variant rows saved on the product. `price` / `mrp`
  // are optional overrides — null/undefined means the variant sells at
  // the product's base price/mrp.
  variants?: Array<{
    size?: string;
    color?: string;
    stock?: number;
    sku?: string;
    price?: number | null;
    mrp?: number | null;
  }>;
  weightGrams?: number;
  lengthCm?: number;
  breadthCm?: number;
  heightCm?: number;
  gstRate?: number;
  hsn?: string;
  images?: string[];
  listingColor?: string;
  // Per-color image galleries. Each entry pins a set of image URLs
  // to one of the colors named in the variants matrix. Optional —
  // when absent or empty for a given color, that variant falls back
  // to the main `images` gallery.
  colorImages?: Array<{ color: string; images: string[] }>;
  // SEO overrides — optional. When set, they win over the auto-built
  // metadata in the storefront's product detail generateMetadata.
  seoTitle?: string;
  seoDescription?: string;
  ogImage?: string;
  // Optional single image showing measurements / fit guidance.
  // Displayed on the storefront next to the size selector.
  sizeChartImage?: string;
  // Optional Amazon-style A+ marketing images (up to 3) shown at the
  // bottom of the storefront PDP. Slot positions: [0]=top-left,
  // [1]=top-right, [2]=bottom-wide. Empty entries ('') mark unused slots.
  aPlusImages?: string[];
  // Optional per-product return/exchange policy overrides. `null` /
  // undefined = fall back to the seller's profile default. Set to 0
  // to explicitly disable returns/exchanges for this specific product.
  returnPolicyDays?: number | null;
  exchangePolicyDays?: number | null;
  // Per-product COD override. Default true — false restricts this
  // product to online payment even when the seller allows COD globally.
  codAvailable?: boolean;
  // Current lifecycle status — drives the submit-row buttons in edit
  // mode ('draft' products get a "Save & publish" primary action).
  status?: string;
};

// Numeric-XL convention (2XL, 3XL, …) — matches how sizes are stored on
// imported products, so a seller editing an imported listing sees its
// saved sizes pre-selected instead of an unmatched "XXL" chip.
const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
const NUMERIC_SIZES = ['28', '30', '32', '34', '36', '38', '40', '42', '44'];
/* Preset color chips offered in the "Colors available" picker. Sellers can
   toggle any subset of these and also add custom color names via the row
   below — mirrors the sizes picker exactly. */
const PRESET_COLORS = [
  'Black', 'White', 'Red', 'Blue', 'Green', 'Yellow',
  'Lime', 'Grey', 'Neon Black', 'Black Grey', 'Silver', 'Orange',
];

type BrandLite = { _id: string; name: string; slug?: string };

type ProductFormProps = {
  mode: 'create' | 'edit';
  id?: string;
  initial?: ProductInitial;
  onDone?: () => void;
};
type Variant = { size: string; color: string; stock: string; sku: string; price: string; mrp: string };
type ImageItem =
  | { id: string; kind: 'kept'; url: string }
  | { id: string; kind: 'staged'; file: File; preview: string };
type ColorImageItem = ImageItem;
type SizeChartItem =
  | { kind: 'kept'; url: string }
  | { kind: 'staged'; file: File; preview: string };
type APlusItem = ImageItem | null;
type ProductFormDraft = {
  form: Record<'name' | 'description' | 'price' | 'mrp' | 'stock' | 'sku' | 'color' | 'weightGrams' |
    'lengthCm' | 'breadthCm' | 'heightCm' | 'seoTitle' | 'seoDescription' | 'ogImage' |
    'returnPolicyDays' | 'exchangePolicyDays' | 'gstRate' | 'hsn', string> & { codAvailable: boolean };
  variantsMode: boolean; sizes: string[]; customSize: string; colors: string[]; customColor: string;
  listingColor: string; variants: Variant[]; variantPricingEnabled: boolean;
  quickStock: string; quickPrice: string; brandId: string; pickedIds: string[];
  isBikeSpecific: boolean; makeId: string; modelId: string; dimsDraft: string | null;
  imageItems: ImageItem[]; colorImages: Record<string, ColorImageItem[]>;
  sizeChartImage: SizeChartItem | null; aPlusImages: APlusItem[];
  showExtraImages: boolean | null; showPublishing: boolean | null; showColorImageTools: boolean;
  variantsTouched: boolean; colorImagesTouched: boolean; sizeChartTouched: boolean; aPlusTouched: boolean;
  evictedVariants: Variant[];
};

function restoreDraftImages(draft: ProductFormDraft): ProductFormDraft {
  function restore<T extends SizeChartItem>(image: T): T {
    return image.kind === 'staged' ? { ...image, preview: URL.createObjectURL(image.file) } : image;
  }
  return {
    ...draft,
    imageItems: draft.imageItems.map(restore),
    colorImages: Object.fromEntries(Object.entries(draft.colorImages).map(([color, images]) => [color, images.map(restore)])),
    sizeChartImage: draft.sizeChartImage ? restore(draft.sizeChartImage) : null,
    aPlusImages: draft.aPlusImages.map(image => image ? restore(image) : null),
  };
}

export default function ProductForm(props: ProductFormProps) {
  const [resume, setResume] = useState<{ key: string | null; sellerId: string | null; draft: ProductFormDraft | null } | null>(null);
  useEffect(() => {
    if (props.mode !== 'create') return;
    let active = true;
    const sellerId = getStoredUser()?._id;
    if (!sellerId) return;
    loadProductCreateDraft<ProductFormDraft>(sellerId).then(({ key, draft }) => {
      if (!active) return;
      setResume({ key, sellerId, draft: draft ? restoreDraftImages(draft) : null });
    }).catch(() => {
      if (!active) return;
      setResume({ key: null, sellerId, draft: null });
      toast.error('Local backup unavailable · save as draft before leaving');
    });
    return () => { active = false; };
  }, [props.mode]);

  if (props.mode === 'create' && !resume) {
    return <div className="flex items-center gap-2 py-6 text-sm text-muted"><Spinner size="sm" /> Loading product form…</div>;
  }
  return <ProductFormEditor {...props} draft={resume?.draft || null} draftKey={resume?.key || null} draftSellerId={resume?.sellerId || null} />;
}

function ProductFormEditor({
  mode,
  id,
  initial = {},
  onDone,
  draft,
  draftKey,
  draftSellerId,
}: ProductFormProps & {
  draft: ProductFormDraft | null;
  draftKey: string | null;
  draftSellerId: string | null;
}) {
  const router = useRouter();

  /* Shared input styling — compact bordered field used across every text
     input on the form so the look stays consistent. 44px tall, 2px gray
     border that deepens on hover and snaps to the foreground token on focus. */
  const INPUT_PROPS = {
    variant: 'bordered' as const,
    classNames: {
      inputWrapper:
        styles.inputWrapper,
      input: 'text-sm',
    },
  };
  // Categories from API
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  // Declared right after the tree (before anything that reads them) so
  // the React Compiler can keep this memoization.
  /** Top-level "Shop by Bike" subtree (used for bike Make+Model dropdowns) */
  const shopByBike = useMemo(
    () => tree.find((n) => n.parent === null && n.name === 'Shop by Bike') || null,
    [tree]
  );
  /** Everything else (used for the Category select) */
  const productCategoryRoots = useMemo(
    () => tree.filter((n) => !(n.parent === null && n.name === 'Shop by Bike')),
    [tree]
  );

  // Form state
  const initialCategoryId =
    typeof initial.category === 'object' && initial.category
      ? initial.category._id
      : (initial.category as string) || '';
  const initialBikeId =
    typeof initial.bike === 'object' && initial.bike
      ? initial.bike._id
      : (initial.bike as string) || '';

  const [form, setForm] = useState<ProductFormDraft['form']>({
    name: initial.name || '',
    description: initial.description || '',
    price: initial.price?.toString() || '',
    mrp: initial.mrp?.toString() || '',
    stock: initial.stock?.toString() || '0',
    sku: initial.sku || '',
    color: initial.color || '',
    weightGrams: initial.weightGrams?.toString() || '',
    // Box dimensions in cm — used by Shiprocket for volumetric-weight
    // pricing. Defaults to 15×15×10 (small parcel) if the seller doesn't
    // override, matching the backend fallback.
    lengthCm: initial.lengthCm?.toString() || '',
    breadthCm: initial.breadthCm?.toString() || '',
    heightCm: initial.heightCm?.toString() || '',
    // GST already included in the price + HSN code, printed on the tax
    // invoice. 18% matches the backend default for products that predate it.
    gstRate: (initial.gstRate ?? 18).toString(),
    hsn: initial.hsn || '',
    // SEO overrides — empty strings let the storefront fall back to
    // auto-built metadata from the product name + description + first image.
    seoTitle: initial.seoTitle || '',
    seoDescription: initial.seoDescription || '',
    ogImage: initial.ogImage || '',
    // Return / exchange overrides — empty string = fall back to the
    // seller's default from the profile tab. Non-empty numeric string
    // (including '0' to explicitly disable) wins for this product.
    returnPolicyDays:
      initial.returnPolicyDays === null || initial.returnPolicyDays === undefined
        ? ''
        : String(initial.returnPolicyDays),
    exchangePolicyDays:
      initial.exchangePolicyDays === null || initial.exchangePolicyDays === undefined
        ? ''
        : String(initial.exchangePolicyDays),
    // Per-product COD override — true unless the seller explicitly
    // restricted this product to online payment.
    codAvailable: initial.codAvailable !== false,
    // Older local drafts predate the staging tax fields; keep their defaults.
    ...draft?.form,
  });

  /** Mode toggle — Simple product (default) vs Variation mode.
   *  Simple mode uses `form.stock` + `form.color` as top-level fields.
   *  Variation mode surfaces the Colors picker, Stock matrix, and
   *  per-color image galleries. Initial value derives from whether the
   *  product already has saved variants, so an existing multi-variant
   *  product opens in variation mode automatically. State (colors,
   *  sizes, variants, colorImages, form.stock, form.color) is preserved
   *  across toggles — only the RENDERING changes. */
  const [variantsMode, setVariantsMode] = useState<boolean>(() => {
    if (draft) return draft.variantsMode;
    // Auto-open Variation mode whenever the product already has any of the
    // things that Variation mode manages (variants, per-size sizes, or
    // per-color images). Otherwise defaults to Simple mode for new products.
    if (Array.isArray(initial.variants) && initial.variants.length > 0) return true;
    if (Array.isArray(initial.sizes) && initial.sizes.length > 0) return true;
    if (Array.isArray(initial.colorImages) && initial.colorImages.length > 0) return true;
    return false;
  });

  /** Multi-size picker state */
  const [sizes, setSizes] = useState<string[]>(draft?.sizes || initial.sizes || []);

  const [customSize, setCustomSize] = useState(draft?.customSize || '');

  /** True once the seller has interacted with the variant section in any
   *  way (picker chips, matrix cells, quick fill, pricing mode). Until
   *  then, submit() omits the `variants` field entirely so a product
   *  whose matrix rows were merely auto-generated on mount (legacy
   *  product with sizes/color but no saved variants) can't have its
   *  live stock overwritten by a save that never meant to touch it. */
  const variantsTouchedRef = useRef(draft?.variantsTouched || false);

  function toggleSize(s: string) {
    variantsTouchedRef.current = true;
    setSizes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  function addCustomSize() {
    const s = customSize.trim();
    if (!s) return;
    if (sizes.includes(s)) {
      notifyWarning(M.productForm.sizeAlreadyAdded(s));
      return;
    }
    variantsTouchedRef.current = true;
    setSizes((prev) => [...prev, s]);
    setCustomSize('');
  }

  function removeSize(s: string) {
    variantsTouchedRef.current = true;
    setSizes((prev) => prev.filter((x) => x !== s));
  }

  /** Multi-color picker state — mirrors the sizes picker. Sellers toggle
   *  the preset chips (or add a custom name); each entry becomes a row
   *  in the auto-generated variants matrix below. Initial value is
   *  derived from the saved variants (unique colors in insertion order)
   *  or the legacy top-level `initial.color` when there are no variants
   *  yet — so a product created before this UI change edits cleanly. */
  const [colors, setColors] = useState<string[]>(() => {
    if (draft) return draft.colors;
    const src = initial.variants || [];
    if (Array.isArray(src) && src.length > 0) {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const v of src) {
        const c = String(v?.color || '').trim();
        if (c && !seen.has(c)) { seen.add(c); out.push(c); }
      }
      if (out.length > 0) return out;
    }
    const legacy = (initial.color || '').trim();
    return legacy ? [legacy] : [];
  });

  const [customColor, setCustomColor] = useState(draft?.customColor || '');
  // Raw pick; `listingColor` below is the pick narrowed to the colours
  // currently on offer, so removing a colour never leaves a stale value.
  const [listingColorRaw, setListingColor] = useState(draft?.listingColor || initial.listingColor || '');

  function toggleColor(c: string) {
    variantsTouchedRef.current = true;
    setColors((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  }

  function addCustomColor() {
    const c = customColor.trim();
    if (!c) return;
    if (colors.includes(c)) {
      notifyWarning(M.productForm.colorAlreadyAdded(c));
      return;
    }
    variantsTouchedRef.current = true;
    setColors((prev) => [...prev, c]);
    setCustomColor('');
  }

  function removeColor(c: string) {
    variantsTouchedRef.current = true;
    setColors((prev) => prev.filter((x) => x !== c));
  }

  /** Per-(size, color) stock matrix — Phase 1 variants. Each row lets the
   *  seller declare how many units of a specific size × color pair they
   *  have in stock. When any variant row is filled in, the top-level
   *  `stock` field on the product is auto-computed from the sum of these
   *  rows on the backend, so the storefront's existing stock display
   *  keeps working without any Phase-2 UI changes. */
  /* `mrp` has no matrix input (yet) but is round-tripped through state so
     an override set via the API isn't silently nulled by a form save. */
  const [variants, setVariants] = useState<Variant[]>(() => {
    if (draft) return draft.variants;
    const src = initial.variants || [];
    if (!Array.isArray(src)) return [];
    return src.map((v) => ({
      size: v?.size || '',
      color: v?.color || '',
      stock: v?.stock === undefined || v?.stock === null ? '' : String(v.stock),
      sku: v?.sku || '',
      price: v?.price === undefined || v?.price === null ? '' : String(v.price),
      mrp: v?.mrp === undefined || v?.mrp === null ? '' : String(v.mrp),
    }));
  });
  const [variantPricingEnabled, setVariantPricingEnabled] = useState(() => {
    if (draft) return draft.variantPricingEnabled;
    const src = initial.variants || [];
    return Array.isArray(src) && src.some((v) => v?.price !== null && v?.price !== undefined);
  });

  function updateVariantCell(idx: number, key: keyof Variant, value: string) {
    variantsTouchedRef.current = true;
    setVariants((prev) => prev.map((row, i) => (i === idx ? { ...row, [key]: value } : row)));
  }

  /** Blocks the browser's implicit form-submit when the seller presses
   *  Enter to "confirm" a matrix / quick-fill cell — a half-filled
   *  matrix must never save-and-redirect mid-entry. */
  function blockEnterSubmit(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.preventDefault();
  }

  /** (color, size) → index into `variants`, so the matrix table can find
   *  each cell's row without a nested scan. */
  const variantIndex = useMemo(() => {
    const m = new Map<string, number>();
    variants.forEach((v, i) => m.set(`${v.color}::${v.size}`, i));
    return m;
  }, [variants]);

  /** Quick-fill stock into EVERY variant cell. */
  const [quickStock, setQuickStock] = useState(draft?.quickStock || '');
  const [quickPrice, setQuickPrice] = useState(draft?.quickPrice || '');
  function applyQuickFill() {
    const s = quickStock.trim();
    const p = quickPrice.trim();
    if (!s && !(variantPricingEnabled && p)) return;
    variantsTouchedRef.current = true;
    setVariants((prev) =>
      prev.map((v) => ({
        ...v,
        stock: s !== '' ? s : v.stock,
        price: variantPricingEnabled && p !== '' ? p : v.price,
      }))
    );
  }

  /* Auto-sync the variants list to the cartesian product of the colors
     and sizes pickers. When either picker changes we rebuild the rows
     but preserve `stock` / `sku` / `price` on any (color, size) pair the
     seller already filled in — keyed on `${color}::${size}`. Pairs that
     get evicted (chip toggled off) are kept in `evictedRowsRef` so
     toggling the chip back on restores the typed values instead of
     presenting a blank cell. When both pickers are empty we clear the
     variants entirely and the form falls back to the classic single-SKU
     path via `form.stock`. */
  const evictedRowsRef = useRef(new Map<string, Variant>((draft?.evictedVariants || []).map(row => [`${row.color}::${row.size}`, row])));
  useEffect(() => {
    setVariants((prev) => {
      // Cache first, then live rows on top — a live row always wins over
      // a stale evicted copy of the same pair.
      const preserved = new Map<string, Variant>(evictedRowsRef.current);
      for (const v of prev) preserved.set(`${v.color}::${v.size}`, v);
      evictedRowsRef.current = preserved;
      const colorsList = colors.length ? colors : [''];
      const sizesList = sizes.length ? sizes : [''];
      const rows: Variant[] = [];
      for (const c of colorsList) {
        for (const s of sizesList) {
          // Skip the fully-empty pair — that's the no-variants path.
          if (c === '' && s === '') continue;
          const existing = preserved.get(`${c}::${s}`);
          rows.push(existing || { color: c, size: s, stock: '', sku: '', price: '', mrp: '' });
        }
      }
      return rows;
    });
  }, [colors, sizes]);

  /** Total stock derived from variant rows — surfaced in the section header
   *  so sellers see immediately what the top-of-form stock field will be
   *  overwritten with when the backend recomputes on save. */
  const variantStockTotal = useMemo(
    () => variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0),
    [variants]
  );

  /** Unique, order-preserving list of colors that drive the "Images per
   *  color" section — one sub-panel per color the seller picked. Reads
   *  from the new `colors` picker state directly. Fallback: when the
   *  picker is empty (legacy edit case where a product was saved before
   *  this UI change and only has variants[].color populated), derive
   *  the list from `variants` so those old products still expose their
   *  per-color image slots on first edit. Trimmed + case-sensitive so
   *  a stray casing typo surfaces as a distinct bucket to fix. */
  const uniqueColors = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const source: string[] = colors.length > 0 ? colors : variants.map((v) => v.color);
    for (const raw of source) {
      const c = (raw || '').trim();
      if (c && !seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  }, [colors, variants]);

  const listingColor = listingColorRaw && uniqueColors.includes(listingColorRaw) ? listingColorRaw : '';

  /** Brand picker — id only; "" means no brand. */
  const initialBrandId =
    typeof initial.brand === 'object' && initial.brand
      ? initial.brand._id
      : (typeof initial.brand === 'string' ? initial.brand : '') || '';
  const [brandId, setBrandId] = useState<string>(draft?.brandId || initialBrandId);

  /** Brands list (fetched from admin Brands collection) */
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [loadingBrands, setLoadingBrands] = useState(true);

  useEffect(() => {
    api
      .get('/brands', { params: { active: 1 } }).then(envelopeOrLegacy)
      .then(({ data }) => setBrands(data.items as BrandLite[]))
      .catch(() => notifyWarning(M.productForm.failedToLoadBrands))
      .finally(() => setLoadingBrands(false));
  }, []);

  /** Cascading category picks — one entry per dropdown level */
  const [pickedIds, setPickedIds] = useState<string[]>(draft?.pickedIds || []);

  // Bike-specific fields
  const [isBikeSpecific, setIsBikeSpecific] = useState<boolean>(draft?.isBikeSpecific ?? Boolean(initialBikeId));
  const [makeId, setMakeId] = useState<string>(draft?.makeId || '');
  const [modelId, setModelId] = useState<string>(draft?.modelId || initialBikeId);

  const [saving, setSaving] = useState(false);
  /* Set on the first submit attempt. Validation notices (e.g. "add an
     image") wait for it — a red box on a form nobody has touched yet
     reads as an error the seller already made (UX audit S6). */
  const [attempted, setAttempted] = useState(false);

  // ─── Media picker modal ─────────────────────────────────────────
  // Every image-upload CTA on the form (main gallery, per-color,
  // size chart, A+ slots) opens a shared picker instead of the
  // native file input. The picker returns a list of S3 keys, which
  // we map onto the corresponding kept-tile shape below.
  type PickerTarget =
    | { target: 'main'; maxSelect: number; title: string }
    | { target: 'color'; color: string; maxSelect: number; title: string }
    | { target: 'sizeChart'; maxSelect: 1; title: string }
    | { target: 'aplus'; aplusSlot: 0 | 1 | 2; maxSelect: 1; title: string };
  const [pickerState, setPickerState] = useState<PickerTarget | null>(null);

  // ─── Unified image gallery ──────────────────────────────────────────────
  // Single ordered list with two kinds of items:
  //   - kept:   an image already on the product (S3 URL/key from `initial.images`)
  //   - staged: a freshly-picked File that hasn't been uploaded yet
  // Both kinds participate in the same drag-reorder gesture, so a seller can
  // drop a brand-new photo into position #1 ahead of older ones. On submit
  // we emit an `imageOrder` JSON that tells the backend how to interleave
  // the uploaded files with the kept URLs.
  const [imageItems, setImageItems] = useState<ImageItem[]>(() =>
    draft?.imageItems || (initial.images || []).map((u, i) => ({
      id: `k-${i}-${u}`,
      kind: 'kept' as const,
      url: u,
    }))
  );

  const MAX_IMAGES = 12;

  const [descriptionImportVersion, setDescriptionImportVersion] = useState(0);
  function applyUrlImport(result: ProductImportResult, replaceDescription = false) {
    setForm(current => mergeImportedFields(current, result.draft, replaceDescription));
    if (replaceDescription && result.draft.description) setDescriptionImportVersion(version => version + 1);
    if (!brandId && result.draft.brandName) {
      const matches = brands.filter(b => b.name.toLowerCase() === result.draft.brandName.toLowerCase());
      if (matches.length === 1) setBrandId(matches[0]._id);
    }
    if (!pickedIds.length && result.draft.categoryName) {
      const matches: string[][] = [];
      const visit = (nodes: CategoryNode[], path: string[] = []) => nodes.forEach(node => {
        if (!node.isActive) return;
        const next = [...path, node._id];
        if (node.name.toLowerCase() === result.draft.categoryName.toLowerCase()) matches.push(next);
        visit(node.children || [], next);
      });
      visit(productCategoryRoots);
      if (matches.length === 1) setPickedIds(matches[0]);
    }
    // Sizes can be edited in the existing variation controls. Never import
    // another shop's inventory or guess per-variant prices/quantities.
    if (!sizes.length && !variantsMode && result.draft.sizes.length) {
      setSizes(result.draft.sizes); setVariantsMode(true);
    }
    const available = Math.max(0, MAX_IMAGES - imageItems.length);
    const imported: ImageItem[] = result.images.slice(0, available).map((image, index) => {
      const bytes = Uint8Array.from(atob(image.base64), c => c.charCodeAt(0));
      const file = new File([bytes], image.name, { type:image.mime });
      return { id:`import-${Date.now()}-${index}`, kind:'staged', file, preview:URL.createObjectURL(file) };
    });
    setImageItems(current => [...current, ...imported]);
    if (result.images.length > available) toast('Gallery full · only the free slots were filled');
    notifySuccess(M.productForm.draftFilledReviewCategoryStockPriceAnd);
  }
  // Per-color galleries are independent of the main-gallery cap.
  const MAX_COLOR_IMAGES = 12;

  // ─── Per-color image galleries ─────────────────────────────────────────
  // Keys are the unique color strings from the variants matrix; values
  // are ImageItem-shaped tiles (same kept/staged union as the main
  // gallery). Initial load hydrates 'kept' entries from the doc; new
  // uploads land as 'staged' with a URL.createObjectURL preview.
  const [colorImages, setColorImages] = useState<Record<string, ColorImageItem[]>>(() => {
    if (draft) return draft.colorImages;
    const src = (initial as any).colorImages || [];
    if (!Array.isArray(src)) return {};
    const map: Record<string, ColorImageItem[]> = {};
    for (const entry of src) {
      const c = String(entry?.color || '').trim();
      if (!c) continue;
      const imgs = Array.isArray(entry?.images) ? entry.images : [];
      map[c] = imgs.map((u: string, i: number) => ({
        id: `k-${c}-${i}-${u}`,
        kind: 'kept' as const,
        url: u,
      }));
    }
    return map;
  });
  const [showColorImageTools, setShowColorImageTools] = useState(() => {
    if (draft) return draft.showColorImageTools;
    const src = (initial as any).colorImages || [];
    return Array.isArray(src) && src.some((entry: any) => {
      const images = Array.isArray(entry?.images) ? entry.images : [];
      return images.length > 0;
    });
  });
  /** True once the seller added/removed a per-color photo this session.
   *  Lets submit() distinguish "seller emptied every gallery on purpose"
   *  (send an explicit empty manifest so the backend clears them) from
   *  "seller never opened this section" (omit the field, preserve). */
  const colorImagesTouchedRef = useRef(draft?.colorImagesTouched || false);

  // ─── Size chart image ─────────────────────────────────────────────
  // Optional single-image upload showing measurements / fit guide.
  // Uses the same shared `stagedFiles` multer field as the main gallery.
  // Serialization: a `sizeChartImageManifest` FormData field carrying
  //   { kept: string | null, staged: number | null }
  // tells the backend how to resolve the value.
  const [sizeChartImage, setSizeChartImage] = useState<SizeChartItem | null>(() => {
    if (draft) return draft.sizeChartImage;
    const url = (initial as any).sizeChartImage;
    return url && typeof url === 'string' ? { kind: 'kept', url } : null;
  });
  const sizeChartTouchedRef = useRef(draft?.sizeChartTouched || false);

  function onSizeChartPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    sizeChartTouchedRef.current = true;
    // Revoke old blob preview if any
    if (sizeChartImage && sizeChartImage.kind === 'staged') {
      URL.revokeObjectURL(sizeChartImage.preview);
    }
    setSizeChartImage({ kind: 'staged', file: f, preview: URL.createObjectURL(f) });
    e.target.value = '';
  }

  function removeSizeChart() {
    sizeChartTouchedRef.current = true;
    if (sizeChartImage && sizeChartImage.kind === 'staged') {
      URL.revokeObjectURL(sizeChartImage.preview);
    }
    setSizeChartImage(null);
  }

  // ─── A+ Content Images ────────────────────────────────────────────
  // Optional Amazon-style marketing images shown on the storefront PDP
  // below the "Customers also viewed" rail. Up to 3 slots:
  //   [0] = top-left, [1] = top-right, [2] = bottom-wide banner.
  // Empty slots are allowed — the layout gracefully collapses when a
  // slot is missing. Uses the same shared `stagedFiles` multer field
  // as the main gallery / size chart.
  /* UX audit S6: optional groups start collapsed unless they already hold
     a value, so a first-time seller sees only what they must fill in. */
  const [showExtraImages, setShowExtraImages] = useState<boolean | null>(draft?.showExtraImages ?? null);
  const [showPublishing, setShowPublishing] = useState<boolean | null>(draft?.showPublishing ?? null);
  const [aPlusImages, setAPlusImages] = useState<APlusItem[]>(() => {
    if (draft) return draft.aPlusImages;
    const init = Array.isArray((initial as any).aPlusImages) ? (initial as any).aPlusImages : [];
    return [0, 1, 2].map((i) => {
      const url = init[i];
      if (typeof url === 'string' && url) {
        return { id: `k-aplus-${i}`, kind: 'kept' as const, url };
      }
      return null;
    });
  });
  const aPlusTouchedRef = useRef(draft?.aPlusTouched || false);

  function onAPlusPicked(slot: number, e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    aPlusTouchedRef.current = true;
    setAPlusImages((prev) => {
      const next = prev.slice();
      const old = next[slot];
      if (old && old.kind === 'staged') URL.revokeObjectURL(old.preview);
      next[slot] = {
        id: `s-aplus-${slot}-${Date.now()}`,
        kind: 'staged',
        file: f,
        preview: URL.createObjectURL(f),
      };
      return next;
    });
    e.target.value = '';
  }

  function removeAPlus(slot: number) {
    aPlusTouchedRef.current = true;
    setAPlusImages((prev) => {
      const next = prev.slice();
      const old = next[slot];
      if (old && old.kind === 'staged') URL.revokeObjectURL(old.preview);
      next[slot] = null;
      return next;
    });
  }

  function onColorFilesPicked(
    color: string,
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    colorImagesTouchedRef.current = true;
    const current = colorImages[color] || [];
    const room = MAX_COLOR_IMAGES - current.length;
    if (room <= 0) {
      notifyWarning(M.productForm.upToImagesPerColor(MAX_COLOR_IMAGES));
      e.target.value = '';
      return;
    }
    let toAdd = picked;
    if (picked.length > room) {
      toast(`Only ${room} more image${room === 1 ? '' : 's'} allowed for ${color} — extras ignored.`);
      toAdd = picked.slice(0, room);
    }
    const newItems: ColorImageItem[] = toAdd.map((f) => ({
      id: `s-${color}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'staged' as const,
      file: f,
      preview: URL.createObjectURL(f),
    }));
    setColorImages((prev) => ({
      ...prev,
      [color]: [...(prev[color] || []), ...newItems],
    }));
    e.target.value = '';
  }

  function removeColorImageItem(color: string, id: string) {
    colorImagesTouchedRef.current = true;
    setColorImages((prev) => {
      const list = prev[color] || [];
      const item = list.find((it) => it.id === id);
      if (item?.kind === 'staged') URL.revokeObjectURL(item.preview);
      return { ...prev, [color]: list.filter((it) => it.id !== id) };
    });
  }

  const colorImageCount = useMemo(
    () => Object.values(colorImages).reduce((sum, items) => sum + items.length, 0),
    [colorImages]
  );
  const hasAnyProductImage = imageItems.length > 0 || colorImageCount > 0;

  function onFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    const room = MAX_IMAGES - imageItems.length;
    if (room <= 0) {
      notifyWarning(M.productForm.upToImagesPerProduct(MAX_IMAGES));
      e.target.value = '';
      return;
    }
    let toAdd = picked;
    if (picked.length > room) {
      toast(`Only ${room} more image${room === 1 ? '' : 's'} allowed — extras ignored.`);
      toAdd = picked.slice(0, room);
    }
    const newItems: ImageItem[] = toAdd.map((f) => ({
      id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'staged' as const,
      file: f,
      preview: URL.createObjectURL(f),
    }));
    setImageItems((prev) => [...prev, ...newItems]);
    // Reset so picking the same file twice still triggers change
    e.target.value = '';
  }

  function removeImageItem(id: string) {
    setImageItems((prev) => {
      const item = prev.find((it) => it.id === id);
      if (item?.kind === 'staged') URL.revokeObjectURL(item.preview);
      return prev.filter((it) => it.id !== id);
    });
  }

  // ─── Drag-and-drop reorder ──────────────────────────────────────────────
  // HTML5 native drag API — no extra deps. `dragIndex` is the source slot
  // (kept in a ref because dataTransfer can't carry it reliably on Firefox);
  // `dragOverIndex` is the visual highlight target.
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  function moveImageItem(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    setImageItems((prev) => {
      if (from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  // Fetch the full active tree on mount (admin endpoint isn't needed; public works)
  useEffect(() => {
    api
      .get('/categories').then(envelopeOrLegacy)
      // A response without `tree` used to put `undefined` in state and
      // crash the whole editor on `tree.find` below; treat it like a
      // failed load instead.
      .then(({ data }) => {
        if (!Array.isArray(data?.tree)) throw new Error('No category tree in response');
        const loaded = data.tree as CategoryNode[];
        setTree(loaded);
        // Edit mode: expand the saved category into the cascading picks,
        // unless a restored draft already holds picks. Done here, where
        // the tree arrives, rather than in an effect that watches it.
        if (initialCategoryId) {
          const roots = loaded.filter((n) => !(n.parent === null && n.name === 'Shop by Bike'));
          const path = findPath(roots, initialCategoryId);
          if (path) setPickedIds((prev) => (prev.length ? prev : path));
        }
        // Likewise the saved bike: find the make that holds the model so
        // both dropdowns prefill. The saved value may itself be a make
        // (no model), in which case the model clears.
        const bikeRoot = loaded.find((n) => n.parent === null && n.name === 'Shop by Bike');
        if (modelId && bikeRoot) {
          for (const make of bikeRoot.children) {
            if (make.children.some((m) => m._id === modelId)) { setMakeId(make._id); break; }
            if (make._id === modelId) { setMakeId(make._id); setModelId(''); break; }
          }
        }
      })
      .catch(() => notifyWarning(M.productForm.failedToLoadCategories))
      .finally(() => setLoadingCategories(false));
  }, []);

  /**
   * Build the list of dropdowns to render based on the user's picks.
   * Each level shows the children of the level above. We always render
   * the next empty level if the parent has any children, so the user
   * can keep drilling down.
   */
  const cascade = useMemo(() => {
    const levels: { options: CategoryNode[]; selected: string }[] = [];
    let parentChildren = productCategoryRoots.filter((c) => c.isActive);
    let i = 0;
    while (parentChildren.length > 0) {
      const selected = pickedIds[i] || '';
      levels.push({ options: parentChildren, selected });
      if (!selected) break; // stop showing more levels until user picks here
      const node = parentChildren.find((c) => c._id === selected);
      const next = (node?.children || []).filter((c) => c.isActive);
      if (next.length === 0) break;
      parentChildren = next;
      i++;
    }
    return levels;
  }, [productCategoryRoots, pickedIds]);

  /** The category id we'll submit = the deepest pick */
  const selectedCategoryId = pickedIds[pickedIds.length - 1] || '';

  /** Bike makes (children of "Shop by Bike") */
  const bikeMakes = useMemo(
    () => (shopByBike?.children || []).filter((c) => c.isActive),
    [shopByBike]
  );

  /** Bike models for the selected make */
  const bikeModels = useMemo(() => {
    if (!makeId) return [];
    const make = bikeMakes.find((m) => m._id === makeId);
    return (make?.children || []).filter((c) => c.isActive);
  }, [bikeMakes, makeId]);


  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  /**
   * Single "L × W × H" box-size field, backed by three stored numbers.
   *
   * The form still holds lengthCm / breadthCm / heightCm separately —
   * that's what the API and Shiprocket's volumetric-weight formula
   * expect — but the seller edits one string. `dimensions` is derived
   * from those three for display; typing parses back into them.
   *
   * Kept as raw local state while focused so a partially-typed value
   * ("30 x") isn't reformatted out from under the cursor.
   */
  const [dimsDraft, setDimsDraft] = useState<string | null>(draft?.dimsDraft ?? null);

  const previewItemsRef = useRef<SizeChartItem[]>([]);
  // Latest previews for the unmount cleanup below. Written after each
  // render (refs must not be written during render).
  useEffect(() => {
    previewItemsRef.current = [...imageItems, ...Object.values(colorImages).flat(),
      ...(sizeChartImage ? [sizeChartImage] : []), ...aPlusImages.filter((image): image is ImageItem => !!image)];
  });
  const editorMountedRef = useRef(false);
  useEffect(() => {
    editorMountedRef.current = true;
    return () => {
      editorMountedRef.current = false;
      // Strict Mode briefly cleans up and remounts effects; keep restored previews valid through that cycle.
      queueMicrotask(() => {
        if (!editorMountedRef.current) previewItemsRef.current.forEach(image => {
          if (image.kind === 'staged') URL.revokeObjectURL(image.preview);
        });
      });
    };
  }, []);

  const draftFinishedRef = useRef(false);
  const draftWarningRef = useRef(false);
  useEffect(() => {
    if (mode !== 'create' || !draftKey || draftFinishedRef.current) return;
    const values: ProductFormDraft = {
      form, variantsMode, sizes, customSize, colors, customColor, listingColor, variants, variantPricingEnabled,
      quickStock, quickPrice, brandId, pickedIds, isBikeSpecific, makeId, modelId, dimsDraft,
      imageItems, colorImages, sizeChartImage, aPlusImages, showExtraImages, showPublishing, showColorImageTools,
      variantsTouched: variantsTouchedRef.current, colorImagesTouched: colorImagesTouchedRef.current,
      sizeChartTouched: sizeChartTouchedRef.current, aPlusTouched: aPlusTouchedRef.current,
      evictedVariants: [...evictedRowsRef.current.values()],
    };
    saveProductCreateDraft(draftKey, values).catch(() => {
      if (draftWarningRef.current) return;
      draftWarningRef.current = true;
      toast.error('Couldn’t back up locally · save as draft before refreshing');
    });
  }, [mode, draftKey, form, variantsMode, sizes, customSize, colors, customColor, listingColor, variants,
    variantPricingEnabled, quickStock, quickPrice, brandId, pickedIds, isBikeSpecific, makeId, modelId, dimsDraft,
    imageItems, colorImages, sizeChartImage, aPlusImages, showExtraImages, showPublishing, showColorImageTools]);

  async function finishLocalDraft() {
    draftFinishedRef.current = true;
    if (mode === 'create' && draftKey && draftSellerId) {
      await clearProductCreateDraft(draftSellerId, draftKey).catch(() => {});
    }
  }

  async function cancel() {
    await finishLocalDraft();
    if (onDone) onDone();
    else router.push('/dashboard/products');
  }

  const dimensions =
    dimsDraft ??
    ([form.lengthCm, form.breadthCm, form.heightCm].every((v) => !String(v || '').trim())
      ? ''
      : [form.lengthCm, form.breadthCm, form.heightCm]
          .map((v) => String(v || '').trim() || '—')
          .join(' x '));

  function setDimensions(raw: string) {
    setDimsDraft(raw);
    // Accept x, ×, *, comma or plain spaces as separators — sellers copy
    // dimensions from all sorts of places.
    const parts = raw
      .split(/[x×*,\s]+/i)
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p) => /^\d*\.?\d*$/.test(p));
    setForm((f) => ({
      ...f,
      lengthCm: parts[0] ?? '',
      breadthCm: parts[1] ?? '',
      heightCm: parts[2] ?? '',
    }));
  }

  /** Which status the in-flight save should apply.
   *  - 'draft'  → seller clicked "Save as draft" (image checks relaxed)
   *  - 'active' → seller clicked "Save & publish" on a draft
   *  - null     → plain save; status untouched (edit) / schema default (create)
   *  Set by the submit-row buttons right before the form submits. */
  const submitStatusRef = useRef<'active' | 'draft' | null>(null);
  const formEl = useRef<HTMLFormElement | null>(null);

  function submitAs(status: 'active' | 'draft') {
    submitStatusRef.current = status;
    formEl.current?.requestSubmit();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Consume the chosen status immediately so an early validation
    // return can't leak it into the next unrelated save.
    const chosenStatus = submitStatusRef.current;
    submitStatusRef.current = null;
    const asDraft = chosenStatus === 'draft';
    if (!selectedCategoryId) {
      notifyWarning(M.productForm.pleasePickACategory);
      return;
    }
    if (isBikeSpecific && !makeId) {
      notifyWarning(M.productForm.pleasePickABikeMakeOrTurn);
      return;
    }
    // SKU + Weight required — SKU is how orders reconcile back to the
    // seller's inventory; weight drives Shiprocket's rate cards, so a
    // missing value ends up billing the seller for a heavier package
    // than the actual parcel. Cheap to enforce here.
    if (!String(form.sku || '').trim()) {
      notifyWarning(M.productForm.sKUIsRequired);
      return;
    }
    const weightNum = Number(String(form.weightGrams || '').trim());
    if (!Number.isFinite(weightNum) || weightNum <= 0) {
      notifyWarning(M.productForm.weightGramsIsRequiredAndMustBe);
      return;
    }
    if (overPriceLimit(form.price)) {
      notifyWarning(M.productForm.priceTooHigh(MAX_PRICE_LABEL));
      return;
    }
    if (overPriceLimit(form.mrp)) {
      notifyWarning(M.productForm.mrpTooHigh(MAX_PRICE_LABEL));
      return;
    }
    if (variants.some((v) => overPriceLimit(v.price) || overPriceLimit(v.mrp))) {
      notifyWarning(M.productForm.variantPriceTooHigh(MAX_PRICE_LABEL));
      return;
    }
    if (form.hsn.trim() && !/^(\d{4}|\d{6}|\d{8})$/.test(form.hsn.trim())) {
      notifyWarning(M.productForm.hSNCodeMustBe46Or);
      return;
    }
    // Image-required guardrail — blocks saves that would leave the
    // storefront card blank. Per-color galleries count because the
    // seller can choose one of those colors as the listing thumbnail.
    // Tailor the message to the mode so sellers on a non-variation
    // product don't see confusing "color-variation image" copy that
    // doesn't apply to them. Also scrolls the images section into
    // view so it's obvious where to fix the issue — previously sellers
    // clicked Save from the top of the form and missed the uploader
    // living below the Description.
    // Draft saves skip the image guardrails — the whole point of a
    // draft is capturing incomplete work. The backend hides drafts
    // from the storefront, so a blank card can never leak.
    if (!hasAnyProductImage && !asDraft) {
      setAttempted(true);
      const inVariantMode = variantsMode && uniqueColors.length > 0;
      notifyWarning(M.productForm.addAtLeastOnePhoto(inVariantMode));
      try {
        const targetSel = inVariantMode
          ? '[data-form-section="color-images"]'
          : '[data-form-section="main-images"]';
        const el = document.querySelector(targetSel) as HTMLElement | null;
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (_) { /* noop */ }
      return;
    }
    // Per-color image requirement — when the product uses colour
    // variants, every color must carry at least one photo so the PDP's
    // color swatch grid never lands on an empty gallery. Named colours
    // without a matching upload are flagged one at a time so the
    // seller knows exactly which panel needs attention.
    if (variantsMode && uniqueColors.length > 0 && !asDraft) {
      const missing = uniqueColors.find(
        (c) => !colorImages[c] || colorImages[c].length === 0,
      );
      if (missing) {
        notifyWarning(M.productForm.pleaseUploadAtLeast1PhotoFor(missing));
        return;
      }
    }

    setSaving(true);
    try {
      const fd = new FormData();
      // Map form fields → API names
      fd.append('name', form.name);
      fd.append('category', selectedCategoryId);
      fd.append('brand', brandId || ''); // empty string = no brand
      if (form.description) fd.append('description', form.description);
      fd.append('price', form.price);
      if (form.mrp) fd.append('mrp', form.mrp);
      fd.append('stock', form.stock || '0');
      // SKU + weightGrams are now REQUIRED (see submit-time validation
      // above). Always send them so the backend can enforce its own
      // guardrail too — no `if (form.sku)` gate.
      fd.append('sku', String(form.sku || '').trim());
      fd.append('listingColor', listingColor);
      if (form.color) fd.append('color', form.color);
      // Always send sizes as JSON so backend gets a canonical array (even when empty)
      fd.append('sizes', JSON.stringify(sizes));
      fd.append('weightGrams', String(form.weightGrams || '').trim());
      // Box dimensions — only sent when the seller entered them so the
      // schema defaults (15/15/10 cm) apply for blank fields.
      if (String(form.lengthCm || '').trim()) {
        fd.append('lengthCm', String(form.lengthCm).trim());
      }
      if (String(form.breadthCm || '').trim()) {
        fd.append('breadthCm', String(form.breadthCm).trim());
      }
      if (String(form.heightCm || '').trim()) {
        fd.append('heightCm', String(form.heightCm).trim());
      }
      fd.append('gstRate', form.gstRate);
      fd.append('hsn', form.hsn.trim());

      // Variant matrix (Phase 1). Trim + coerce here so the backend sees a
      // canonical payload. The field is only sent at all when the seller
      // actually interacted with the variant section this session —
      // otherwise rows that were merely auto-generated on mount (legacy
      // product with sizes/color but no saved matrix) would post as
      // stock-0 variants and the backend's stock recompute would zero
      // out live inventory. An explicit '[]' means "the seller
      // deselected every color/size — clear the saved matrix"; the
      // backend distinguishes that from an absent/malformed payload.
      const toMoneyField = (raw: string) => {
        const n = Number(raw);
        return raw.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
      };
      const cleanVariants = variants
        .map((v) => ({
          size: v.size.trim(),
          color: v.color.trim(),
          stock: Number(v.stock) || 0,
          sku: v.sku.trim(),
          // null = sells at the product-level base price. Variant prices
          // are sent only when the seller explicitly enables the advanced
          // "different prices" control in the stock matrix.
          price: variantPricingEnabled ? toMoneyField(v.price) : null,
          // No matrix input for mrp yet — round-trip whatever the row
          // was loaded with so API-set overrides survive a form save.
          mrp: toMoneyField(v.mrp),
        }))
        .filter((v) => v.size || v.color || v.stock > 0);
      // Only submit the variants matrix when the seller is in
      // variation mode. Simple mode keeps a single-SKU product driven
      // purely by `form.stock` + `form.color`; sending variants here
      // would trigger the backend's stock recompute and wipe the
      // live top-level stock.
      if (variantsMode && (variantsTouchedRef.current || mode === 'create')) {
        fd.append('variants', cleanVariants.length > 0 ? JSON.stringify(cleanVariants) : '[]');
      }

      // SEO overrides — only sent when the seller actually typed
      // something. Sending empty strings is fine (the backend treats
      // them as "clear the override") but keeps the request payload
      // smaller when they're not in use.
      // Clamp to model limits — older local drafts may hold longer imported values.
      if (form.seoTitle)       fd.append('seoTitle', clampText(form.seoTitle, IMPORT_FIELD_LIMITS.seoTitle));
      if (form.seoDescription) fd.append('seoDescription', clampText(form.seoDescription, IMPORT_FIELD_LIMITS.seoDescription));
      if (form.ogImage)        fd.append('ogImage', form.ogImage);
      if (form.returnPolicyDays !== '' && !Number.isNaN(Number(form.returnPolicyDays))) {
        fd.append('returnPolicyDays', String(Number(form.returnPolicyDays)));
      }
      if (form.exchangePolicyDays !== '' && !Number.isNaN(Number(form.exchangePolicyDays))) {
        fd.append('exchangePolicyDays', String(Number(form.exchangePolicyDays)));
      }
      // Per-product COD override — always sent so unticking the toggle
      // on edit actually persists `false`.
      fd.append('codAvailable', String(!!form.codAvailable));
      // Status — only sent when a submit-row button explicitly chose
      // one. A plain "Save changes" leaves the stored status alone so
      // an admin-set state (e.g. rejected) is never overwritten.
      if (chosenStatus) fd.append('status', chosenStatus);

      if (isBikeSpecific) {
        // Prefer the most specific selection (model), fall back to make
        fd.append('bike', modelId || makeId);
      } else {
        fd.append('bike', '');
      }

      // Walk the unified gallery in display order, splitting items into a
      // `staged` queue (new File uploads, in the order they'll appear on
      // the multipart body) and an `imageOrder` manifest the backend uses
      // to interleave kept URLs with the freshly-uploaded files.
      //
      // imageOrder looks like:
      //   [ { type:'kept', url:'products/abc.png' },
      //     { type:'staged', index:0 },
      //     { type:'kept', url:'products/def.png' },
      //     { type:'staged', index:1 } ]
      //
      // The backend reads it once `req.files` is populated and builds
      // `product.images` from this list. Falls back to legacy
      // existingImages-then-uploads behaviour when imageOrder is missing.
      const stagedFiles: File[] = [];
      const imageOrder = imageItems.map((it) => {
        if (it.kind === 'kept') return { type: 'kept' as const, url: it.url };
        const index = stagedFiles.length;
        stagedFiles.push(it.file);
        return { type: 'staged' as const, index };
      });
      fd.append('imageOrder', JSON.stringify(imageOrder));

      // Per-color image manifest. Reuses the SAME `stagedFiles` array
      // as the main gallery so all Files travel on the one multer
      // `images` field. Each per-color staged item captures the
      // index into `stagedFiles` at the moment it's queued, so
      // there's no overlap with the main-gallery indices. On the
      // server, both manifests index into the same combined
      // `uploaded` URL list built from req.files. Colors with no
      // photos at all (neither kept nor staged) are dropped so we
      // don't waste the DB on empty entries.
      // Per-color image manifest — only submitted in variation mode.
      // In simple mode the product is a single SKU and per-color
      // galleries are meaningless.
      if (variantsMode) {
        const colorImagesManifest = uniqueColors
          .map((color) => {
            const items = colorImages[color] || [];
            const kept: string[] = [];
            const staged: number[] = [];
            for (const it of items) {
              if (it.kind === 'kept') {
                kept.push(it.url);
              } else if (it.kind === 'staged') {
                const idx = stagedFiles.length;
                stagedFiles.push(it.file);
                staged.push(idx);
              }
            }
            return { color, kept, staged };
          })
          .filter((e) => e.kept.length > 0 || e.staged.length > 0);
        if (colorImagesManifest.length > 0) {
          fd.append('colorImagesManifest', JSON.stringify(colorImagesManifest));
        } else if (colorImagesTouchedRef.current) {
          // The seller removed every per-color photo this session — send
          // an explicit empty manifest so the backend clears the saved
          // entries instead of guardrail-preserving them.
          fd.append('colorImagesManifest', '[]');
        }
      }
      // Otherwise the field is omitted — an absent field means "leave
      // prior colorImages alone", which is what a seller editing
      // unrelated fields expects.

      // Size chart image — reuses shared stagedFiles queue so the File
      // travels on the same multer `images` array. Manifest tells the
      // backend how to resolve: 'kept' preserves the prior URL, 'staged'
      // points into uploaded[]; null means "no chart".
      if (sizeChartImage) {
        if (sizeChartImage.kind === 'kept') {
          fd.append('sizeChartImageManifest', JSON.stringify({ kept: sizeChartImage.url, staged: null }));
        } else {
          const idx = stagedFiles.length;
          stagedFiles.push(sizeChartImage.file);
          fd.append('sizeChartImageManifest', JSON.stringify({ kept: null, staged: idx }));
        }
      } else if (sizeChartTouchedRef.current) {
        // Seller explicitly removed the chart this session — send explicit
        // null so backend clears the field.
        fd.append('sizeChartImageManifest', JSON.stringify({ kept: null, staged: null }));
      }
      // Otherwise omit the field so backend guardrails preserve the prior value.

      // A+ Content images — up to 3 marketing slots. Manifest is a
      // length-3 array of entries: `kept` preserves an existing S3
      // key, `staged` queues a File and references its index in
      // stagedFiles, and `null` marks an empty slot. On create we
      // always send the manifest so the seller can add A+ content in
      // the very first submit; on edit we only send when touched.
      if (aPlusTouchedRef.current || mode === 'create') {
        const aPlusManifest = aPlusImages.map((item) => {
          if (!item) return null;
          if (item.kind === 'kept') return { type: 'kept', url: item.url };
          const idx = stagedFiles.length;
          stagedFiles.push(item.file);
          return { type: 'staged', index: idx };
        });
        fd.append('aPlusImagesManifest', JSON.stringify(aPlusManifest));
      }

      // Legacy fallback — older backends still read this and append uploads
      // at the end. Harmless to send alongside imageOrder; new backend
      // prefers imageOrder when present.
      if (mode === 'edit') {
        const keptUrls = imageItems.filter((it) => it.kind === 'kept').map((it: any) => it.url);
        fd.append('existingImages', JSON.stringify(keptUrls));
        // Explicit "yes, I really do want to leave the main gallery empty"
        // signal. The backend refuses to wipe `product.images` from N>0
        // to 0 without this ack — protects against form-state desync bugs
        // that in the past silently deleted seller product photos.
        // Only sent when the seller has ZERO main images AND has at least
        // one per-color image to fall back on for the listing thumbnail.
        // BOTH conditions must hold — main gallery is intentionally empty
        // AND the per-color panel has at least one photo the storefront
        // can fall back to. When neither has photos, we NEVER send the
        // ack: that would ask the backend to drop everything, matching
        // the wipe class of bugs the strict guardrail was written for.
        if (imageItems.length === 0 && colorImageCount > 0) {
          fd.append('imagesWipeAck', '1');
        }
      }
      stagedFiles.forEach((f) => fd.append('images', f));
      const config = { headers: { 'Content-Type': 'multipart/form-data' } };

      if (mode === 'create') {
        await api.post('/products', fd, config);
        await finishLocalDraft();
        notifySuccess(M.productForm.productSaved(asDraft, true, false));
      } else {
        await api.put(`/products/${id}`, fd, config);
        notifySuccess(M.productForm.productSaved(asDraft, false, chosenStatus === 'active'));
      }
      if (onDone) onDone();
      else router.replace('/dashboard/products');
    } catch (e: any) {
      notifyError(e, M.productForm.couldntSave);
    } finally {
      setSaving(false);
    }
  }

  const extraImagesOpen = showExtraImages ?? aPlusImages.some(Boolean);
  const publishingOpen = showPublishing ??
    (form.returnPolicyDays !== '' || form.exchangePolicyDays !== '' || form.codAvailable === false);

  return (
    <Card className={styles.root} shadow="none">
      {/* overflow-visible overrides CardBody's default overflow-y-auto —
          an overflow container would swallow the sticky submit row. */}
      <CardBody className={styles.body}>
        {mode === 'create' && <details className={styles.importPanel}><summary><span><strong>Import from a product link</strong><span>Optional · fill in details from an existing product page</span></span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 9 6 6 6-6" /></svg></summary><ProductUrlImport onApply={applyUrlImport} categories={productCategoryRoots} brands={brands} disabled={saving || loadingCategories || loadingBrands} /></details>}
        <form ref={formEl} onSubmit={submit} className={styles.form} data-variants={variantsMode || undefined}>
          {/* Mode toggle — spans the whole form width. Turns on the
              Colors / Stock matrix / Per-color images panels on the
              right. All state persists across toggles so a seller can
              flip between modes without losing what they typed. */}
          <div className={styles.modeToggle}>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">
                Has sizes or colours
              </div>
              <div className="text-xs text-muted">
                For products sold in multiple sizes or colours, each with its own stock.
              </div>
            </div>
            <Switch
              className="shrink-0"
              isSelected={variantsMode}
              onValueChange={setVariantsMode}
              aria-label="Toggle variation mode"
            />
          </div>

          <div className="contents">
            <section className={styles.fields}>
          <SectionHeading title="Basics" hint="Name, category and which bikes it fits." />
          <Input labelPlacement="outside"
            {...INPUT_PROPS}
            label="Product name"
            isRequired
            placeholder="e.g. Akrapovic Slip-On Exhaust for Kawasaki Z900"
            description=""
            aria-label="Product name"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            className="sm:col-span-2"
          />

          {/* CATEGORY (cascading dropdowns) */}
          <div className="sm:col-span-2">
            <label className="text-sm font-medium block mb-1.5">
              Category <span className="text-danger">*</span>
            </label>
            {loadingCategories ? (
              <div className="flex items-center gap-2 text-muted py-2">
                <Spinner size="sm" /> Loading categories…
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {cascade.map((level, idx) => {
                  const placeholder =
                    idx === 0
                      ? 'Select a category'
                      : idx === 1
                      ? '— Select subcategory —'
                      : '— Select sub-subcategory —';
                  return (
                    <div key={idx}>
                      <SellerSelect fullWidth ariaLabel={idx === 0 ? 'Category' : idx === 1 ? 'Subcategory' : 'Sub-subcategory'} value={level.selected} onChange={value => {
                        const next = pickedIds.slice(0, idx);
                        if (value) next.push(value);
                        setPickedIds(next);
                      }} options={[{ value: '', label: placeholder }, ...level.options.map(option => ({ value: option._id, label: option.name }))]} />
                      {idx === 0 && (
                        <p className="text-xs text-muted mt-1">Top-level category</p>
                      )}
                      {idx === 1 && (
                        <p className="text-xs text-muted mt-1">Subcategory</p>
                      )}
                      {idx >= 2 && (
                        <p className="text-xs text-muted mt-1">More specific</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-muted mt-2">
              Pick the most specific category that fits.
            </p>
          </div>

          {/* BIKE-SPECIFIC SECTION */}
          <div className="sm:col-span-2 border border-border rounded-xl p-4 bg-surface-tertiary">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-sm font-semibold">Fits a specific bike</div>
                <div className="text-xs text-muted">
                  Leave off for universal items.
                </div>
              </div>
              <Switch
                isSelected={isBikeSpecific}
                onValueChange={(v) => {
                  setIsBikeSpecific(v);
                  if (!v) {
                    setMakeId('');
                    setModelId('');
                  }
                }}
              />
            </div>

            {isBikeSpecific && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="text-sm font-medium block mb-1.5">Bike make</label>
                  <SellerSelect fullWidth ariaLabel="Bike make" value={makeId} onChange={value => { setMakeId(value); setModelId(''); }} options={[{ value: '', label: '— Select a make —' }, ...bikeMakes.map(make => ({ value: make._id, label: make.name }))]} />
                </div>

                <div>
                  <label className="text-sm font-medium block mb-1.5">
                    Bike model <span className="text-muted text-xs font-normal">(optional)</span>
                  </label>
                  <SellerSelect fullWidth ariaLabel="Bike model" value={modelId} onChange={setModelId} disabled={!makeId || bikeModels.length === 0} options={[{ value: '', label: !makeId ? 'Pick a make first' : bikeModels.length === 0 ? 'Fits all models' : '— Any / All models —' }, ...bikeModels.map(model => ({ value: model._id, label: model.name }))]} />
                </div>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="product-brand" className="text-sm font-medium block mb-1.5">Brand</label>
            <SellerSelect fullWidth id="product-brand" ariaLabel="Brand" value={brandId} onChange={setBrandId} disabled={loadingBrands}
              options={[{ value: '', label: loadingBrands ? 'Loading brands…' : 'No brand' }, ...brands.map(b => ({ value: b._id, label: b.name }))]} />
            <p className="text-xs text-muted mt-1">
              {loadingBrands ? 'Loading brands…' : `${brands.length} brands available. Leave empty if unbranded.`}
            </p>
          </div>
          <Input labelPlacement="outside"
            {...INPUT_PROPS}
            label="SKU"
            isRequired
            placeholder="e.g. AKR-Z900-SLIP"
            description="Used to match orders back to your inventory."
            aria-label="SKU"
            value={form.sku}
            onChange={(e) => update('sku', e.target.value)}
          />

          <SectionHeading title="Pricing, stock & shipping" hint="What the buyer pays, how many you have, and what the courier needs." />
          {/* Pricing — what the buyer pays and what it's marked down from.
              Weight moved out of this row: it's a shipping fact, not a
              commercial one, and now sits beside Box size. */}
          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input labelPlacement="outside"
              {...INPUT_PROPS}
              type="text" inputMode="decimal"
              label="Selling price (₹)"
              isRequired
              placeholder="e.g. 39999"
              description={`Up to ${MAX_PRICE_LABEL}.`}
              aria-label="Price"
              value={form.price}
              onChange={(e) => update('price', e.target.value)}
              min={0}
            />
            <Input labelPlacement="outside"
              {...INPUT_PROPS}
              type="text" inputMode="decimal"
              label="MRP (₹)"
              placeholder="e.g. 45999"
              description="Shown crossed-out when above the selling price."
              aria-label="MRP"
              value={form.mrp}
              onChange={(e) => update('mrp', e.target.value)}
              min={0}
            />
          </div>

          {/* Tax — printed on the GST invoice. The selling price above
              already includes this GST; the invoice splits it back out. */}
          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="product-gst-rate" className="text-sm font-medium block mb-1.5">
                GST rate (included in price)
              </label>
              <SellerSelect fullWidth id="product-gst-rate" ariaLabel="GST rate (included in price)" value={String(form.gstRate)} onChange={value => update('gstRate', value)} options={[0, 5, 12, 18, 28].map(rate => ({ value: String(rate), label: `${rate}%` }))} />
              <p className="text-xs text-muted mt-1">Shown as CGST + SGST or IGST on the customer&apos;s invoice.</p>
            </div>
            <Input labelPlacement="outside"
              {...INPUT_PROPS}
              type="text" inputMode="numeric"
              label="HSN code"
              placeholder="e.g. 8714"
              description="4, 6 or 8 digits. Printed on the tax invoice."
              aria-label="HSN code"
              value={form.hsn}
              onChange={(e) => update('hsn', e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
          </div>

          {/* Box dimensions — ONE field, "L × W × H".
              Was three separate numeric inputs taking a full row, each with
              its own "Leave empty for the 15 cm default" hint. Sellers think
              of a box as one measurement, so they type it as one. Parsed
              back into lengthCm / breadthCm / heightCm on change, which
              keeps the backend contract (and the Shiprocket volumetric
              calculation) exactly as it was. */}
          {/* Shipping — the two numbers the courier quote depends on. */}
          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input labelPlacement="outside"
              {...INPUT_PROPS}
              type="text" inputMode="decimal"
              label="Weight (grams)"
              isRequired
              placeholder="e.g. 3500"
              description="Including packaging. Sets courier charges."
              aria-label="Weight in grams"
              value={form.weightGrams}
              onChange={(e) => update('weightGrams', e.target.value)}
              min={0}
            />
            <Input labelPlacement="outside"
              {...INPUT_PROPS}
              type="text"
              label="Box size (cm)"
              placeholder="30 x 25 x 20"
              description="Length × width × height. Blank uses 15 × 15 × 10."
              aria-label="Box dimensions, length by width by height in centimetres"
              value={dimensions}
              onChange={(e) => setDimensions(e.target.value)}
            />
          </div>

          {/* Simple-mode Stock + Color row — a single-SKU product still
              needs a total stock count and an optional color label.
              Hidden in variation mode where the color chip picker and
              stock matrix on the right handle both. */}
          {!variantsMode && (
            <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input labelPlacement="outside"
                {...INPUT_PROPS}
                type="text" inputMode="decimal"
                label="Stock available (units)"
                placeholder="e.g. 25"
                description="Orders reduce this automatically."
                aria-label="Stock"
                value={form.stock}
                onChange={(e) => update('stock', e.target.value)}
                min={0}
              />
              <Input labelPlacement="outside"
                {...INPUT_PROPS}
                label="Color"
                placeholder="e.g. Black"
                description=""
                aria-label="Color"
                value={form.color}
                onChange={(e) => update('color', e.target.value)}
              />
            </div>
          )}

            </section>

            {variantsMode && (
            <aside className="flex flex-col gap-5 min-w-0 xl:row-span-4 xl:sticky xl:top-6">
              <SectionHeading title="Variations" hint="Colours, sizes and stock for each." />
          {/* COLORS — multi-select chip picker. Sits side-by-side with the
              sizes picker (each spans one column of the form grid) so the
              pair costs half the vertical space. A chip toggles off with a
              second click, so there's no separate "selected" list — custom
              entries render as chips right after the presets. Selected
              colors drive the stock & price matrix below AND the "Images
              per color" section. Only rendered in variation mode. */}
          {variantsMode && (
          <div className="border border-border rounded-xl p-4 bg-surface-tertiary">
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-sm font-semibold">Colors available</div>
              {colors.length > 0 && (
                <span className="text-xs text-muted">{colors.length} selected</span>
              )}
            </div>
            <div className="text-xs text-muted mb-2.5">
              Tap all colors this product comes in. Leave empty for single-color items.
            </div>

            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map((c) => (
                <SizeChip
                  key={c}
                  label={c}
                  selected={colors.includes(c)}
                  onToggle={() => toggleColor(c)}
                />
              ))}
              {colors
                .filter((c) => !PRESET_COLORS.includes(c))
                .map((c) => (
                  <SizeChip key={c} label={`${c} ×`} selected onToggle={() => removeColor(c)} />
                ))}
            </div>

            <div className="flex gap-2 mt-2.5">
              <Input
                {...INPUT_PROPS}
                size="sm"
                placeholder="Custom color (e.g. Rose Gold)"
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomColor();
                  }
                }}
              />
              <Button size="sm" variant="flat" onPress={addCustomColor} className="shrink-0">
                + Add
              </Button>
            </div>
          </div>
          )}

          {/* SIZES + size chart — only meaningful in Variation mode.
              A seller who picks sizes almost always wants per-size stock,
              so we hide the whole panel in Simple mode to keep that flow
              focused (single stock, single color label). */}
          {variantsMode && (
          <div className="border border-border rounded-xl p-4 bg-surface-tertiary">
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-sm font-semibold">Sizes available</div>
              {sizes.length > 0 && (
                <span className="text-xs text-muted">{sizes.length} selected</span>
              )}
            </div>
            <div className="text-xs text-muted mb-2.5">
              Tap all sizes this product comes in. Leave empty for one-size / universal items.
            </div>

            {/* Clothing / apparel row */}
            <div className="mb-2.5">
              <div className="text-xs uppercase tracking-wide font-semibold text-muted mb-1.5">
                Apparel sizes
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CLOTHING_SIZES.map((s) => (
                  <SizeChip key={s} label={s} selected={sizes.includes(s)} onToggle={() => toggleSize(s)} />
                ))}
              </div>
            </div>

            {/* Numeric / waist row */}
            <div className="mb-2.5">
              <div className="text-xs uppercase tracking-wide font-semibold text-muted mb-1.5">
                Waist (inches)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {NUMERIC_SIZES.map((s) => (
                  <SizeChip key={s} label={s} selected={sizes.includes(s)} onToggle={() => toggleSize(s)} />
                ))}
              </div>
            </div>

            {/* Custom sizes the seller previously added — render only when non-empty. */}
            {sizes.some((s) => !CLOTHING_SIZES.includes(s) && !NUMERIC_SIZES.includes(s)) && (
              <div className="mb-2.5">
                <div className="text-xs uppercase tracking-wide font-semibold text-muted mb-1.5">
                  Custom sizes
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {sizes
                    .filter((s) => !CLOTHING_SIZES.includes(s) && !NUMERIC_SIZES.includes(s))
                    .map((s) => (
                      <SizeChip key={s} label={`${s} ×`} selected onToggle={() => removeSize(s)} />
                    ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-2.5">
              <Input
                {...INPUT_PROPS}
                size="sm"
                placeholder="Custom size (e.g. UK 9, 28x32)"
                value={customSize}
                onChange={(e) => setCustomSize(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomSize();
                  }
                }}
              />
              <Button size="sm" variant="flat" onPress={addCustomSize} className="shrink-0">
                + Add
              </Button>
            </div>

            {/* ─── Size chart image ─────────────────────────────────
                Optional single upload showing measurements / fit
                guidance. Shopper sees it as a "View size chart" link
                on the PDP right by the size selector. */}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="text-sm font-semibold text-foreground mb-1">
                Size chart image <span className="font-normal text-muted">(optional)</span>
              </div>
              <div className="text-xs text-muted mb-2.5">
                Upload a measurement guide (chest / waist / length chart) so shoppers pick the right fit.
                Recommended: a clear JPG or PNG under 2 MB.
              </div>

              {sizeChartImage ? (
                <div className="flex items-start gap-3">
                  <div className="relative w-24 h-24 rounded-lg overflow-hidden border border-border bg-white shrink-0">
                    <img
                      src={sizeChartImage.kind === 'staged'
                        ? sizeChartImage.preview
                        : imageUrl(sizeChartImage.url)}
                      alt="Size chart"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button size="sm" variant="flat" onPress={removeSizeChart} className="w-fit">
                      Remove
                    </Button>
                    <button
                      type="button"
                      onClick={() => setPickerState({
                        target: 'sizeChart',
                        maxSelect: 1,
                        title: 'Replace size chart image',
                      })}
                      className="text-xs text-muted cursor-pointer underline w-fit text-left"
                    >
                      Replace with another image
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPickerState({
                    target: 'sizeChart',
                    maxSelect: 1,
                    title: 'Pick a size chart image',
                  })}
                  className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border bg-surface-tertiary hover:bg-surface-tertiary cursor-pointer p-6 text-center transition-colors"
                >
                  <div className="text-xs font-semibold text-foreground">Click to upload size chart</div>
                  <div className="text-xs text-muted">PNG or JPG, up to 2 MB</div>
                </button>
              )}
            </div>
          </div>
          )}

          {/* Stock by size / color. Prices stay simple by default: every
              variant uses the product-level price unless the seller turns
              on the advanced variant-price switch below. Only rendered
              in variation mode. */}
          {variantsMode && (
          <div className="sm:col-span-2 border border-border rounded-xl p-4 bg-surface-tertiary">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
              <div className="text-sm font-semibold">Stock by size / color</div>
              {variants.length > 0 && (
                <span className="text-xs text-muted">
                  Total:{' '}
                  <span className="font-semibold text-foreground">{variantStockTotal}</span>{' '}
                  unit{variantStockTotal === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {variants.length === 0 ? (
              <div className="text-xs text-muted">
                No colors or sizes picked — set the total stock in Simple mode instead, or
                pick a color / size above.
              </div>
            ) : (
              <>
                <div className="text-xs text-muted mb-3">
                  Type how many units you have of each combination. Blank variant prices use
                  the product price{form.price ? ` (₹${form.price})` : ''}.
                </div>

                <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-white px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">
                      Different price for some variants
                    </div>
                    <div className="text-xs text-muted">
                      Turn on only when a size or color sells at a different price.
                    </div>
                  </div>
                  <Switch
                    size="sm"
                    isSelected={variantPricingEnabled}
                    onValueChange={(v) => {
                      variantsTouchedRef.current = true;
                      setVariantPricingEnabled(v);
                    }}
                  />
                </div>

                {/* Toolbar — quick stock / price fill */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
                  {variants.length > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">Fill all:</span>
                      <input
                        type="text" inputMode="decimal"
                        min={0}
                        placeholder="Stock"
                        aria-label="Quick-fill stock for all variants"
                        value={quickStock}
                        onChange={(e) => setQuickStock(e.target.value)}
                        onKeyDown={blockEnterSubmit}
                        className="h-8 w-20 text-center text-xs tabular-nums border-2 border-border hover:border-muted focus:border-foreground rounded-lg bg-surface outline-none transition"
                      />
                      {variantPricingEnabled && (
                        <input
                          type="text" inputMode="decimal"
                          min={0}
                          placeholder="Price"
                          aria-label="Quick-fill price for all variants"
                          value={quickPrice}
                          onChange={(e) => setQuickPrice(e.target.value)}
                          onKeyDown={blockEnterSubmit}
                          className="h-8 w-20 text-center text-xs tabular-nums border-2 border-border hover:border-muted focus:border-foreground rounded-lg bg-surface outline-none transition"
                        />
                      )}
                      <Button size="sm" variant="flat" onPress={applyQuickFill}>
                        Apply
                      </Button>
                    </div>
                  )}
                </div>

                {/* The matrix itself. Horizontal scroll (not wrap) when the
                    size range is wide, so rows always stay aligned. */}
                <div className="overflow-x-auto">
                  <table className="border-separate border-spacing-x-1.5 border-spacing-y-1.5">
                    <thead>
                      <tr>
                        {/* Sticky corner + row headers: on a narrow screen
                            the matrix scrolls horizontally, and the color
                            labels must stay put or stock lands in the
                            wrong row. bg matches the panel to mask the
                            cells sliding beneath. */}
                        <th aria-hidden className="sticky left-0 z-10 bg-surface-tertiary" />
                        {(sizes.length ? sizes : ['']).map((s) => (
                          <th
                            key={s || '__onesize__'}
                            className="text-center text-xs font-semibold text-muted min-w-[76px] px-0.5"
                            title={s || 'One size'}
                          >
                            {s || 'One size'}
                          </th>
                        ))}
                        <th className="text-right text-xs font-semibold text-muted pl-2">
                          Units
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(colors.length ? colors : ['']).map((c) => {
                        const rowSizes = sizes.length ? sizes : [''];
                        const rowTotal = rowSizes.reduce((sum, s) => {
                          const idx = variantIndex.get(`${c}::${s}`);
                          return sum + (idx === undefined ? 0 : Number(variants[idx].stock) || 0);
                        }, 0);
                        return (
                          <tr key={c || '__nocolor__'}>
                            <th
                              className="sticky left-0 z-10 bg-surface-tertiary text-left text-xs font-semibold text-foreground pr-2 whitespace-nowrap align-middle max-w-[140px] truncate"
                              title={c || 'Any color'}
                            >
                              {c || <span className="text-muted italic font-normal">Any color</span>}
                            </th>
                            {rowSizes.map((s) => {
                              const idx = variantIndex.get(`${c}::${s}`);
                              if (idx === undefined) return <td key={s || '__onesize__'} />;
                              const row = variants[idx];
                              const cellName = `${c || 'any color'} ${s || 'one size'}`;
                              return (
                                <td key={s || '__onesize__'} className="align-top">
                                  <div className="flex w-[76px] flex-col gap-1">
                                    <input
                                      type="text" inputMode="decimal"
                                      min={0}
                                      placeholder="0"
                                      aria-label={`Stock for ${cellName}`}
                                      value={row.stock}
                                      onChange={(e) => updateVariantCell(idx, 'stock', e.target.value)}
                                      onKeyDown={blockEnterSubmit}
                                      className="h-9 w-full text-center text-sm tabular-nums font-medium border-2 border-border hover:border-muted focus:border-foreground rounded-lg bg-surface outline-none transition"
                                    />
                                    {variantPricingEnabled && (
                                      <div className="relative">
                                        <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-xs text-muted">
                                          ₹
                                        </span>
                                        <input
                                          type="text" inputMode="decimal"
                                          min={0}
                                          step="0.01"
                                          placeholder={form.price || 'base'}
                                          aria-label={`Price for ${cellName}`}
                                          value={row.price}
                                          onChange={(e) => updateVariantCell(idx, 'price', e.target.value)}
                                          onKeyDown={blockEnterSubmit}
                                          className="h-8 w-full pl-4 text-center text-xs tabular-nums border-2 border-border hover:border-muted focus:border-foreground rounded-lg bg-surface outline-none transition placeholder:text-muted"
                                        />
                                      </div>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                            <td className="text-right text-xs align-middle pl-2 whitespace-nowrap">
                              <span className="font-semibold text-foreground tabular-nums">
                                {rowTotal}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
          )}


            </aside>
            )}
          </div>

          <SectionHeading title="Description & images" className="xl:col-span-1 xl:col-start-1" />
          {/* Description — TipTap rich-text editor. Persists HTML so the
              storefront's product page can render headings, lists, bold,
              links, etc. Plain-text descriptions from existing products
              are accepted (TipTap shows them as-is in a single <p>) and
              upgrade in place the first time a seller edits. */}
          <div className="min-w-0 xl:col-start-1">
            <label className="block text-sm font-medium mb-1">
              Description
            </label>
            <RichTextEditor
              value={form.description}
              key={`description-${descriptionImportVersion}`}
              onChange={(html) => update('description', html)}
              placeholder="Write the product description — features, materials, fit, what's in the box…"
              ariaLabel="Product description"
              minHeight={180}
              showFullscreen={false}
            />
          </div>

          {/* Flat "Images (up to N)" grid — the classic product gallery.
              When the seller has switched the product into colour variants
              AND named at least one colour, we HIDE this grid so the
              per-colour blocks below become the only image entry point.
              That matches shopper expectations: every colour has its own
              distinct photos, and no photos live outside a colour. Non-
              variant products keep the flat grid as-is. */}
          {!(variantsMode && uniqueColors.length > 0) && (
          <div className="min-w-0 xl:col-start-1" data-form-section="main-images">
            <div className="flex items-baseline justify-between mb-2">
              <label className="text-sm font-medium">Images (up to {MAX_IMAGES})</label>
              <span className="text-xs text-muted">
                {imageItems.length} / {MAX_IMAGES}
              </span>
            </div>
            {!hasAnyProductImage && attempted && (
              <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700" role="alert">
                Add at least one product image to publish. You can still save a draft without one.
              </div>
            )}

            {imageItems.length > 0 && (
              <div className="flex flex-wrap gap-3 mb-3">
                {imageItems.map((it, i) => {
                  const isKept = it.kind === 'kept';
                  const previewSrc = isKept ? imageUrl(it.url) : it.preview;
                  const isDragOver = dragOverIndex === i;
                  return (
                    <div
                      key={it.id}
                      draggable
                      onDragStart={(e) => {
                        dragIndexRef.current = i;
                        e.dataTransfer.effectAllowed = 'move';
                        try { e.dataTransfer.setData('text/plain', String(i)); } catch (_) {}
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverIndex !== i) setDragOverIndex(i);
                      }}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        setDragOverIndex(i);
                      }}
                      onDragLeave={(e) => {
                        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                        if (dragOverIndex === i) setDragOverIndex(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = dragIndexRef.current;
                        setDragOverIndex(null);
                        dragIndexRef.current = null;
                        if (from == null) return;
                             moveImageItem(from, i);
                      }}
                      onDragEnd={() => {
                        setDragOverIndex(null);
                        dragIndexRef.current = null;
                      }}
                      className={`relative group cursor-grab active:cursor-grabbing select-none transition ${
                        isDragOver ? 'scale-105' : ''
                      }`}
                      title="Drag to reorder"
                    >
                      <img
                        src={previewSrc}
                        alt=""
                        className={`w-24 h-24 object-cover rounded-lg pointer-events-none ${
                          isKept
                            ? 'border border-border'
                            : 'border-2 border-accent'
                        } ${isDragOver ? 'ring-2 ring-accent' : ''}`}
                      />
                      {/* "1" / "2" / ... position badge so reorders are
                          unambiguous to the seller */}
                      <span className="absolute top-1 left-1 bg-white/90 text-foreground text-xs font-bold rounded px-1.5 py-0.5 shadow-sm pointer-events-none">
                        {i + 1}
                      </span>
                      {!isKept && (
                        <span className="absolute bottom-1 left-1 right-1 text-xs bg-accent/85 text-brand-cream px-1 py-0.5 rounded text-center truncate pointer-events-none">
                          new
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeImageItem(it.id);
                        }}
                        aria-label="Remove image"
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-danger text-white text-xs font-bold grid place-items-center shadow hover:scale-110 transition"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add-images button (custom-styled label wrapping a hidden file input) */}
            {imageItems.length < MAX_IMAGES ? (
              <button
                type="button"
                onClick={() => setPickerState({
                  target: 'main',
                  maxSelect: MAX_IMAGES - imageItems.length,
                  title: 'Add product images',
                })}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md border-2 border-dashed border-border hover:border-foreground hover:bg-surface-tertiary cursor-pointer text-sm font-semibold transition select-none"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                + Add images
              </button>
            ) : (
              <div className="text-xs text-muted">
                Maximum {MAX_IMAGES} images reached. Remove one to add another.
              </div>
            )}

            <p className="text-xs text-muted mt-2">
              PNG, JPG, WEBP up to 5MB each. Drag any tile to reorder — the
              first image becomes the product&rsquo;s main thumbnail.
              {mode === 'edit' && imageItems.some((it) => it.kind === 'staged') &&
                ' New uploads (black border) will be saved alongside the kept images.'}
            </p>
          </div>
          )}

          {/* Images per color — only in variation mode. Anchored to
              grid column 1 so it sits right beneath the Description, in
              place of the flat "Images (up to N)" grid we hide when
              variants have colours. Previously used `sm:col-span-2`
              which broke it out to the bottom of the form on the xl
              2-column layout, below the sticky aside content. */}
          {variantsMode && uniqueColors.length > 0 && (
          <div
            className="min-w-0 xl:col-start-1 border border-border rounded-xl p-4 bg-surface-tertiary"
            data-form-section="color-images"
          >
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <div className="text-sm font-semibold">Images per color</div>
              {uniqueColors.length > 0 && (
                <span className="text-xs text-muted">
                  {uniqueColors.length} color{uniqueColors.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div className="text-xs text-muted mb-3">
              At least 1 photo per color is required. Upload up to {MAX_COLOR_IMAGES} photos per
              color so customers see the exact variant they&rsquo;re picking.
            </div>

            {uniqueColors.length > 0 && (
              <div className="mb-3 rounded-lg border border-border bg-white p-3">
                <div className="text-xs font-semibold text-foreground mb-1">
                  Product list thumbnail
                </div>
                <div className="text-xs text-muted mb-2">
                  Pick which color should represent this product on listing cards.
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setListingColor('')}
                    aria-pressed={!listingColor}
                    className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold transition ${
                      !listingColor
                        ? 'bg-[#141414] text-white border-[#141414]'
                        : 'bg-surface text-foreground border-border hover:border-muted'
                    }`}
                  >
                    Auto
                  </button>
                  {uniqueColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setListingColor(color)}
                      aria-pressed={listingColor === color}
                      className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold transition ${
                        listingColor === color
                          ? 'bg-[#141414] text-white border-[#141414]'
                          : 'bg-surface text-foreground border-border hover:border-muted'
                      }`}
                    >
                      {color}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {uniqueColors.length === 0 ? (
              <div className="text-xs text-muted italic">
                Pick a color in the &ldquo;Colors available&rdquo; panel above to unlock per-color image uploads.
              </div>
            ) : (
              /* Two panels per row on desktop — halves the section height
                 for multi-color products. */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {uniqueColors.map((color) => {
                  const items = colorImages[color] || [];
                  const atMax = items.length >= MAX_COLOR_IMAGES;
                  return (
                    <div
                      key={color}
                      className="rounded-lg border border-border bg-white p-3"
                    >
                      <div className="flex items-baseline justify-between gap-3 mb-2">
                        <div className="text-sm font-semibold text-foreground">
                          {color}
                        </div>
                        <span className="text-xs text-muted">
                          {items.length}/{MAX_COLOR_IMAGES}
                        </span>
                      </div>

                      {items.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {items.map((it) => {
                            const isKept = it.kind === 'kept';
                            const previewSrc = isKept ? imageUrl(it.url) : it.preview;
                            return (
                              <div key={it.id} className="relative">
                                <img
                                  src={previewSrc}
                                  alt=""
                                  className={`w-16 h-16 object-cover rounded-lg pointer-events-none ${
                                    isKept
                                      ? 'border border-border'
                                      : 'border-2 border-accent'
                                  }`}
                                />
                                {!isKept && (
                                  <span className="absolute bottom-1 left-1 right-1 text-xs bg-accent/85 text-brand-cream px-1 py-0.5 rounded text-center truncate pointer-events-none">
                                    new
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => removeColorImageItem(color, it.id)}
                                  aria-label={`Remove ${color} image`}
                                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-danger text-white text-xs font-bold grid place-items-center shadow hover:scale-110 transition"
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {atMax ? (
                        <div className="text-xs text-muted">
                          Maximum {MAX_COLOR_IMAGES} images reached for {color}. Remove one to add another.
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPickerState({
                            target: 'color',
                            color,
                            maxSelect: MAX_COLOR_IMAGES - (colorImages[color]?.length || 0),
                            title: `Pick photos for ${color}`,
                          })}
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border-2 border-dashed border-border hover:border-foreground hover:bg-surface-tertiary cursor-pointer text-xs font-semibold transition select-none"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21 15 16 10 5 21" />
                          </svg>
                          + Add {color} photos
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}
          {/* ─── Extra images (optional, collapsed) — UX audit S6. This
              block used to sit in the right-hand rail beside required
              fields, at half the form's width. */}
          <CollapsibleHeading
            className="xl:col-span-1 xl:col-start-1"
            hint="Up to 3 marketing images at the foot of the product page."
            onToggle={() => setShowExtraImages(!extraImagesOpen)}
            open={extraImagesOpen}
            title="Extra images (optional)"
          />
          {extraImagesOpen && (
          <div className="xl:col-start-1">
          {/* ─── A+ Content Images (optional) ─────────────────────────
              Amazon-style marketing images shown at the bottom of the
              storefront PDP. Three slots: two square tiles on top,
              one wide banner below. Each slot is independent; empty
              slots are allowed. */}
          <div className="sm:col-span-2 border border-border rounded-xl p-4 bg-surface-tertiary">
            <div className="text-sm font-semibold text-foreground mb-1">
              Extra images <span className="font-normal text-muted">(optional)</span>
            </div>
            <div className="text-xs text-muted mb-3">
              Up to 3 marketing images (sometimes called A+ content), shown at the foot of the product page.
            </div>

            {/* Upload slots — Top Left / Top Right / Bottom Banner.
                The empty "layout preview" placeholder that used to live
                above was removed because the real upload slots below
                already show the same shape (2 squares on top + wide
                banner) with the same aspect ratios. */}
            <div className="grid grid-cols-2 gap-3">
              {[0, 1].map((slot) => {
                const item = aPlusImages[slot];
                const label = slot === 0 ? 'Top left' : 'Top right';
                return (
                  <div key={slot}>
                    <div className="text-xs uppercase tracking-wide font-semibold text-muted mb-1.5">
                      {label}
                    </div>
                    {item ? (
                      <div className="relative aspect-square rounded-lg overflow-hidden border border-border bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.kind === 'staged' ? item.preview : imageUrl(item.url)}
                          alt={label}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeAPlus(slot)}
                          aria-label={`Remove ${label}`}
                          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 hover:bg-black text-white text-sm leading-none flex items-center justify-center"
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPickerState({
                          target: 'aplus',
                          aplusSlot: slot as 0 | 1,
                          maxSelect: 1,
                          title: slot === 0 ? 'Pick top-left image' : 'Pick top-right image',
                        })}
                        className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-surface-tertiary hover:bg-surface-tertiary cursor-pointer p-3 text-center transition-colors"
                      >
                        <div className="text-xs font-semibold text-foreground">Click to upload</div>
                        <div className="text-xs text-muted">PNG or JPG</div>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Bottom-wide banner slot. */}
            <div className="mt-3">
              <div className="text-xs uppercase tracking-wide font-semibold text-muted mb-1.5">
                Bottom banner
              </div>
              {aPlusImages[2] ? (
                <div className="relative aspect-video rounded-lg overflow-hidden border border-border bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={aPlusImages[2]!.kind === 'staged' ? (aPlusImages[2] as any).preview : imageUrl((aPlusImages[2] as any).url)}
                    alt="Bottom banner"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeAPlus(2)}
                    aria-label="Remove Bottom banner"
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/70 hover:bg-black text-white text-sm leading-none flex items-center justify-center"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPickerState({
                    target: 'aplus',
                    aplusSlot: 2,
                    maxSelect: 1,
                    title: 'Pick bottom banner image',
                  })}
                  className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-surface-tertiary hover:bg-surface-tertiary cursor-pointer p-4 text-center transition-colors"
                >
                  <div className="text-xs font-semibold text-foreground">Click to upload wide banner</div>
                  <div className="text-xs text-muted">PNG or JPG, wide aspect works best</div>
                </button>
              )}
            </div>
          </div>
          </div>
          )}

          {/* ─── Return / Exchange overrides (optional) ───
              Sellers set default windows on the Profile tab. This
              panel lets them override per-product. Blank = use profile
              default; 0 = disable returns/exchanges for this product.
              Hidden on very wide screens — the sticky action rail
              carries compact versions of these fields there. */}
          <CollapsibleHeading
            className=""
            hint="Return window and Cash on Delivery for this product. Blank = your Profile defaults."
            onToggle={() => setShowPublishing(!publishingOpen)}
            open={publishingOpen}
            title="Publishing options (optional)"
          />
          {publishingOpen && (<>
          <div className="sm:col-span-2">
            <div className="text-sm font-semibold text-foreground mb-1">
              Return &amp; exchange window
            </div>
            <div className="text-xs text-muted mb-4">
              Optional. Leave blank to use the defaults from your Profile
              tab, type a number of days for a custom window, or
              <span className="font-semibold"> 0</span> to disable
              returns/exchanges for this product only.
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Input
                labelPlacement="outside"
                label="Return window (days)"
                type="text" inputMode="decimal"
                min={0}
                max={365}
                placeholder="Use profile default"
                value={form.returnPolicyDays}
                onChange={(e) => update('returnPolicyDays', e.target.value)}
                description="How long a customer can request a return."
                {...INPUT_PROPS}
              />
              <Input
                labelPlacement="outside"
                label="Exchange window (days)"
                type="text" inputMode="decimal"
                min={0}
                max={365}
                placeholder="Use profile default"
                value={form.exchangePolicyDays}
                onChange={(e) => update('exchangePolicyDays', e.target.value)}
                description="How long a customer can request an exchange."
                {...INPUT_PROPS}
              />
            </div>
          </div>

          {/* ─── Cash on Delivery (per-product) ───
              The seller's global COD switch lives on the Profile tab.
              This toggle restricts THIS product to online payment only
              even when COD is enabled globally. Hidden on very wide
              screens — the sticky action rail carries it there. */}
          <div className="sm:col-span-2 border-t border-border pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-foreground mb-1">
                  Cash on Delivery
                </div>
                <div className="text-xs text-muted">
                  Let customers pay cash on delivery for this product. Turn off to
                  accept <span className="font-semibold">online payment only</span>.
                </div>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer select-none shrink-0 pt-1">
                <span className="text-xs text-muted">
                  {form.codAvailable ? 'COD allowed' : 'Online only'}
                </span>
                <span className="relative inline-block w-10 h-5">
                  <input
                    type="checkbox"
                    checked={!!form.codAvailable}
                    onChange={(e) => setForm((f) => ({ ...f, codAvailable: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <span className="absolute inset-0 rounded-full bg-border peer-checked:bg-emerald-500 transition-colors" />
                  <span className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5" />
                </span>
              </label>
            </div>
          </div>

          </>)}

          {/* Submit row — sticky so the actions stay reachable while the
              (long) form scrolls. Two behaviours:
              - Normal screens: pins to the bottom of the viewport as a
                translucent action bar inside the card.
              - Very wide screens (≥1850px, where the page has an empty
                right gutter next to the card): floats as a fixed action
                rail on the right instead, stacked vertically with the
                primary action on top. */}
          <div className={styles.actions}>
            <div className={styles.actionButtons}>
            <Button
              type="button"
              variant="bordered"
              className={styles.secondary}
              onPress={() => void cancel()}
              isDisabled={saving}
            >
              Cancel
            </Button>
            {/* Save as draft — keeps the listing off the storefront.
                Image requirements are relaxed for drafts so sellers can
                park incomplete work and finish it later. */}
            <Button
              type="button"
              variant="bordered"
              className={styles.secondary}
              onPress={() => submitAs('draft')}
              isDisabled={saving}
            >
              {mode === 'edit' && initial.status !== 'draft'
                ? 'Move to draft'
                : 'Save as draft'}
            </Button>
            {mode === 'edit' && initial.status === 'draft' ? (
              // Draft being edited — the primary action publishes it.
              <Button
                type="button"
                color="primary"
                className={styles.primary}
                onPress={() => submitAs('active')}
                isLoading={saving}
              >
                Save &amp; publish
              </Button>
            ) : (
              // Plain save — status untouched on edit; schema default
              // ('active') on create.
              <Button
                type="submit"
                color="primary"
                className={styles.primary}
                isLoading={saving}
              >
                {mode === 'edit' ? 'Save changes' : 'Add product'}
              </Button>
            )}
            </div>
          </div>
        </form>

        {/* ─── Shared media picker modal ───────────────────────────
            Opened by every image-upload CTA on the form. On Insert
            we translate the returned S3 keys into whichever tile
            shape the target surface expects (kept ImageItem /
            ColorImageItem / SizeChartItem / APlusItem) — same code
            path a re-opened edit form uses for existing images. */}
        {pickerState && (
          <MediaPickerModal
            open
            onClose={() => setPickerState(null)}
            maxSelect={pickerState.maxSelect}
            singleSelect={pickerState.maxSelect === 1}
            title={pickerState.title}
            onInsert={(keys) => {
              if (pickerState.target === 'main') {
                const newItems: ImageItem[] = keys.map((url) => ({
                  id: `k-lib-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${url}`,
                  kind: 'kept' as const,
                  url,
                }));
                setImageItems((prev) => [...prev, ...newItems].slice(0, MAX_IMAGES));
              } else if (pickerState.target === 'color') {
                const color = pickerState.color;
                colorImagesTouchedRef.current = true;
                setColorImages((prev) => {
                  const cur = prev[color] || [];
                  const newItems: ColorImageItem[] = keys.map((url) => ({
                    id: `k-lib-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${url}`,
                    kind: 'kept' as const,
                    url,
                  }));
                  return { ...prev, [color]: [...cur, ...newItems].slice(0, MAX_COLOR_IMAGES) };
                });
              } else if (pickerState.target === 'sizeChart' && keys[0]) {
                sizeChartTouchedRef.current = true;
                // If replacing a staged blob, revoke the old preview so
                // we don't leak the object URL.
                if (sizeChartImage && sizeChartImage.kind === 'staged') {
                  URL.revokeObjectURL(sizeChartImage.preview);
                }
                setSizeChartImage({ kind: 'kept' as const, url: keys[0] });
              } else if (pickerState.target === 'aplus' && keys[0]) {
                aPlusTouchedRef.current = true;
                const slot = pickerState.aplusSlot;
                setAPlusImages((prev) => {
                  const next = prev.slice();
                  const old = next[slot];
                  if (old && old.kind === 'staged') URL.revokeObjectURL(old.preview);
                  next[slot] = { id: `k-lib-aplus-${slot}-${Date.now()}`, kind: 'kept' as const, url: keys[0] };
                  return next;
                });
              }
              setPickerState(null);
            }}
          />
        )}
      </CardBody>
    </Card>
  );
}

/* ─────── section heading (UX audit S6) ───────
   The form used to be one 2,000 px run of inputs. Headings give it a
   table of contents a seller can scan; optional groups collapse. */
function SectionHeading({ title, hint, className = '' }: { title: string; hint?: string; className?: string }) {
  return (
    <div className={`${styles.sectionHeading} ${className}`}>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** A heading that opens/closes an optional group. */
function CollapsibleHeading({ title, hint, open, onToggle, className = '' }: {
  title: string; hint?: string; open: boolean; onToggle: () => void; className?: string;
}) {
  return (
    <div className={`col-span-full border-t border-border pt-5 ${className}`}>
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus rounded"
        onClick={onToggle}
        type="button"
      >
        <span>
          <span className="text-base font-semibold text-foreground">{title}</span>
          {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
        </span>
        <svg aria-hidden className={`size-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </div>
  );
}

/* ─────── small toggle chip used by the size picker ─────── */
function SizeChip({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center px-3 h-8 rounded-full text-xs font-medium border transition-colors ${
        selected
          ? 'bg-accent text-accent-foreground border-accent'
          : 'bg-surface text-foreground border-border hover:border-foreground'
      }`}
    >
      {label}
    </button>
  );
}
