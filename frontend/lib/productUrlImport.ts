export type ImportedProductDraft = {
  name: string; description: string; sku: string; brandName: string; categoryName: string;
  color: string; currency: string; seoTitle: string; seoDescription: string; sizes: string[];
  price: number | null; mrp: number | null; weightGrams: number | null;
  lengthCm: number | null; breadthCm: number | null; heightCm: number | null;
};
export type ProductImportResult = {
  draft: ImportedProductDraft;
  images: Array<{ name: string; mime: string; base64: string }>;
  sourceUrl: string; warnings: string[];
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));

/** Imported plain-text description → the editor's paragraph HTML, escaped. */
export const descriptionHtml = (text: string) => text.split(/\n+/).map(line => `<p>${escapeHtml(line)}</p>`).join('');

export const MAX_IMPORT_URLS = 10;

/** Max lengths enforced by the Product model — keep in sync with backend. */
export const IMPORT_FIELD_LIMITS = { seoTitle: 100, seoDescription: 200 } as const;
const LIMIT_LABELS: Record<keyof typeof IMPORT_FIELD_LIMITS, string> = {
  seoTitle: 'SEO title',
  seoDescription: 'SEO description',
};

/** Trim to `max` chars, preferring a word boundary. */
export function clampText(value: string, max: number): string {
  if (!value || value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

/** Fields from an imported page that exceed the save limits. */
export function importLimitIssues(draft: ImportedProductDraft): string[] {
  return (Object.keys(IMPORT_FIELD_LIMITS) as (keyof typeof IMPORT_FIELD_LIMITS)[])
    .filter((k) => (draft[k] || '').length > IMPORT_FIELD_LIMITS[k])
    .map((k) => `${LIMIT_LABELS[k]} from this link is ${draft[k].length} characters — the maximum is ${IMPORT_FIELD_LIMITS[k]}. It will be shortened to ${IMPORT_FIELD_LIMITS[k]} when imported.`);
}

/** Copy of the draft with over-long fields shortened to the save limits. */
export function clampImportedDraft(draft: ImportedProductDraft): ImportedProductDraft {
  return {
    ...draft,
    seoTitle: clampText(draft.seoTitle || '', IMPORT_FIELD_LIMITS.seoTitle),
    seoDescription: clampText(draft.seoDescription || '', IMPORT_FIELD_LIMITS.seoDescription),
  };
}

/** Split pasted text into unique https URLs (one per line, or separated by spaces/commas). */
export function parseImportUrls(text: string): { urls: string[]; invalid: string[] } {
  const urls: string[] = []; const invalid: string[] = [];
  for (const raw of text.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)) {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:' || u.username || u.password) throw new Error();
      u.hash = '';
      if (!urls.includes(u.href)) urls.push(u.href);
    } catch { invalid.push(raw); }
  }
  return { urls, invalid };
}

// Import only into empty fields. Inventory, policies and publication are always
// the seller's decisions, never copied from another store or model output.
export function mergeImportedFields<T extends Record<string, string | boolean>>(current: T, rawDraft: ImportedProductDraft, replaceDescription = false): T {
  const draft = clampImportedDraft(rawDraft);
  const next = { ...current } as Record<string, string | boolean>;
  for (const key of ['name','sku','color','seoTitle','seoDescription'] as const) {
    if (!current[key] && draft[key]) next[key] = draft[key];
  }
  // Legacy editor values can contain a styled empty paragraph or a blank line.
  // Treat only empty text containers as blank; preserve images and other markup.
  const descriptionEmpty = typeof current.description !== 'string' || !current.description
    .replace(/<\/?(?:p|div|span|br|h[1-6])\b[^>]*>/gi, '')
    .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/[\s\u200B\uFEFF]/g, '');
  if ((descriptionEmpty || replaceDescription) && draft.description) next.description = descriptionHtml(draft.description);
  for (const key of ['price','mrp','weightGrams','lengthCm','breadthCm','heightCm'] as const) {
    if (!current[key] && draft[key] !== null && Number.isFinite(draft[key])) next[key] = String(draft[key]);
  }
  return next as T;
}
