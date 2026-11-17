'use client';

/**
 * Seller dashboard — Offer create / edit (/dashboard/offers/new and
 * /dashboard/offers/[id]).
 *
 * ONE component handles both modes:
 *   - mode='create' — POST to /seller/offers
 *   - mode='edit'   — GET /seller/offers/:id on mount, PUT on submit
 *
 * Uses the shared FormField / FormInput / FormTextarea primitives
 * (see components/common/FormField.tsx) so field styling matches
 * ProductForm and the seller auth screens.
 *
 * Product picker UX decision — we chose a "chip picker" over a big
 * checkbox list because the seller typically wants to attach an offer
 * to a handful of specific SKUs, not sweep across the whole catalog.
 * Currently-selected products render as removable chips at the top;
 * a search-filtered list of the remaining products sits below with a
 * "+ Add" button per row. For very small catalogs this reads more or
 * less like a checkbox list anyway.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader, Input, Spinner, Switch } from '@heroui/react';
import Button from '@/components/common/SellerButton';
import SellerDatePicker from '@/components/common/SellerDatePicker';
import { DetailSkeleton } from '@/components/ui';
import { FormField, FormInput, FormTextarea } from '@/components/common/FormField';
import { api, imageUrl, unwrap } from '@/lib/api';
import styles from './DashboardOfferForm.module.css';
import { notifyError, notifySuccess, notifyWarning, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';
import { startNewProductDraft } from '@/lib/productCreateDraft';

type DiscountType = 'percent' | 'flat';
type Scope = 'all' | 'selected';

type Product = {
  _id: string;
  name: string;
  slug?: string;
  listingImage?: string;
  images?: string[];
  price?: number;
};

type OfferResponse = {
  _id: string;
  title: string;
  description?: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscount?: number | null;
  minCartAmount?: number | null;
  scope: Scope;
  products?: (string | { _id: string })[];
  productSummaries?: Product[];
  startsAt?: string | null;
  endsAt?: string | null;
  enabled: boolean;
};

type Props = {
  mode: 'create' | 'edit';
  id?: string;
};

/**
 * ISO → value string that a <input type="datetime-local"> can consume.
 * The input expects "YYYY-MM-DDTHH:MM" in local time; we deliberately
 * do NOT round-trip through UTC because that would visually shift the
 * seller's picked dates by their tz offset.
 */
function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * datetime-local value string → ISO for the API. Empty string means
 * "unset this field" — send null so the backend can clear it.
 */
function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function DashboardOfferFormPage({ mode, id }: Props) {
  const router = useRouter();

  // Loading state — the edit page has to fetch before we can render.
  const [loading, setLoading] = useState(mode === 'edit');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('percent');
  const [discountValue, setDiscountValue] = useState<string>('');
  const [maxDiscount, setMaxDiscount] = useState<string>('');
  const [minCartAmount, setMinCartAmount] = useState<string>('');
  const [scope, setScope] = useState<Scope>('all');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [enabled, setEnabled] = useState(true);

  // Product catalog for the picker — loaded once on mount.
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState(false);
  const [productRetry, setProductRetry] = useState(0);
  const [productSearch, setProductSearch] = useState('');

  // Field-level errors — populated on submit failure. We surface each
  // one under its corresponding field so the seller doesn't have to
  // scroll up to a top-of-form banner.
  const [fieldError, setFieldError] = useState<Record<string, string>>({});

  /* ─── fetch existing offer in edit mode ─── */
  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    // Reset the server-backed form when navigating to a different offer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    api
      .get(`/seller/offers/${id}`)
      .then((r) => {
        const o: OfferResponse = unwrap<{ offer: OfferResponse }>(r).offer;
        if (!o || !o._id) throw new Error('Offer not found');
        setTitle(o.title || '');
        setDescription(o.description || '');
        setDiscountType(o.discountType || 'percent');
        setDiscountValue(o.discountValue != null ? String(o.discountValue) : '');
        setMaxDiscount(o.maxDiscount != null ? String(o.maxDiscount) : '');
        setMinCartAmount(o.minCartAmount != null ? String(o.minCartAmount) : '');
        setScope(o.scope || 'all');
        // Products can arrive either as a bare id array or as populated
        // documents — normalize to ids here.
        const ids: string[] = (o.products || []).map((p) =>
          typeof p === 'string' ? p : p._id,
        );
        setSelectedProductIds(ids);
        setStartsAt(toLocalInput(o.startsAt));
        setEndsAt(toLocalInput(o.endsAt));
        setEnabled(o.enabled !== false);
        setLoadError(null);
      })
      .catch((e: any) => {
        setLoadError(apiMessage(e) || 'Could not load offer.');
      })
      .finally(() => setLoading(false));
  }, [mode, id]);

  /* ─── fetch product catalog for the picker ─── */
  useEffect(() => {
    const controller = new AbortController();
    api
      .get('/products/mine', { signal: controller.signal })
      .then((r) => {
        if (controller.signal.aborted) return;
        setProductsError(false);
        const { items } = unwrap<{ items?: any[] }>(r);
        const raw = Array.isArray(items) ? items : [];
        setProducts(raw);
      })
      .catch(() => {
        if (!controller.signal.aborted) setProductsError(true);
      })
      .finally(() => { if (!controller.signal.aborted) setProductsLoading(false); });
    return () => controller.abort();
  }, [productRetry]);

  const productsById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p._id, p);
    return m;
  }, [products]);

  const selectedProducts = useMemo(() => {
    return selectedProductIds
      .map((pid) => productsById.get(pid))
      .filter((p): p is Product => Boolean(p));
  }, [selectedProductIds, productsById]);

  // Products the seller has NOT yet picked, filtered by search term.
  const availableProducts = useMemo(() => {
    const selectedSet = new Set(selectedProductIds);
    const needle = productSearch.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedSet.has(p._id)) return false;
      if (!needle) return true;
      return p.name.toLowerCase().includes(needle);
    });
  }, [products, selectedProductIds, productSearch]);

  function addProduct(pid: string) {
    setSelectedProductIds((prev) => (prev.includes(pid) ? prev : [...prev, pid]));
  }
  function removeProduct(pid: string) {
    setSelectedProductIds((prev) => prev.filter((x) => x !== pid));
  }

  /* ─── validation ─── */
  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = 'Give this offer a title (e.g. "Diwali Sale").';
    const dv = Number(discountValue);
    if (!discountValue || isNaN(dv) || dv <= 0)
      errs.discountValue = 'Enter a discount amount greater than 0.';
    else if (discountType === 'percent' && dv > 100)
      errs.discountValue = 'Percentage cannot exceed 100%.';
    if (maxDiscount) {
      const mx = Number(maxDiscount);
      if (isNaN(mx) || mx < 0) errs.maxDiscount = 'Max cap must be a positive number.';
    }
    if (minCartAmount) {
      const mn = Number(minCartAmount);
      if (isNaN(mn) || mn < 0) errs.minCartAmount = 'Min cart must be a positive number.';
    }
    if (scope === 'selected' && selectedProductIds.length === 0)
      errs.products = 'Pick at least one product, or switch scope to "All my products".';
    if (startsAt && endsAt) {
      if (new Date(endsAt).getTime() <= new Date(startsAt).getTime())
        errs.endsAt = 'End date must be after start date.';
    }
    return errs;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const errs = validate();
    setFieldError(errs);
    if (Object.keys(errs).length > 0) {
      notifyWarning(M.offerForm.pleaseFixTheHighlightedFields);
      return;
    }

    const payload: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || undefined,
      discountType,
      discountValue: Number(discountValue),
      // Backend treats null / omitted as "no cap / no minimum"; keep
      // the intent explicit by sending null when the seller left the
      // field blank.
      maxDiscount:
        discountType === 'percent' && maxDiscount !== ''
          ? Number(maxDiscount)
          : null,
      minCartAmount: minCartAmount !== '' ? Number(minCartAmount) : null,
      scope,
      products: scope === 'selected' ? selectedProductIds : [],
      startsAt: localInputToIso(startsAt),
      endsAt: localInputToIso(endsAt),
      enabled,
    };

    setSaving(true);
    try {
      if (mode === 'create') {
        await api.post('/seller/offers', payload);
        notifySuccess(M.offerForm.offerCreated);
      } else {
        await api.put(`/seller/offers/${id}`, payload);
        notifySuccess(M.offerForm.offerUpdated);
      }
      router.replace('/dashboard/offers');
    } catch (e: any) {
      notifyError(e, M.offerForm.couldntSaveTheOffer);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <DetailSkeleton cards={2} rows={4} />
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="max-w-2xl">
          <Card className="border border-red-200/70">
            <CardBody className="p-6">
              <div className="text-red-800 font-semibold">Couldn't load this offer</div>
              <div className="text-sm text-red-700 mt-1">{loadError}</div>
              <div className="mt-4">
                <Link href="/dashboard/offers">
                  <Button variant="bordered" className="font-semibold border-2">
                    Back to offers
                  </Button>
                </Link>
              </div>
            </CardBody>
          </Card>
        </div>
      </>
    );
  }

  return (
    <div className={styles.page}>
      <Link href="/dashboard/offers" className={styles.back}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 19-7-7 7-7M5 12h14" /></svg>
        <span>Back to offers</span>
      </Link>
      <h1 className="sr-only">{mode === 'create' ? 'Create an offer' : 'Edit offer'}</h1>
      <form onSubmit={onSubmit} className={styles.layout}>
        <div className={styles.fields}>
          {/* ─── Basics ─── */}
          <Card className={styles.section} shadow="none">
            <CardHeader className={styles.sectionHeader}>
              <div className={styles.sectionEyebrow}>
                Basics
              </div>
              <div className={styles.sectionTitle}>The offer</div>
            </CardHeader>
            <CardBody className={styles.sectionBody}>
              <FormField label="Title" required htmlFor="offer-title">
                <FormInput
                  id="offer-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Weekend riding essentials"
                  required
                />
                {fieldError.title && (
                  <span className="text-xs text-rose-600 mt-1">{fieldError.title}</span>
                )}
              </FormField>

              <FormField label="Description (optional)" htmlFor="offer-desc">
                <FormTextarea
                  id="offer-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short line for shoppers, e.g. 20% off everything this weekend."
                  rows={3}
                />
              </FormField>
            </CardBody>
          </Card>

          {/* ─── Discount ─── */}
          <Card className={styles.section} shadow="none">
            <CardHeader className={styles.sectionHeader}>
              <div className={styles.sectionEyebrow}>
                Discount
              </div>
              <div className={styles.sectionTitle}>How much off?</div>
            </CardHeader>
            <CardBody className={styles.sectionBody}>
              {/* Discount type — radio row, not a Select, because it changes
                  which follow-up fields render. */}
              <FormField label="Discount type" required>
                <div className={styles.choices}>
                  <TypeCard
                    active={discountType === 'percent'}
                    onClick={() => setDiscountType('percent')}
                    title="Percentage discount"
                    subtitle="e.g. 20% off eligible products"
                  />
                  <TypeCard
                    active={discountType === 'flat'}
                    onClick={() => setDiscountType('flat')}
                    title="Fixed amount"
                    subtitle="e.g. ₹500 off the cart"
                  />
                </div>
              </FormField>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  label={discountType === 'percent' ? 'Percent off' : 'Flat amount off'}
                  required
                  htmlFor="offer-value"
                >
                  <div className="relative">
                    <FormInput
                      id="offer-value"
                      type="number"
                      inputMode="decimal"
                      min={0.01}
                      max={discountType === 'percent' ? 100 : undefined}
                      step="0.01"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      placeholder={discountType === 'percent' ? '20' : '500'}
                      className="pr-10"
                      required
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-default-500 pointer-events-none">
                      {discountType === 'percent' ? '%' : '₹'}
                    </span>
                  </div>
                  {fieldError.discountValue && (
                    <span className="text-xs text-rose-600 mt-1">
                      {fieldError.discountValue}
                    </span>
                  )}
                </FormField>

                {discountType === 'percent' && (
                  <FormField label="Max discount cap" htmlFor="offer-cap">
                    <div className="relative">
                      <FormInput
                        id="offer-cap"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="1"
                        value={maxDiscount}
                        onChange={(e) => setMaxDiscount(e.target.value)}
                        placeholder="e.g. 500"
                        className="pl-8"
                      />
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-default-500 pointer-events-none">
                        ₹
                      </span>
                    </div>
                    <span className="text-[11px] text-default-500 mt-1">
                      Cap the rupee value of the % discount. Leave blank for no cap.
                    </span>
                    {fieldError.maxDiscount && (
                      <span className="text-xs text-rose-600 mt-1">
                        {fieldError.maxDiscount}
                      </span>
                    )}
                  </FormField>
                )}

                <FormField label="Minimum cart amount" htmlFor="offer-min">
                  <div className="relative">
                    <FormInput
                      id="offer-min"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="1"
                      value={minCartAmount}
                      onChange={(e) => setMinCartAmount(e.target.value)}
                      placeholder="e.g. 1000"
                      className="pl-8"
                    />
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-default-500 pointer-events-none">
                      ₹
                    </span>
                  </div>
                  <span className="text-[11px] text-default-500 mt-1">
                    Only applies to carts at or above this total. Leave blank for no minimum.
                  </span>
                  {fieldError.minCartAmount && (
                    <span className="text-xs text-rose-600 mt-1">
                      {fieldError.minCartAmount}
                    </span>
                  )}
                </FormField>
              </div>
            </CardBody>
          </Card>

          {/* ─── Scope ─── */}
          <Card className={styles.section} shadow="none">
            <CardHeader className={styles.sectionHeader}>
              <div className={styles.sectionEyebrow}>
                Scope
              </div>
              <div className={styles.sectionTitle}>Applies to</div>
            </CardHeader>
            <CardBody className={styles.sectionBody}>
              <div className={styles.choices}>
                <TypeCard
                  active={scope === 'all'}
                  onClick={() => setScope('all')}
                  title="All my products"
                  subtitle="Anything in your catalog qualifies"
                />
                <TypeCard
                  active={scope === 'selected'}
                  onClick={() => setScope('selected')}
                  title="Selected products"
                  subtitle="Pick specific SKUs below"
                />
              </div>

              {scope === 'selected' && (
                <div className="rounded-xl border border-default-200 bg-default-50/50 p-4 flex flex-col gap-3">
                  {/* Selected chips */}
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.2em] font-semibold text-default-500 mb-2">
                      Selected · {selectedProducts.length}
                    </div>
                    {selectedProducts.length === 0 ? (
                      <div className="text-sm text-default-500 italic">
                        None yet — add products from the list below.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedProducts.map((p) => (
                          <span
                            key={p._id}
                            className="inline-flex items-center gap-2 rounded-full bg-white border border-default-300 pl-1.5 pr-2 py-1 text-xs"
                            title={p.name}
                          >
                            <span className="w-5 h-5 rounded-full overflow-hidden bg-default-100 shrink-0">
                              {(p.listingImage || p.images?.[0]) && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={imageUrl(p.listingImage || p.images![0])}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </span>
                            <span className="font-medium text-brand-black max-w-[160px] truncate">
                              {p.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeProduct(p._id)}
                              className="text-default-500 hover:text-rose-600 transition font-bold text-sm leading-none"
                              aria-label={`Remove ${p.name}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {fieldError.products && (
                      <div className="text-xs text-rose-600 mt-2">{fieldError.products}</div>
                    )}
                  </div>

                  {/* Search + available list */}
                  <div className="pt-2 border-t border-default-200">
                    <Input
                      type="search"
                      size="sm"
                      variant="bordered"
                      aria-label="Search products for this offer"
                      placeholder="Search your products…"
                      value={productSearch}
                      onValueChange={setProductSearch}
                      className="mb-2"
                    />
                    {productsLoading ? (
                      <div className="flex items-center gap-2 text-default-500 py-4 text-sm">
                        <Spinner size="sm" /> Loading your products…
                      </div>
                    ) : productsError ? (
                      <div role="alert" className="text-sm text-rose-700">Could not load your products. <button type="button" className="underline" onClick={() => { setProductsLoading(true); setProductRetry(v => v + 1); }}>Try again</button></div>
                    ) : products.length === 0 ? (
                      <div className="text-sm text-default-500 italic py-3">
                        You don't have any products yet.{' '}
                        <Link
                          href="/dashboard/products/new"
                          onNavigate={startNewProductDraft}
                          className="text-brand-black underline underline-offset-2"
                        >
                          Add one
                        </Link>{' '}
                        first.
                      </div>
                    ) : availableProducts.length === 0 ? (
                      <div className="text-sm text-default-500 italic py-3">
                        {productSearch.trim()
                          ? 'No matches — try a different search.'
                          : 'Every product is already selected.'}
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto rounded-lg border border-default-200 bg-white divide-y divide-default-100">
                        {availableProducts.slice(0, 200).map((p) => (
                          <div
                            key={p._id}
                            className="flex items-center gap-3 px-3 py-2 hover:bg-default-50 transition"
                          >
                            <div className="w-9 h-9 rounded-md bg-default-100 overflow-hidden shrink-0">
                              {(p.listingImage || p.images?.[0]) && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={imageUrl(p.listingImage || p.images![0])}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-brand-black truncate">
                                {p.name}
                              </div>
                              {typeof p.price === 'number' && (
                                <div className="text-xs text-default-500">
                                  ₹{new Intl.NumberFormat('en-IN').format(p.price)}
                                </div>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="flat"
                              className="h-7 text-xs"
                              onPress={() => addProduct(p._id)}
                            >
                              + Add
                            </Button>
                          </div>
                        ))}
                        {availableProducts.length > 200 && (
                          <div className="text-[11px] text-default-500 px-3 py-2 bg-default-50">
                            Showing first 200 — search to narrow down.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* ─── Validity + toggle ─── */}
          <Card className={styles.section} shadow="none">
            <CardHeader className={styles.sectionHeader}>
              <div className={styles.sectionEyebrow}>
                Schedule
              </div>
              <div className={styles.sectionTitle}>Validity &amp; status</div>
            </CardHeader>
            <CardBody className={styles.sectionBody}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Starts at" htmlFor="offer-start">
                  <SellerDatePicker
                    id="offer-start"
                    ariaLabel="Starts at"
                    includeTime
                    value={startsAt}
                    onChange={setStartsAt}
                  />
                  <span className="text-[11px] text-default-500 mt-1">
                    Optional — leave blank to start immediately.
                  </span>
                </FormField>

                <FormField label="Ends at" htmlFor="offer-end">
                  <SellerDatePicker
                    id="offer-end"
                    ariaLabel="Ends at"
                    includeTime
                    value={endsAt}
                    onChange={setEndsAt}
                  />
                  <span className="text-[11px] text-default-500 mt-1">
                    Optional — leave blank for "always on".
                  </span>
                  {fieldError.endsAt && (
                    <span className="text-xs text-rose-600 mt-1">{fieldError.endsAt}</span>
                  )}
                </FormField>
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-default-200 bg-default-50/50 px-4 py-3">
                <Switch
                  isSelected={enabled}
                  onValueChange={setEnabled}
                  size="sm"
                  aria-label="Enabled"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-brand-black">
                    {enabled ? 'Enabled' : 'Disabled'}
                  </div>
                  <div className="text-xs text-default-500">
                    {enabled
                      ? 'Applies to qualifying carts during the selected schedule.'
                      : 'Hidden from shoppers — no discounts will apply.'}
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

        </div>
        <aside className={styles.summary}>
          <div className={styles.summaryTop}><p>OFFER SUMMARY</p><h2>{title.trim() || 'Your new offer'}</h2><strong>{discountValue && Number(discountValue) > 0 ? (discountType === 'percent' ? discountValue + '%' : '₹' + new Intl.NumberFormat('en-IN').format(Number(discountValue))) + ' off' : 'Set your discount'}</strong><span>Applied automatically at checkout</span></div>
          <dl>
            <div><dt>Products</dt><dd>{scope === 'all' ? 'All my products' : selectedProductIds.length + ' selected'}</dd></div>
            <div><dt>Minimum cart</dt><dd>{minCartAmount ? '₹' + minCartAmount : 'No minimum'}</dd></div>
            {discountType === 'percent' && <div><dt>Discount cap</dt><dd>{maxDiscount ? '₹' + maxDiscount : 'No cap'}</dd></div>}
            <div><dt>Starts</dt><dd>{startsAt ? new Date(startsAt).toLocaleString('en-IN', {dateStyle:'medium',timeStyle:'short'}) : 'Immediately when enabled'}</dd></div>
            <div><dt>Ends</dt><dd>{endsAt ? new Date(endsAt).toLocaleString('en-IN', {dateStyle:'medium',timeStyle:'short'}) : 'No end date'}</dd></div>
            <div><dt>Status</dt><dd>{enabled ? 'Enabled · follows schedule' : 'Disabled'}</dd></div>
          </dl>
          <div className={styles.summaryActions}>
            <Button type="submit" className={styles.primary} isLoading={saving} isDisabled={saving}>{mode === 'create' ? 'Create offer' : 'Save changes'}</Button>
            <Button type="button" variant="light" isDisabled={saving} onPress={() => router.push('/dashboard/offers')}>Cancel</Button>
            <p>{enabled ? 'Your offer will apply to eligible carts according to its schedule.' : 'Save this offer disabled. You can enable it from your offers list later.'}</p>
          </div>
        </aside>
      </form>
    </div>
  );
}

/* ─── option card used by the type + scope radio rows ─────────── */

function TypeCard({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-left rounded-xl border px-4 py-3 transition ${
        active
          ? 'border-brand-black bg-brand-black/[0.03] ring-2 ring-brand-black/15'
          : 'border-default-200 bg-white hover:border-default-400'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`w-4 h-4 rounded-full border-2 grid place-items-center ${
            active ? 'border-brand-black' : 'border-default-400'
          }`}
        >
          {active && <span className="w-2 h-2 rounded-full bg-brand-black" />}
        </span>
        <span className="text-sm font-bold text-brand-black">{title}</span>
      </div>
      <div className="text-xs text-default-500 mt-1 pl-6">{subtitle}</div>
    </button>
  );
}
