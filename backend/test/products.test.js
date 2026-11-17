/**
 * Products module — the pure pieces: form parsers, listing image choice,
 * sheet cell encodings and the spell-correction distance. No database.
 */
const assert = require('node:assert/strict');
const input = require('../src/modules/products/product-input');
const { listingImageFor, hasAnyImage } = require('../src/modules/products/listing-image');
const csv = require('../src/modules/products/csv-format');
const { levenshtein } = require('../src/modules/products/search.service');

describe('form parsers', () => {
  test('parseVariants trims, coerces, drops empty rows and dedupes by size+colour (last wins)', () => {
    const out = input.parseVariants(
      JSON.stringify([
        { size: ' M ', color: 'Black', stock: '5.7', sku: 'A', price: '1299.999' },
        { size: 'M', color: 'Black', stock: 2, mrp: 1500 },
        { size: '', color: '', stock: 0 },
        { size: 'L', color: 'Red', stock: -3 },
      ]),
    );
    assert.deepEqual(out, [
      { size: 'M', color: 'Black', stock: 2, sku: '', price: null, mrp: 1500 },
      { size: 'L', color: 'Red', stock: 0, sku: '', price: null, mrp: null },
    ]);
    assert.deepEqual(input.parseVariants('not json'), []);
    assert.equal(input.isExplicitEmptyArray('[]'), true);
    assert.equal(input.isExplicitEmptyArray('[1]'), false);
  });

  test('image manifests resolve staged indices against the shared upload pool', () => {
    const uploaded = ['u0.jpg', 'u1.jpg', 'u2.jpg'];
    assert.deepEqual(
      input.parseColorImagesManifest(
        JSON.stringify([
          { color: 'Black', kept: ['k.jpg'], staged: [0, 9] },
          { color: 'Lime', kept: [], staged: [1] },
          { color: 'Lime', kept: [], staged: [2] },
          { color: '', staged: [0] },
        ]),
        uploaded,
      ),
      [
        { color: 'Black', images: ['k.jpg', 'u0.jpg'] },
        { color: 'Lime', images: ['u2.jpg'] },
      ],
    );
    assert.equal(input.parseSizeChartImageManifest('{"kept":null,"staged":1}', uploaded), 'u1.jpg');
    assert.equal(input.parseSizeChartImageManifest('{"kept":null,"staged":null}', uploaded), '');
    assert.equal(
      input.parseSizeChartImageManifest('{"kept":null,"staged":7}', uploaded),
      null,
      'malformed → preserve prior',
    );
    assert.deepEqual(
      input.parseAPlusImagesManifest(
        JSON.stringify([
          { type: 'kept', url: ' a.jpg ' },
          { type: 'staged', index: 2 },
        ]),
        uploaded,
      ),
      ['a.jpg', 'u2.jpg', ''],
    );
    assert.deepEqual(
      input.parseImageOrder(
        JSON.stringify([
          { type: 'staged', index: 1 },
          { type: 'kept', url: 'k.jpg' },
          { type: 'staged', index: 5 },
        ]),
        uploaded,
      ),
      ['u1.jpg', 'k.jpg'],
    );
    assert.equal(input.parseImageOrder(undefined, uploaded), null);
  });

  test('sizes, cities and status normalise every shape the form can post', () => {
    assert.deepEqual(input.parseSizes('["S"," M ",""]'), ['S', 'M']);
    assert.deepEqual(input.parseSizes('XL'), ['XL']);
    assert.deepEqual(input.normalizeCities('Mumbai, New Delhi  ,mumbai'), ['mumbai', 'new-delhi']);
    assert.deepEqual(input.normalizeCities('["Pune"]'), ['pune']);
    assert.equal(input.sellerStatus('Draft'), 'draft');
    assert.equal(input.sellerStatus('rejected'), undefined, 'admin-only status is ignored');
    assert.throws(() => input.readTaxFields({ gstRate: '7' }), /GST rate must be one of/);
    assert.throws(() => input.readTaxFields({ hsn: '12' }), /HSN code must be/);
    assert.deepEqual(input.readTaxFields({ gstRate: '18', hsn: '6201' }), { gstRate: 18, hsn: '6201' });
  });
});

describe('listing image', () => {
  test('prefers the listing colour, then the main gallery, then any colour bucket', () => {
    const colorImages = [
      { color: 'Red', images: ['r.jpg'] },
      { color: 'Black', images: ['b.jpg'] },
    ];
    assert.equal(listingImageFor({ listingColor: 'Black', images: ['m.jpg'], colorImages }), 'b.jpg');
    assert.equal(listingImageFor({ images: ['m.jpg'], colorImages }), 'm.jpg');
    assert.equal(listingImageFor({ images: [], colorImages }), 'r.jpg');
    assert.equal(hasAnyImage({ images: [], colorImages: [{ color: 'x', images: [] }] }), false);
  });
});

describe('sheet cells', () => {
  test('variants and colour galleries round-trip through their cell encodings', () => {
    const variants = csv.parseVariantsCell('S|Black|10||;M|Black|15|9499|;L|Red|8||');
    assert.deepEqual(variants, [
      { size: 'S', color: 'Black', stock: 10 },
      { size: 'M', color: 'Black', stock: 15, price: 9499 },
      { size: 'L', color: 'Red', stock: 8 },
    ]);
    assert.equal(csv.serializeVariantsCell(variants), 'S|Black|10||;M|Black|15|9499|;L|Red|8||');
    const byName = new Map([['front.jpg', 'sellers/x/front.webp']]);
    const parsed = csv.parseColorImagesCell(
      'Black:front.jpg|https://cdn/x.jpg|sellers/y/kept.webp;Red:missing.jpg',
      byName,
    );
    assert.deepEqual(parsed.colorImages, [
      { color: 'Black', images: ['sellers/x/front.webp', 'https://cdn/x.jpg', 'sellers/y/kept.webp'] },
    ]);
    assert.deepEqual(parsed.unresolved, ['Red:missing.jpg']);
    assert.equal(
      csv.serializeColorImagesCell(parsed.colorImages),
      'Black:sellers/x/front.webp|https://cdn/x.jpg|sellers/y/kept.webp',
    );
    assert.deepEqual(csv.parseImagesCell('Front.JPG, nope.png', byName), {
      images: ['sellers/x/front.webp'],
      unresolved: ['nope.png'],
    });
  });

  test('the template serialises to CSV with the canonical header and to a two-sheet workbook', () => {
    const text = csv.csvText(csv.TEMPLATE_ROWS);
    assert.equal(text.split('\n')[0].trim(), csv.CSV_COLUMNS.join(','));
    const buf = csv.xlsxBuffer(csv.TEMPLATE_ROWS, { instructions: true });
    const rows = csv.parseSheet(buf, { xlsx: true });
    assert.equal(rows.length, 3);
    assert.equal(rows[2].variants, csv.TEMPLATE_ROWS[2].variants);
  });
});

test('levenshtein is a proper edit distance', () => {
  assert.equal(levenshtein('helmet', 'hemlet'), 2);
  assert.equal(levenshtein('gloves', 'glovs'), 1);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('same', 'SAME'), 0);
});
