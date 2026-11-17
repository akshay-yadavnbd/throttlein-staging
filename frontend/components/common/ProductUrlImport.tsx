'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import SellerSelect from '@/components/common/SellerSelect';
import { Textarea } from '@heroui/react';
import Button from '@/components/common/SellerButton';
import Checkbox from '@/components/common/SellerCheckbox';
import { api, unwrap } from '@/lib/api';
import { clampImportedDraft, descriptionHtml, importLimitIssues, MAX_IMPORT_URLS, parseImportUrls, type ProductImportResult } from '@/lib/productUrlImport';
import { apiMessage } from '@/lib/notify';

type CategoryNode = { _id: string; name: string; parent: string | null; isActive: boolean; children: CategoryNode[] };
type BrandLite = { _id: string; name: string };

/** One product in a multi-URL import, from fetch to saved draft. */
type BulkRow = {
  url: string;
  status: 'queued' | 'fetching' | 'waiting' | 'ready' | 'failed' | 'saving' | 'saved';
  message?: string;
  result?: ProductImportResult;
  include: boolean;
  name: string; price: string; mrp: string; stock: string; sku: string; weightGrams: string;
  categoryId: string; brandId: string;
};

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
});
const errorText = (e: any, fallback: string) => apiMessage(e) || fallback;
const MAX_RATE_RETRIES = 4;

/** How the import works, in three lines, shown above the link box. */
const STEPS: [string, string][] = [
  ['Paste links', 'One link fills this form; several create a draft each.'],
  ['Fetch & preview', 'We read the page and pull in photos, text and price.'],
  ['Edit, then publish', 'Nothing is saved or published until you say so.'],
];

export default function ProductUrlImport({ onApply, disabled = false, categories = [], brands = [] }: {
  onApply: (result: ProductImportResult, replaceDescription: boolean) => void;
  disabled?: boolean;
  /** Product category tree (Shop by Bike excluded) — used to pick categories for multi-URL drafts. */
  categories?: CategoryNode[];
  brands?: BrandLite[];
}) {
  const [urlText, setUrlText] = useState('');
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProductImportResult | null>(null);
  // Over-limit fields are flagged right under the link box, before the
  // seller fills anything else — not as a save error at the very end.
  const limitIssues = useMemo(() => (result ? importLimitIssues(result.draft) : []), [result]);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);
  const [replaceDescription, setReplaceDescription] = useState(false);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const hasUrl = !!urlText.trim();

  const parsed = useMemo(() => parseImportUrls(urlText), [urlText]);
  const several = parsed.urls.length > 1;

  const categoryOptions = useMemo(() => {
    const out: { id: string; label: string; name: string }[] = [];
    const visit = (nodes: CategoryNode[], path: string[]) => nodes.forEach((n) => {
      if (!n.isActive) return;
      const label = [...path, n.name];
      out.push({ id: n._id, label: label.join(' › '), name: n.name.toLowerCase() });
      visit(n.children || [], label);
    });
    visit(categories, []);
    return out;
  }, [categories]);

  const update = (i: number, patch: Partial<BulkRow>) => setRows((current) => current.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /** Source category names rarely match ours exactly ("Helmet" vs "Helmets"); pick only an unambiguous match. */
  function matchCategory(source: string) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/(es|s)\b/g, '');
    const want = norm(source || '');
    if (!want) return [];
    const exact = categoryOptions.filter((c) => norm(c.name) === want);
    if (exact.length) return exact;
    return categoryOptions.filter((c) => { const n = norm(c.name); return n.length > 2 && (n.includes(want) || want.includes(n)); });
  }

  function rowFromResult(row: BulkRow, res: ProductImportResult): BulkRow {
    const d = res.draft;
    const cat = matchCategory(d.categoryName);
    const brand = brands.filter((b) => b.name.toLowerCase() === (d.brandName || '').toLowerCase());
    return {
      ...row, status: 'ready', result: res, message: undefined,
      name: d.name || '', price: d.currency === 'INR' && d.price ? String(d.price) : '', mrp: d.currency === 'INR' && d.mrp ? String(d.mrp) : '',
      stock: '', sku: d.sku || '', weightGrams: d.weightGrams ? String(d.weightGrams) : '',
      categoryId: cat.length === 1 ? cat[0].id : '', brandId: brand.length === 1 ? brand[0]._id : '',
    };
  }

  /** Imports are rate-limited per account, so a batch is fetched one by one and waits out any limit. */
  async function fetchOne(url: string, signal: AbortSignal, onWait: (seconds: number) => void) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return unwrap<ProductImportResult>(await api.post('/products/import-url', { url, confirmRights: true }, { signal, timeout: 90000 }));
      } catch (e: any) {
        if (e?.response?.status !== 429 || attempt >= MAX_RATE_RETRIES) throw e;
        const seconds = Math.min(90, Math.max(10, Number(e.response.data?.details?.retryAfter ?? e.response.data?.retryAfter) || 30));
        onWait(seconds);
        await sleep(seconds * 1000, signal);
      }
    }
  }

  async function fetchAll() {
    if (!rights || !hasUrl || busy || saving || disabled) return;
    if (parsed.invalid.length) { setError(`These are not complete https links: ${parsed.invalid.slice(0, 3).join(', ')}`); return; }
    if (!parsed.urls.length) { setError('Paste at least one public https product link.'); return; }
    if (parsed.urls.length > MAX_IMPORT_URLS) { setError(`Import up to ${MAX_IMPORT_URLS} links at a time.`); return; }
    const request = new AbortController();
    controller.current = request;
    setBusy(true); setError(''); setResult(null); setApplied(false);

    if (!several) {
      try {
        const data = await fetchOne(parsed.urls[0], request.signal, () => {});
        if (!request.signal.aborted) setResult(data);
      } catch (e: any) {
        if (!request.signal.aborted) setError(errorText(e, 'Import failed. Your existing fields have not changed. Please try again.'));
      } finally { if (!request.signal.aborted) setBusy(false); }
      return;
    }

    const initial: BulkRow[] = parsed.urls.map((url) => ({ url, status: 'queued', include: true, name: '', price: '', mrp: '', stock: '', sku: '', weightGrams: '', categoryId: '', brandId: '' }));
    setRows(initial);
    for (let i = 0; i < initial.length; i += 1) {
      if (request.signal.aborted) break;
      update(i, { status: 'fetching', message: undefined });
      try {
        const data = await fetchOne(initial[i].url, request.signal, (s) => update(i, { status: 'waiting', message: `Import limit reached — continuing in ${s}s` }));
        setRows((current) => current.map((r, j) => (j === i ? rowFromResult(r, data) : r)));
      } catch (e: any) {
        if (request.signal.aborted) break;
        update(i, { status: 'failed', include: false, message: errorText(e, 'Could not read this page.') });
      }
    }
    if (!request.signal.aborted) setBusy(false);
  }

  function rowProblems(r: BulkRow): string[] {
    const p: string[] = [];
    if (r.name.trim().length < 2) p.push('name');
    if (!(Number(r.price) > 0)) p.push('price');
    if (!r.sku.trim()) p.push('SKU');
    if (!(Number(r.weightGrams) > 0)) p.push('weight');
    if (!r.categoryId) p.push('category');
    if (r.mrp && Number(r.mrp) < Number(r.price)) p.push('MRP below price');
    return p;
  }

  const toSave = rows.filter((r) => r.include && r.status === 'ready');
  const blocked = toSave.filter((r) => rowProblems(r).length);

  async function saveAll() {
    if (!rights || disabled || !toSave.length || blocked.length || saving) return;
    setSaving(true);
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      if (!r.include || r.status !== 'ready' || !r.result) continue;
      update(i, { status: 'saving' });
      const d = clampImportedDraft(r.result.draft);
      const fd = new FormData();
      fd.append('name', r.name.trim());
      fd.append('category', r.categoryId);
      fd.append('brand', r.brandId || '');
      if (d.description) fd.append('description', descriptionHtml(d.description));
      fd.append('price', r.price);
      if (r.mrp) fd.append('mrp', r.mrp);
      fd.append('stock', r.stock || '0');
      fd.append('sku', r.sku.trim());
      fd.append('weightGrams', r.weightGrams);
      for (const k of ['lengthCm', 'breadthCm', 'heightCm'] as const) if (d[k]) fd.append(k, String(d[k]));
      if (d.color) fd.append('color', d.color);
      if (d.sizes?.length) fd.append('sizes', JSON.stringify(d.sizes));
      if (d.seoTitle) fd.append('seoTitle', d.seoTitle);
      if (d.seoDescription) fd.append('seoDescription', d.seoDescription);
      fd.append('status', 'draft');
      r.result.images.forEach((image) => {
        const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
        fd.append('images', new File([bytes], image.name, { type: image.mime }));
      });
      try {
        await api.post('/products', fd, { timeout: 120000 });
        update(i, { status: 'saved', message: 'Saved as a draft' });
      } catch (e: any) {
        update(i, { status: 'ready', message: errorText(e, 'Could not save this product.') });
      }
    }
    setSaving(false);
  }

  const savedCount = rows.filter((r) => r.status === 'saved').length;
  const inputCls = 'w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-foreground disabled:opacity-60';
  const statusLabel: Record<BulkRow['status'], string> = { queued: 'Waiting', fetching: 'Reading page…', waiting: 'Paused', ready: 'Ready to review', failed: 'Could not import', saving: 'Saving…', saved: 'Saved as draft' };

  /* The panel's heading lives in the <summary> that opens it (see
     ProductForm), so this body starts straight with how it works. */
  return <div className="p-5 sm:p-6" role="group" aria-label="Import from product URLs">
    <ol className="mb-5 grid gap-2 sm:grid-cols-3">
      {STEPS.map(([title, detail], i) => (
        <li key={title} className="flex gap-2.5 rounded-lg border border-[#e3e7eb] bg-[#fafbfc] px-3 py-2.5">
          <span aria-hidden="true" className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#191d21] text-[10px] font-semibold text-[#bdff00]">{i + 1}</span>
          <span className="min-w-0">
            <strong className="block text-[12px] font-semibold leading-4 text-foreground">{title}</strong>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted">{detail}</span>
          </span>
        </li>
      ))}
    </ol>
    <Textarea label="Product links" labelPlacement="outside" placeholder={'https://brand.com/products/example\nhttps://brand.com/products/another'}
      variant="bordered" minRows={2} maxRows={8} value={urlText} onValueChange={(v) => {
        setUrlText(v); setError('');
        if (!v.trim()) setRights(false);
      }} isDisabled={busy || saving || disabled}
      classNames={{
        label: 'text-xs font-medium text-[#46525c]',
        inputWrapper: 'rounded-lg border border-[#e3e7eb] bg-white shadow-none data-[hover=true]:border-[#bbc5cd] group-data-[focus=true]:border-[#59656f]',
        input: 'text-[13px] placeholder:text-[#a3acb3]',
        description: 'text-[11px] text-muted',
        errorMessage: 'text-[11px]',
      }}
      isInvalid={limitIssues.length > 0}
      errorMessage={limitIssues.length ? (
        <ul className="list-disc pl-4 space-y-0.5">{limitIssues.map((m, i) => <li key={i}>{m}</li>)}</ul>
      ) : undefined}
      description={parsed.urls.length
        ? `${parsed.urls.length} link${parsed.urls.length === 1 ? '' : 's'}${parsed.invalid.length ? ` · ${parsed.invalid.length} not recognised` : ''}${several ? ' · each becomes a draft' : ' · fills this form'}`
        : `One link per line, up to ${MAX_IMPORT_URLS}. Public pages only: login-protected or JavaScript-only pages may not work.`} />
    <Checkbox isSelected={rights} onValueChange={setRights}
      isDisabled={!hasUrl || busy || saving || disabled}
      classNames={{ base: 'mt-3' }}>
      I have permission to reuse the details and images of {several ? 'these products' : 'this product'}.
    </Checkbox>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button type="button" color="primary" isLoading={busy}
        isDisabled={!rights || !parsed.urls.length || disabled || busy || saving} onPress={() => void fetchAll()}>
        {busy ? 'Fetching…' : several ? `Fetch ${parsed.urls.length} products` : 'Fetch product details'}
      </Button>
      {busy && <Button type="button" variant="bordered" onPress={() => { controller.current?.abort(); setBusy(false); }}>Cancel</Button>}
      <span className="text-[11px] leading-snug text-muted">
        {!rights && hasUrl ? 'Tick the permission box to fetch.' : `Up to 6 photos per product, 1 MB each${several ? ' · links are read one at a time' : ' · existing fields and stock stay unchanged'}.`}
      </span>
    </div>

    <div aria-live="polite">
      {busy && !several && <p className="mt-3 text-sm text-muted">Reading the page and checking photos. This can take up to a minute.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}

      {result && <div className="mt-4 rounded-lg border border-border bg-surface p-4">
        <p className="text-xs font-medium text-muted">{applied ? 'Added to your editable form' : 'Preview — not saved or published'}</p>
        <h3 className="mt-1 font-semibold text-foreground">{result.draft.name}</h3>
        <p className="mt-1 text-sm text-muted">{[result.draft.brandName, result.draft.categoryName,
          result.draft.price ? `INR ${result.draft.price}` : 'Set your selling price'].filter(Boolean).join(' · ')}</p>
        <details className="mt-2 text-sm text-muted">
          <summary className="cursor-pointer">Full source description ({result.draft.description.length.toLocaleString()} characters)</summary>
          <p className="mt-2 whitespace-pre-wrap max-h-96 overflow-auto">{result.draft.description || 'No complete source description found.'}</p>
        </details>
        <div className="mt-3 flex flex-wrap gap-2">
          {result.images.map((image, i) => <img key={i} src={`data:${image.mime};base64,${image.base64}`}
            alt={`Imported product photo ${i + 1}`} className="h-20 w-20 rounded-md border border-border object-contain" />)}
        </div>
        <ul className="mt-3 list-disc pl-4 text-xs text-muted space-y-1">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Checkbox isSelected={replaceDescription} isDisabled={applied || disabled}
            onValueChange={setReplaceDescription}
            classNames={{ base: 'w-full' }}>
            Replace my existing description with the full source description (other filled fields stay unchanged).
          </Checkbox>
          <Button type="button" color="primary" isDisabled={applied || disabled || !rights}
            onPress={() => { onApply(result, replaceDescription); setApplied(true); }}>{replaceDescription ? 'Apply full description & import' : 'Fill empty fields & add photos'}</Button>
          <Button type="button" variant="bordered" onPress={() => setResult(null)}>Dismiss preview</Button>
        </div>
      </div>}

      {rows.length > 0 && <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">
            {rows.filter((r) => ['ready', 'saving', 'saved'].includes(r.status)).length} of {rows.length} fetched
            {savedCount > 0 && ` · ${savedCount} saved as drafts`}
          </p>
          {!busy && <Button type="button" size="sm" variant="light" isDisabled={saving} onPress={() => setRows([])}>Clear list</Button>}
        </div>
        {rows.map((r, i) => {
          const problems = r.status === 'ready' && r.include ? rowProblems(r) : [];
          const locked = r.status !== 'ready' || saving;
          const thumb = r.result?.images?.[0];
          return <div key={r.url} className={`rounded-lg border bg-surface p-3 ${problems.length ? 'border-warning' : 'border-border'}`}>
            <div className="flex items-start gap-3">
              {thumb
                ? <img src={`data:${thumb.mime};base64,${thumb.base64}`} alt="" className="h-16 w-16 shrink-0 rounded-md border border-border object-contain" />
                : <div className="h-16 w-16 shrink-0 rounded-md border border-dashed border-border" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {r.status === 'ready' && <input type="checkbox" checked={r.include} disabled={saving} onChange={(e) => update(i, { include: e.target.checked })} aria-label="Include this product" />}
                  <span className={`text-xs font-medium ${r.status === 'failed' ? 'text-danger' : r.status === 'saved' ? 'text-success' : 'text-muted'}`}>{statusLabel[r.status]}</span>
                  {r.result && <span className="text-xs text-muted">· {r.result.images.length} photo{r.result.images.length === 1 ? '' : 's'}</span>}
                  <a href={r.url} target="_blank" rel="noreferrer noopener" className="truncate text-xs text-muted underline max-w-full">{r.url}</a>
                </div>
                {r.message && <p className={`mt-1 text-xs ${r.status === 'failed' || r.status === 'ready' ? 'text-danger' : 'text-muted'}`}>{r.message}</p>}
                {r.result && <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-6">
                  <label className="col-span-2 sm:col-span-6 text-xs text-muted">Name
                    <input className={inputCls} value={r.name} disabled={locked} onChange={(e) => update(i, { name: e.target.value })} /></label>
                  <label className="text-xs text-muted">Price ₹
                    <input className={inputCls} inputMode="decimal" value={r.price} disabled={locked} onChange={(e) => update(i, { price: e.target.value.replace(/[^\d.]/g, '') })} /></label>
                  <label className="text-xs text-muted">MRP ₹
                    <input className={inputCls} inputMode="decimal" value={r.mrp} disabled={locked} onChange={(e) => update(i, { mrp: e.target.value.replace(/[^\d.]/g, '') })} /></label>
                  <label className="text-xs text-muted">Stock
                    <input className={inputCls} inputMode="numeric" value={r.stock} placeholder="0" disabled={locked} onChange={(e) => update(i, { stock: e.target.value.replace(/\D/g, '') })} /></label>
                  <label className="text-xs text-muted">SKU
                    <input className={inputCls} value={r.sku} disabled={locked} onChange={(e) => update(i, { sku: e.target.value })} /></label>
                  <label className="text-xs text-muted">Weight (g)
                    <input className={inputCls} inputMode="numeric" value={r.weightGrams} disabled={locked} onChange={(e) => update(i, { weightGrams: e.target.value.replace(/\D/g, '') })} /></label>
                  <div className="text-xs text-muted">Brand<SellerSelect fullWidth ariaLabel={`Brand for imported product ${i + 1}`} value={r.brandId} disabled={locked} onChange={value => update(i, { brandId: value })} options={[{ value: '', label: 'No brand' }, ...brands.map(brand => ({ value: brand._id, label: brand.name }))]} /></div>
                  <div className="col-span-2 sm:col-span-6 text-xs text-muted">Category<SellerSelect fullWidth ariaLabel={`Category for imported product ${i + 1}`} value={r.categoryId} disabled={locked} onChange={value => update(i, { categoryId: value })} options={[{ value: '', label: r.result.draft.categoryName ? `Pick a category (source says “${r.result.draft.categoryName}”)` : 'Pick a category' }, ...categoryOptions.map(category => ({ value: category.id, label: category.label }))]} /></div>
                </div>}
                {problems.length > 0 && <p className="mt-1 text-xs text-warning">Still needed: {problems.join(', ')}</p>}
              </div>
            </div>
          </div>;
        })}
        {!busy && rows.some((r) => r.status === 'ready') && <div className="flex flex-wrap items-center gap-3">
          <Button type="button" color="primary" isLoading={saving} isDisabled={!rights || !toSave.length || blocked.length > 0 || disabled}
            onPress={() => void saveAll()}>{saving ? 'Saving…' : `Save ${toSave.length} as draft${toSave.length === 1 ? '' : 's'}`}</Button>
          <span className="text-xs text-muted">{blocked.length ? `Complete the highlighted fields on ${blocked.length} product${blocked.length === 1 ? '' : 's'} first.` : 'Drafts stay hidden from the storefront until you publish them.'}</span>
        </div>}
        {savedCount > 0 && !saving && <p className="text-sm text-foreground">{savedCount} draft{savedCount === 1 ? '' : 's'} created. <Link href="/dashboard/products" className="underline">Review and publish them in Products</Link>.</p>}
      </div>}
    </div>
  </div>;
}
