/**
 * The seller spreadsheet format: column order, the per-cell encodings for
 * variants and colour galleries, the template rows and the instructions
 * sheet, and the two serialisers (CSV text, XLSX buffer).
 */
const { stringify: csvStringify } = require('csv-stringify/sync');

/**
 * Columns the seller sees. Order matters — export and template emit them in
 * this order, and the importer maps them by header name. `id` is first so an
 * exported catalogue can be edited in Excel and re-imported without
 * duplicating rows; hand-typed rows leave it empty.
 */
const CSV_COLUMNS = [
  'id',
  'name',
  'sku',
  'category',
  'bike',
  'brand',
  'price',
  'mrp',
  'stock',
  'sizes',
  'color',
  'listingColor',
  'variants',
  'colorImages',
  'weightGrams',
  'lengthCm',
  'breadthCm',
  'heightCm',
  'gstRate',
  'hsn',
  'status',
  'isFeatured',
  'description',
  'images',
];

/**
 * `variants` cell: `SIZE|COLOR|STOCK|PRICE|MRP` per variant, `;`-separated.
 * Empty PRICE / MRP (`||`) inherit from the row. [] on empty / malformed.
 */
function parseVariantsCell(raw) {
  const cell = String(raw || '').trim();
  if (!cell) return [];
  const out = [];
  for (const chunk of cell.split(/\s*;\s*/)) {
    if (!chunk) continue;
    const [size = '', color = '', stockStr = '', priceStr = '', mrpStr = ''] = chunk
      .split('|')
      .map((s) => (s || '').trim());
    if (!size && !color) continue;
    const v = { size, color, stock: Number(stockStr) || 0 };
    if (priceStr !== '' && Number.isFinite(Number(priceStr))) v.price = Number(priceStr);
    if (mrpStr !== '' && Number.isFinite(Number(mrpStr))) v.mrp = Number(mrpStr);
    out.push(v);
  }
  return out;
}

function serializeVariantsCell(variants) {
  if (!Array.isArray(variants) || variants.length === 0) return '';
  return variants
    .map((v) => {
      const price = v.price != null && v.price !== '' ? String(v.price) : '';
      const mrp = v.mrp != null && v.mrp !== '' ? String(v.mrp) : '';
      return `${v.size || ''}|${v.color || ''}|${v.stock ?? 0}|${price}|${mrp}`;
    })
    .join(';');
}

/**
 * Resolve one image reference from a sheet cell: a full URL passes through,
 * a bare filename matches an uploaded photo by basename, a path-like
 * storage key (round-trip of an export) is kept as is. Returns null when a
 * bare filename matched nothing.
 */
function resolveImageRef(ref, imageUrlByName) {
  if (/^https?:\/\//i.test(ref)) return ref;
  const base = ref.split(/[\\/]/).pop().toLowerCase();
  const url = imageUrlByName.get(base);
  if (url) return url;
  if (ref.includes('/')) return ref;
  return null;
}

/** `images` cell (pipe / comma separated) → `{ images, unresolved }`. */
function parseImagesCell(raw, imageUrlByName) {
  const images = [];
  const unresolved = [];
  for (const ref of String(raw || '')
    .split(/[|,]+/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const url = resolveImageRef(ref, imageUrlByName);
    if (url) images.push(url);
    else unresolved.push(ref);
  }
  return { images, unresolved };
}

/** `colorImages` cell: `COLOR:file1.jpg|file2.jpg;COLOR2:file3.jpg` → `{ colorImages, unresolved }`. */
function parseColorImagesCell(raw, imageUrlByName) {
  const cell = String(raw || '').trim();
  if (!cell) return { colorImages: [], unresolved: [] };
  const colorImages = [];
  const unresolved = [];
  for (const chunk of cell.split(/\s*;\s*/)) {
    if (!chunk) continue;
    const colonAt = chunk.indexOf(':');
    if (colonAt < 0) continue;
    const color = chunk.slice(0, colonAt).trim();
    if (!color) continue;
    const urls = [];
    for (const f of chunk
      .slice(colonAt + 1)
      .split(/[|,]+/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      const url = resolveImageRef(f, imageUrlByName);
      if (url) urls.push(url);
      else unresolved.push(`${color}:${f}`);
    }
    if (urls.length) colorImages.push({ color, images: urls });
  }
  return { colorImages, unresolved };
}

/** Full stored keys, so a straight re-import of an export resolves every reference. */
function serializeColorImagesCell(colorImages) {
  if (!Array.isArray(colorImages) || colorImages.length === 0) return '';
  return colorImages
    .filter((c) => Array.isArray(c?.images) && c.images.length > 0)
    .map((c) => `${c.color}:${c.images.map((u) => String(u)).join('|')}`)
    .join(';');
}

/** Three example rows: universal, bike-specific, variant matrix. */
const TEMPLATE_ROWS = [
  {
    id: '',
    name: 'Sample jacket (universal — leave bike empty)',
    sku: 'YOUR-SKU-001',
    category: 'Jackets',
    bike: '',
    brand: 'Rynox',
    price: 9999,
    mrp: 11999,
    stock: 25,
    sizes: 'S|M|L|XL',
    color: 'Black',
    listingColor: '',
    variants: '',
    colorImages: '',
    weightGrams: 1700,
    lengthCm: 40,
    breadthCm: 30,
    heightCm: 12,
    gstRate: 18,
    hsn: '6201',
    status: 'active',
    isFeatured: 'false',
    description: 'Triple-layer construction with detachable thermal liner.',
    images: 'jacket-front.jpg|jacket-back.jpg',
  },
  {
    id: '',
    name: 'Sample seat cover (bike-specific)',
    sku: 'YOUR-SKU-002',
    category: 'Seat Covers',
    bike: 'Royal Enfield > Classic 350',
    brand: '',
    price: 1499,
    mrp: 1999,
    stock: 10,
    sizes: '',
    color: 'Brown',
    listingColor: '',
    variants: '',
    colorImages: '',
    weightGrams: 600,
    lengthCm: 25,
    breadthCm: 25,
    heightCm: 10,
    gstRate: 18,
    hsn: '8714',
    status: 'active',
    isFeatured: 'false',
    description: 'Premium leatherette seat cover, custom-fit for Classic 350.',
    images: 'seat-cover-1.jpg',
  },
  {
    id: '',
    name: 'Sample riding jacket (variant matrix)',
    sku: 'YOUR-SKU-003',
    category: 'Jackets',
    bike: '',
    brand: 'Rynox',
    price: 8999,
    mrp: 10999,
    stock: 0,
    sizes: 'S|M|L',
    color: '',
    listingColor: 'Black',
    variants: 'S|Black|8||;M|Black|12||;L|Black|10||;S|Red|5||;M|Red|8|9499|;L|Red|6||',
    colorImages: 'Black:jacket-black-1.jpg|jacket-black-2.jpg;Red:jacket-red-1.jpg|jacket-red-2.jpg',
    weightGrams: 1900,
    lengthCm: 42,
    breadthCm: 32,
    heightCm: 14,
    gstRate: 18,
    hsn: '6201',
    status: 'active',
    isFeatured: 'false',
    description: 'Two-colour riding jacket with per-colour photo galleries and per-size stock.',
    images: 'jacket-hero.jpg',
  },
];

/** The "Instructions" sheet shipped with the XLSX template; the importer skips it by name. */
const INSTRUCTIONS = [
  ['THROTTLEIN - Bulk product import template'],
  [''],
  ['Column reference'],
  [
    'id           - Leave BLANK for new products. Present in exported catalog files; ties a row to an existing product.',
  ],
  ['name         - Required. Product title as it should appear on the storefront.'],
  ['sku          - REQUIRED. Your internal stock keeping unit. Used to match rows on re-import.'],
  ['category     - Required. Must match a category that exists in the admin catalog.'],
  ['bike         - Optional. Leave EMPTY for universal items (jackets, helmets, gloves).'],
  ['               For bike-specific items use "Make > Model" e.g. "Royal Enfield > Classic 350".'],
  ['brand        - Optional. Must match a brand from the admin.'],
  [
    'price        - Required. Number, no currency symbol, at most 1000000. Used as fallback when a variant leaves PRICE empty.',
  ],
  ['mrp          - Optional. The strike-through / list price, at most 1000000.'],
  ['stock        - Optional. Integer stock count. IGNORED when `variants` is populated (sum-of-variants wins).'],
  ['sizes        - Optional. Pipe-separated (S|M|L|XL). Kept as a human-readable list.'],
  ['               For per-size stock, use the `variants` column instead.'],
  ["color        - Optional single colour string, used for products that DON'T have colour variants."],
  ['               For a colour matrix, leave this blank and use `variants` + `colorImages`.'],
  ['listingColor - Optional. Which of the variant colours represents this product on listing cards'],
  ['               AND is pre-selected on the PDP. Must match one of the colours in `variants`.'],
  ['variants     - Optional. Per-size × per-colour × stock matrix. Encoding:'],
  ['                   SIZE|COLOR|STOCK|PRICE|MRP    (one entry per variant, entries separated by `;`)'],
  ['               Example: "S|Black|8||;M|Black|12||;L|Red|6|9499|"'],
  ['               PRICE and MRP are optional overrides — leave empty (`||`) to inherit from the row above.'],
  ['               When populated, the top-level `stock` column is ignored.'],
  ['colorImages  - Optional. Per-colour photo galleries. Encoding:'],
  ['                   COLOR:file1.jpg|file2.jpg;NEXT_COLOR:file3.jpg'],
  ['               Filenames are matched by basename against the photos you upload in the bulk-import UI,'],
  ['               same as the `images` column. Full https:// URLs also work.'],
  ['weightGrams  - REQUIRED. Integer grams (product + packaging). Used for Shiprocket rate quotes.'],
  ['lengthCm     - Optional (default 15). Parcel length in cm.'],
  ['breadthCm    - Optional (default 15). Parcel breadth in cm.'],
  ['heightCm     - Optional (default 10). Parcel height in cm.'],
  ['               Set real values for bulky items (helmets, jackets) so volumetric-weight pricing is correct.'],
  [
    'gstRate      - Optional (default 18). GST % already INCLUDED in price: 0, 5, 12, 18 or 28. Printed on tax invoices.',
  ],
  ['hsn          - Optional. HSN code (4, 6 or 8 digits) printed on tax invoices.'],
  ['status       - active | draft | out_of_stock. Defaults to active.'],
  ['isFeatured   - true / false.'],
  ['description  - Long text. Supports HTML.'],
  ['images       - Pipe- or comma-separated image references. Either a full https:// URL,'],
  ['               or a filename that you also upload with this file in the bulk import UI.'],
  ['               For variant products, use `colorImages` for per-colour galleries and leave this blank'],
  ['               (or use it for shared marketing shots).'],
  [''],
  ['Variant workflow — three steps'],
  ['1. Fill `variants` with SIZE|COLOR|STOCK for each combination. Leave STOCK 0 for out-of-stock rows.'],
  ['2. Fill `colorImages` with COLOR:filename1|filename2 for every colour you named in `variants`.'],
  ['3. Optionally set `listingColor` to the colour you want the storefront to lead with.'],
  [''],
  ['Tips'],
  ['- Save your changes on the "Products" sheet only; the "Instructions" sheet is ignored on import.'],
  ['- Sellers on Excel/Sheets can save as .xlsx or export to .csv - both formats are accepted.'],
  ['- Rows with errors are reported individually; the rest of your batch still imports.'],
  ['- For variant products, ensure EVERY colour named in `variants` has at least one photo in `colorImages`.'],
];

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Rows → CSV text with the standard header. */
const csvText = (rows) => csvStringify(rows, { header: true, columns: CSV_COLUMNS });

/** Rows → .xlsx buffer ("Products" sheet, plus "Instructions" when asked). */
function xlsxBuffer(rows, { instructions = false } = {}) {
  const XLSX = require('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows, { header: CSV_COLUMNS });
  // Wider free-text columns so the file opens legibly without an autofit pass.
  ws['!cols'] = CSV_COLUMNS.map((k) => ({
    wch: k === 'description' ? 60 : k === 'name' ? 40 : k === 'images' ? 40 : 16,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  if (instructions) {
    const wsInstr = XLSX.utils.aoa_to_sheet(INSTRUCTIONS);
    wsInstr['!cols'] = [{ wch: 110 }];
    XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions');
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Uploaded sheet bytes → row objects keyed by header (CSV via csv-parse, XLSX via SheetJS). */
function parseSheet(bytes, { xlsx }) {
  if (xlsx) {
    const XLSX = require('xlsx');
    const wb = XLSX.read(bytes, { type: 'buffer' });
    // Any sheet that isn't the Instructions one; fall back to the first.
    const dataSheetName = wb.SheetNames.find((n) => n.toLowerCase() !== 'instructions') || wb.SheetNames[0];
    if (!dataSheetName) throw new Error('Workbook has no sheets');
    // raw:false → dates/booleans as strings (like CSV); defval:'' → blank cells are '' not undefined.
    return XLSX.utils.sheet_to_json(wb.Sheets[dataSheetName], { defval: '', raw: false });
  }
  const { parse } = require('csv-parse/sync');
  return parse(bytes, { columns: true, skip_empty_lines: true, trim: true, bom: true });
}

module.exports = {
  CSV_COLUMNS,
  XLSX_MIME,
  TEMPLATE_ROWS,
  INSTRUCTIONS,
  parseVariantsCell,
  serializeVariantsCell,
  parseImagesCell,
  parseColorImagesCell,
  serializeColorImagesCell,
  csvText,
  xlsxBuffer,
  parseSheet,
};
