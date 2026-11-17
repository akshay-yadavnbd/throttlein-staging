const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const gst = require('../src/utils/gst');
const { sliceCharges } = require('../src/utils/sliceCharges');
const Order = require('../src/modules/orders/order.model');
const Product = require('../src/modules/products/product.model');
const User = require('../src/models/User');
const Counter = require('../src/models/Counter');
const invoice = require('../src/modules/orders/tax-invoice.service');
const { loadController, response } = require('./helpers/controller');

const SELLER = new mongoose.Types.ObjectId();
const OTHER = new mongoose.Types.ObjectId();
const UP_GSTIN = '09ABCDE1234F1Z5';

function sampleOrder(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    orderNumber: 'TIN-2026-000020',
    createdAt: new Date('2026-10-21T04:00:00Z'),
    paymentMethod: 'online',
    shippingAddress: {
      fullName: 'Siva Kumar',
      phone: '9999999999',
      line1: 'Plot C',
      city: 'Greater Noida',
      state: 'Uttar Pradesh',
      pincode: '201309',
      country: 'India',
    },
    items: [
      {
        seller: SELLER,
        product: new mongoose.Types.ObjectId(),
        name: 'Sintered Brake Pads',
        price: 1180,
        quantity: 1,
        subtotal: 1180,
        gstRate: 18,
        hsn: '8714',
      },
      {
        seller: SELLER,
        product: new mongoose.Types.ObjectId(),
        name: 'Riding Gloves',
        size: 'L',
        color: 'Black',
        price: 525,
        quantity: 2,
        subtotal: 1050,
        gstRate: 5,
        hsn: '6216',
      },
      {
        seller: OTHER,
        product: new mongoose.Types.ObjectId(),
        name: 'Helmet',
        price: 3000,
        quantity: 1,
        subtotal: 3000,
        gstRate: 18,
      },
    ],
    delivery: [{ seller: SELLER, amount: 118 }],
    sellerShipments: [
      { _id: new mongoose.Types.ObjectId(), seller: SELLER, kind: 'forward', status: 'delivered', awbCode: 'AWB1' },
    ],
    ...overrides,
  };
}
const issued = (gstin = UP_GSTIN, state = 'Uttar Pradesh') => ({
  number: 'TI2627-00001',
  date: new Date('2026-10-21T06:00:00Z'),
  seller: { name: 'Crank1 Moto', gstin, address: 'Shop 5, Greater Noida - 201318', state },
});

test('GST is split out of tax-inclusive prices, CGST+SGST within a state and IGST across states', () => {
  assert.deepEqual(gst.splitInclusive(1180, 18, true), {
    gross: 1180,
    taxable: 1000,
    rate: 18,
    tax: 180,
    igst: 0,
    cgst: 90,
    sgst: 90,
  });
  assert.deepEqual(gst.splitInclusive(1180, 18, false), {
    gross: 1180,
    taxable: 1000,
    rate: 18,
    tax: 180,
    igst: 180,
    cgst: 0,
    sgst: 0,
  });
  const odd = gst.splitInclusive(12, 18, true);
  assert.equal(odd.taxable, 10.17);
  assert.equal(round(odd.cgst + odd.sgst), odd.tax);
  assert.equal(gst.splitInclusive(500, 0, true).tax, 0);
});
const round = (n) => Math.round(n * 100) / 100;

test('same-state check prefers the GSTIN state code and tolerates address spellings', () => {
  assert.equal(gst.isIntraState({ sellerGstin: UP_GSTIN, sellerState: 'Delhi', customerState: 'uttar pradesh' }), true);
  assert.equal(gst.isIntraState({ sellerGstin: UP_GSTIN, customerState: 'New Delhi' }), false);
  assert.equal(gst.isIntraState({ sellerState: 'Orissa', customerState: 'Odisha' }), true);
  assert.equal(gst.stateCode('Jammu & Kashmir'), '01');
});

test('rate and HSN parsing accepts form values and rejects the rest', () => {
  assert.equal(gst.parseGstRate('18'), 18);
  assert.equal(gst.parseGstRate('5%'), 5);
  assert.equal(gst.parseGstRate(''), undefined);
  assert.ok(Number.isNaN(gst.parseGstRate('7')));
  assert.equal(gst.parseHsn(' 8714 '), '8714');
  assert.equal(gst.parseHsn(''), '');
  assert.equal(gst.parseHsn('871'), null);
  assert.equal(gst.effectiveRate(undefined, 5), 5);
  assert.equal(gst.effectiveRate(undefined, null), 18);
  assert.equal(gst.effectiveRate(0, 18), 0);
});

test('slice charges give each seller their own paid delivery and split the COD fee by value', () => {
  const charges = sliceCharges(sampleOrder({ paymentMethod: 'cod', codFee: 49 }));
  assert.deepEqual(charges.get(String(SELLER)), { subtotal: 2230, shipping: 118, codFee: 20 });
  assert.deepEqual(charges.get(String(OTHER)), { subtotal: 3000, shipping: 0, codFee: 29 });
});

test('invoice data: seller parcel only, per-line rates, delivery taxed at the principal item rate', async () => {
  vi.spyOn(Product, 'find').mockImplementation(() => ({ select: () => ({ lean: async () => [] }) }));
  const order = sampleOrder();
  const data = await invoice.buildInvoiceData(order, order.sellerShipments[0], issued());
  assert.equal(data.title, 'TAX INVOICE');
  assert.equal(data.intra, true);
  assert.equal(data.customer.name, 'Siva Kumar');
  assert.doesNotMatch(JSON.stringify(data), /9999999999/);
  assert.deepEqual(
    data.rows.map((r) => [r.description, r.rate, r.taxable]),
    [
      ['Sintered Brake Pads', 18, 1000],
      ['Riding Gloves', 5, 1000],
      ['Shipping charges', 18, 100],
    ],
  );
  assert.equal(data.rows[1].unitPrice, 525);
  assert.equal(data.rows[1].detail, 'Size: L  ·  Colour: Black');
  // 180 (brake pads @18%) + 50 (gloves @5%) + 18 (delivery @18%)
  assert.deepEqual(data.totals, { taxable: 2100, cgst: 124, sgst: 124, igst: 0, tax: 248, gross: 2348 });
  assert.equal(data.placeOfSupply, 'Uttar Pradesh (09)');
});

test('an inter-state seller charges IGST; a seller without GSTIN issues a bill of supply with no tax', async () => {
  vi.spyOn(Product, 'find').mockImplementation(() => ({ select: () => ({ lean: async () => [] }) }));
  const order = sampleOrder();
  const inter = await invoice.buildInvoiceData(order, order.sellerShipments[0], issued('07ABCDE1234F1Z5', 'Delhi'));
  assert.equal(inter.intra, false);
  assert.equal(inter.totals.igst, 248);
  assert.equal(inter.totals.cgst, 0);
  const unregistered = await invoice.buildInvoiceData(order, order.sellerShipments[0], issued(''));
  assert.equal(unregistered.title, 'BILL OF SUPPLY');
  assert.equal(unregistered.totals.tax, 0);
  assert.equal(unregistered.totals.gross, 2348);
});

test('older order lines without a snapshot fall back to the product rate and HSN', async () => {
  const order = sampleOrder();
  delete order.items[0].gstRate;
  order.items[0].hsn = '';
  vi.spyOn(Product, 'find').mockImplementation(() => ({
    select: () => ({ lean: async () => [{ _id: order.items[0].product, gstRate: 28, hsn: '87141090' }] }),
  }));
  const data = await invoice.buildInvoiceData(order, order.sellerShipments[0], issued());
  assert.equal(data.rows[0].rate, 28);
  assert.equal(data.rows[0].hsn, '87141090');
});

test('invoice numbers come from the seller series for the financial year and are issued once', async () => {
  let counterName;
  let filter;
  vi.spyOn(User, 'findById').mockImplementation(() => ({
    select: () => ({
      lean: async () => ({
        storeName: 'Crank1 Moto',
        kyc: {
          gstin: '09abcde1234f1z5',
          pickupAddress: { line1: 'Shop 5', city: 'Greater Noida', pincode: '201318', state: 'Uttar Pradesh' },
        },
      }),
    }),
  }));
  vi.spyOn(Counter, 'next').mockImplementation(async (name) => {
    counterName = name;
    return 7;
  });
  vi.spyOn(Order, 'updateOne').mockImplementation(async (f) => {
    filter = f;
    return { modifiedCount: 1 };
  });
  const order = sampleOrder();
  const entry = { ...order.sellerShipments[0], pickedUpAt: new Date('2026-10-20T10:00:00Z') };
  const record = await invoice.ensureIssued(order, entry);
  assert.equal(record.number, 'TI2627-00007');
  assert.equal(counterName, `invoice-${SELLER}-2627`);
  assert.equal(record.seller.gstin, '09ABCDE1234F1Z5');
  assert.equal(record.seller.address, 'Shop 5, Greater Noida - 201318');
  assert.deepEqual(filter.sellerShipments.$elemMatch['taxInvoice.number'], { $exists: false });
  const again = await invoice.ensureIssued(order, { ...entry, taxInvoice: record });
  assert.equal(again, record);
  assert.equal(Counter.next.mock.calls.length, 1);
});

test('financial year turns over on 1 April IST', () => {
  assert.equal(invoice.financialYear(new Date('2026-03-31T20:00:00Z')), '2627');
  assert.equal(invoice.financialYear(new Date('2026-03-31T10:00:00Z')), '2526');
});

test('amount in words uses Indian numbering', () => {
  assert.equal(invoice.amountInWords(2348), 'Rupees Two Thousand Three Hundred Forty Eight Only');
  assert.equal(
    invoice.amountInWords(1234567.5),
    'Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Fifty Paise Only',
  );
  assert.equal(invoice.amountInWords(0.12), 'Rupees Zero and Twelve Paise Only');
});

test('renders a PDF', async () => {
  vi.spyOn(Product, 'find').mockImplementation(() => ({ select: () => ({ lean: async () => [] }) }));
  const order = sampleOrder();
  for (const gstin of [UP_GSTIN, '']) {
    const pdf = await invoice.renderPdf(await invoice.buildInvoiceData(order, order.sellerShipments[0], issued(gstin)));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  }
});

test('customers get an invoice only for delivered parcels, and only for their own order', async () => {
  let calls = 0;
  const order = sampleOrder();
  const ctx = loadController({
    '../models/Order': { findOne: async (f) => (String(f.user) === 'buyer' ? order : null) },
    '../modules/orders/tax-invoice.service': {
      invoicePdf: async (_o, entry) => {
        calls++;
        return { pdf: Buffer.from('%PDF'), filename: 'x.pdf', entry };
      },
      sendPdf: (res) => res.json({ sent: true }),
    },
  });
  const run = async (user, query = {}) => {
    const res = response();
    try {
      await ctx.exports.customerOrderInvoice({ params: { id: 'TIN-2026-000020' }, query, user: { _id: user } }, res);
    } catch (e) {
      res.error = e.message;
      if (e.status) res.statusCode = e.status; /* AppError carries the status the error layer answers with */
    }
    return res;
  };
  assert.equal((await run('buyer')).body.sent, true);
  assert.equal((await run('stranger')).statusCode, 404);
  order.sellerShipments[0].status = 'shipped';
  const early = await run('buyer');
  assert.equal(early.statusCode, 400);
  assert.match(early.error, /once the order is delivered/);
  assert.equal(calls, 1);
});

test('sellers can download their parcel invoice once it has an AWB', async () => {
  const order = sampleOrder();
  order.sellerShipments[0].status = 'awb';
  let sent = 0;
  const ctx = loadController({
    '../models/Order': { findOne: async () => order },
    '../modules/orders/tax-invoice.service': {
      ...invoice,
      invoicePdf: async () => ({ pdf: Buffer.from('%PDF'), filename: 'x.pdf' }),
      sendPdf: () => {
        sent++;
      },
    },
  });
  const call = async () => {
    const res = response();
    try {
      await ctx.exports.sellerOrderInvoice({ params: { id: 'TIN-2026-000020' }, user: { _id: SELLER } }, res);
    } catch (e) {
      res.error = e.message;
      if (e.status) res.statusCode = e.status; /* AppError carries the status the error layer answers with */
    }
    return res;
  };
  await call();
  assert.equal(sent, 1);
  order.sellerShipments[0].awbCode = '';
  assert.match((await call()).error, /once the parcel has an AWB/);
});
