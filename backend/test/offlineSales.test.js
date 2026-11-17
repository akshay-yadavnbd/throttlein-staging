/**
 * Offline sales (unit project): the GST split, buyer and date input, the
 * variant stock arithmetic, and recording / undoing a sale against stubbed
 * models — the stock must move by exactly the units sold.
 */
const assert = require('node:assert/strict');
const {
  computeTax,
  readGstRate,
  resolveSupplyType,
  normalizeInvoiceType,
} = require('../src/modules/offline-sales/offline-sale-tax');
const { readBuyer, validateBuyer, saleDateRange } = require('../src/modules/offline-sales/offline-sale-input');
const { applyStockChange } = require('../src/modules/offline-sales/stock');
const OfflineSale = require('../src/modules/offline-sales/offline-sale.model');
const Product = require('../src/modules/products/product.model');
const User = require('../src/models/User');
const Counter = require('../src/models/Counter');
const service = require('../src/modules/offline-sales/offline-sales.service');

const SELLER = '507f1f77bcf86cd799439011';
const PRODUCT = '507f1f77bcf86cd799439012';
const buyer = { name: 'Asha', phone: '+91 98765 43210', address: '12 MG Road', state: 'Karnataka' };

test('GST is inclusive: intra-state splits CGST + SGST, inter-state is all IGST, non-GST carries no tax', () => {
  assert.deepEqual(computeTax(1180, 'gst', 18, 'intra'), {
    gstRate: 18,
    supplyType: 'intra',
    taxableAmount: 1000,
    gstAmount: 180,
    cgstAmount: 90,
    sgstAmount: 90,
    igstAmount: 0,
  });
  assert.deepEqual(computeTax(1180, 'gst', 18, 'inter'), {
    gstRate: 18,
    supplyType: 'inter',
    taxableAmount: 1000,
    gstAmount: 180,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 180,
  });
  assert.deepEqual(computeTax(1180, 'non_gst', 18, 'inter'), {
    gstRate: 0,
    supplyType: 'intra',
    taxableAmount: 1180,
    gstAmount: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
  });
  // An odd paisa goes to SGST so the two halves always add back up.
  const odd = computeTax(1001, 'gst', 5, 'intra');
  assert.equal(odd.cgstAmount + odd.sgstAmount, odd.gstAmount);
});

test('GST rate, supply type and invoice type read the seller input safely', () => {
  assert.equal(readGstRate(''), 18);
  assert.equal(readGstRate('12.5'), 12.5);
  assert.equal(readGstRate('0'), null);
  assert.equal(readGstRate('101'), null);
  assert.equal(readGstRate(undefined, 5), 5);
  assert.equal(resolveSupplyType('inter', 'Karnataka', 'Karnataka'), 'inter');
  assert.equal(resolveSupplyType(undefined, 'Kerala', 'Karnataka'), 'inter');
  assert.equal(resolveSupplyType(undefined, ' karnataka ', 'Karnataka'), 'intra');
  assert.equal(resolveSupplyType(undefined, '', 'Karnataka'), 'intra');
  assert.equal(normalizeInvoiceType('gst'), 'gst');
  assert.equal(normalizeInvoiceType('GST'), 'non_gst');
});

test('buyer: phone normalised to 10 digits; name, phone and address required; email optional but checked', () => {
  const b = readBuyer(buyer);
  assert.equal(b.phone, '9876543210');
  assert.equal(validateBuyer(b), null);
  assert.equal(readBuyer({ phone: '09876543210' }).phone, '9876543210');
  assert.equal(validateBuyer({ ...b, name: '' }), 'Buyer name is required.');
  assert.equal(validateBuyer({ ...b, address: '' }), 'Buyer address is required.');
  assert.equal(validateBuyer(readBuyer({ ...buyer, phone: 'call me' })), 'Contact number must be exactly 10 digits.');
  assert.equal(validateBuyer({ ...b, email: 'nope' }), 'Enter a valid email address.');
});

test('date range: a date-only "to" includes that whole day; a reversed range is refused', () => {
  const r = saleDateRange('2026-10-01', '2026-10-28');
  assert.equal(r.$gte.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(r.$lt.toISOString(), '2026-10-29T00:00:00.000Z');
  assert.equal(saleDateRange('', ''), null);
  assert.throws(
    () => saleDateRange('2026-10-29', '2026-10-28'),
    (e) => e.status === 400,
  );
  // The same day as both ends is a valid one-day range.
  assert.ok(saleDateRange('2026-10-28', '2026-10-28').$lt);
});

test('stock: a variant sale moves its row and re-sums the total; a lost variant falls back to the total', () => {
  const product = {
    stock: 7,
    variants: [
      { size: 'M', color: 'Black', stock: 3 },
      { size: 'L', color: 'Black', stock: 4 },
    ],
  };
  assert.equal(applyStockChange(product, { size: 'M', color: 'Black' }, -2), 3);
  assert.deepEqual([product.variants[0].stock, product.stock], [1, 5]);
  assert.equal(applyStockChange(product, { size: 'XL', color: 'Red' }, 2), 5);
  assert.equal(product.stock, 7);
  const plain = { stock: 10 };
  applyStockChange(plain, null, -4);
  assert.equal(plain.stock, 6);
});

function productDoc(fields) {
  return {
    _id: PRODUCT,
    name: 'Riding jacket',
    slug: 'riding-jacket',
    price: 1180,
    ...fields,
    save: vi.fn(async () => {}),
  };
}

test('recording a GST sale takes the units from the variant row and stores the tax split and invoice number', async () => {
  const product = productDoc({ stock: 5, variants: [{ size: 'M', color: 'Black', stock: 5 }] });
  vi.spyOn(Product, 'findOne').mockImplementation(async (filter) => {
    assert.deepEqual(filter, { _id: PRODUCT, seller: SELLER });
    return product;
  });
  vi.spyOn(User, 'findById').mockImplementation(() => ({
    select: () => ({
      lean: async () => ({ kyc: { gstin: '29abcde1234f1z5', pickupAddress: { state: 'Karnataka' } } }),
    }),
  }));
  vi.spyOn(Counter, 'next').mockImplementation(async () => 7);
  vi.spyOn(OfflineSale, 'create').mockImplementation(async (fields) => ({ _id: 'sale-1', ...fields }));

  const { sale, productStock } = await service.create(SELLER, {
    product: PRODUCT,
    variant: { size: 'M', color: 'Black' },
    quantity: 2,
    invoiceType: 'gst',
    saleDate: '2026-10-28',
    buyer,
  });
  assert.equal(productStock, 3);
  assert.equal(product.variants[0].stock, 3);
  assert.equal(product.save.mock.calls.length, 1);
  assert.equal(sale.invoiceNumber, 'OS-2026-0007');
  assert.equal(sale.sellerGstin, '29ABCDE1234F1Z5');
  assert.deepEqual([sale.totalAmount, sale.taxableAmount, sale.cgstAmount, sale.sgstAmount], [2360, 2000, 180, 180]);
});

test('a sale for more than is in stock, or with no variant picked, is refused before anything is written', async () => {
  const product = productDoc({ stock: 1, variants: [] });
  vi.spyOn(Product, 'findOne').mockImplementation(async () => product);
  const create = vi.spyOn(OfflineSale, 'create').mockImplementation(async () => assert.fail('must not record'));
  await assert.rejects(
    service.create(SELLER, { product: PRODUCT, quantity: 2, buyer }),
    /Only 1 unit\(s\) left in stock/,
  );
  const withVariants = productDoc({ stock: 5, variants: [{ size: 'M', color: 'Black', stock: 5 }] });
  vi.spyOn(Product, 'findOne').mockImplementation(async () => withVariants);
  await assert.rejects(service.create(SELLER, { product: PRODUCT, quantity: 1, buyer }), /pick a size and\/or color/);
  assert.equal(create.mock.calls.length, 0);
  assert.equal(product.save.mock.calls.length + withVariants.save.mock.calls.length, 0);
});

test('undoing a sale puts the units back on its variant row and soft-deletes it', async () => {
  const product = productDoc({ stock: 3, variants: [{ size: 'M', color: 'Black', stock: 3 }] });
  const sale = {
    _id: 'sale-1',
    product: PRODUCT,
    quantity: 2,
    variant: { size: 'M', color: 'Black' },
    deletedAt: null,
    save: vi.fn(async () => {}),
  };
  vi.spyOn(OfflineSale, 'findOne').mockImplementation(async (filter) => {
    assert.equal(filter.deletedAt, null, 'an already-undone sale cannot be undone twice');
    return sale;
  });
  vi.spyOn(Product, 'findOne').mockImplementation(async () => product);
  await service.remove(SELLER, 'sale-1');
  assert.deepEqual([product.variants[0].stock, product.stock], [5, 5]);
  assert.ok(sale.deletedAt instanceof Date);
  assert.equal(sale.save.mock.calls.length, 1);
});
