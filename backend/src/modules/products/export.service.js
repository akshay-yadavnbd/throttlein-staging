/**
 * The seller's catalogue as a spreadsheet, in the same format the importer
 * accepts, so export → edit → import round-trips.
 */
const products = require('./products.repository');
const csv = require('./csv-format');

/** Bike as "Make > Model" for unambiguous round-tripping. */
const bikeCell = (bike) =>
  bike
    ? bike.parent && bike.parent.name && bike.parent.name !== 'Shop by Bike'
      ? `${bike.parent.name} > ${bike.name}`
      : bike.name
    : '';

async function exportRows(sellerId) {
  const items = await products.exportSourceForSeller(sellerId);
  return items.map((p) => ({
    id: p._id ? p._id.toString() : '',
    name: p.name || '',
    sku: p.sku || '',
    category: p.category?.name || '',
    bike: bikeCell(p.bike),
    brand: p.brand?.name || '',
    price: p.price ?? '',
    mrp: p.mrp ?? '',
    stock: p.stock ?? 0,
    sizes: Array.isArray(p.sizes) ? p.sizes.join('|') : '',
    color: p.color || '',
    listingColor: p.listingColor || '',
    variants: csv.serializeVariantsCell(p.variants),
    colorImages: csv.serializeColorImagesCell(p.colorImages),
    weightGrams: p.weightGrams ?? '',
    lengthCm: p.lengthCm ?? '',
    breadthCm: p.breadthCm ?? '',
    heightCm: p.heightCm ?? '',
    gstRate: p.gstRate ?? '',
    hsn: p.hsn || '',
    status: p.status || 'active',
    isFeatured: String(!!p.isFeatured),
    description: p.description || '',
    images: Array.isArray(p.images) ? p.images.join('|') : '',
  }));
}

/** `{ body, contentType, filename }` for a sheet download in the requested format. */
function sheetDownload(rows, { format, name, instructions = false }) {
  if (String(format || 'csv').toLowerCase() === 'xlsx') {
    return { body: csv.xlsxBuffer(rows, { instructions }), contentType: csv.XLSX_MIME, filename: `${name}.xlsx` };
  }
  return { body: csv.csvText(rows), contentType: 'text/csv; charset=utf-8', filename: `${name}.csv` };
}

module.exports = { exportRows, sheetDownload };
