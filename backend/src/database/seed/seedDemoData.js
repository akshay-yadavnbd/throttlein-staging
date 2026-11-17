/**
 * Demo data seeder.
 *
 *   npm run seed:demo
 *
 * Creates (idempotently):
 *   - 10 sellers, each with full approved KYC + bank details + slug
 *   - 10 customers, each with one saved address + slug
 *   - 100 products (10 per seller), spread across categories from seedCategories
 *   - 100 orders (10 per seller), spread across customers + statuses + last 6 months
 *
 * Re-runnable: skips records that already exist by email / sku / orderNumber.
 *
 * Requires categories and brands to already be seeded (npm run seed handles
 * categories on app boot; brands seed once on first connect).
 */
require('../../config/loadEnv');

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../../models/User');
const Product = require('../../modules/products/product.model');
const Category = require('../../modules/catalog/category.model');
const Brand = require('../../modules/catalog/brand.model');
const Order = require('../../modules/orders/order.model');
const { env } = require('../../config/env');

const { DEMO_SELLERS, DEMO_CUSTOMERS, PRODUCT_TEMPLATES } = require('./demo-data.fixtures');

/* ─────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                 */
/* ─────────────────────────────────────────────────────────────────────── */

function ph(text) {
  return `https://placehold.co/800x800/141414/FFFFFF.png?text=${encodeURIComponent(text)}&font=raleway`;
}

function pickPhone(i) {
  // Predictable 10-digit numbers so re-running keeps the same seller.phone.
  return `9${String(800000000 + i * 73 + 12345).slice(0, 9)}`;
}

function pickIfsc(i) {
  const banks = ['HDFC', 'ICIC', 'SBIN', 'AXIS', 'KKBK', 'PUNB'];
  const b = banks[i % banks.length];
  return `${b}0${String(100000 + i * 17).slice(0, 6)}`;
}

function pickBankName(i) {
  const banks = [
    'HDFC Bank',
    'ICICI Bank',
    'State Bank of India',
    'Axis Bank',
    'Kotak Mahindra Bank',
    'Punjab National Bank',
  ];
  return banks[i % banks.length];
}

function pickAccountNumber(i) {
  return String(20000000000 + i * 11317).slice(0, 12);
}

/** Random number in [min, max], inclusive. */
const rint = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ─────────────────────────────────────────────────────────────────────── */
/* Seller + customer creation                                              */
/* ─────────────────────────────────────────────────────────────────────── */

async function seedSellers() {
  const hashedPw = await bcrypt.hash('seller1234', 10);
  const created = [];
  for (let i = 0; i < DEMO_SELLERS.length; i++) {
    const v = DEMO_SELLERS[i];
    const email = `seller${i + 1}@throttlein.test`;
    let user = await User.findOne({ email });
    if (user) {
      console.log(`  · seller exists: ${v.storeName} <${email}>`);
      created.push(user);
      continue;
    }
    user = new User({
      name: v.name,
      storeName: v.storeName,
      email,
      password: hashedPw,
      phone: pickPhone(i + 1),
      role: 'seller',
      status: 'approved',
      emailVerified: true,
      kyc: {
        gstin: v.gstin,
        pan: v.pan,
        gstCertificate: ph('GST CERT'),
        panCard: ph('PAN CARD'),
        pickupAddress: {
          contactName: v.name,
          contactPhone: pickPhone(i + 1),
          contactEmail: email,
          line1: `Plot ${10 + i}, Sector ${i + 4}`,
          line2: 'Industrial Area',
          city: v.city,
          state: v.state,
          pincode: v.pincode,
          country: 'India',
        },
        bankDetails: {
          accountHolder: v.name,
          accountNumber: pickAccountNumber(i + 1),
          ifsc: pickIfsc(i + 1),
          bankName: pickBankName(i + 1),
          cancelledCheque: '',
        },
        status: 'approved',
        submittedAt: new Date(Date.now() - (180 - i * 5) * 24 * 3600 * 1000),
        reviewedAt: new Date(Date.now() - (175 - i * 5) * 24 * 3600 * 1000),
        rejectionReason: '',
      },
    });
    // The pre-save hook bcrypts the password if isModified — we passed pre-hashed,
    // so flag it as un-modified by setting directly through assignment then bypassing.
    // Mongoose actually marks all fields as modified on `new` + save, so the hook
    // will re-hash. Easier: just set the password as plain "seller1234" and let
    // the hook hash it. Replace:
    user.password = 'seller1234';
    await user.save({ validateBeforeSave: false });
    console.log(`  ✓ seller: ${v.storeName} → ${user.slug}`);
    created.push(user);
  }
  return created;
}

async function seedCustomers() {
  const created = [];
  for (let i = 0; i < DEMO_CUSTOMERS.length; i++) {
    const c = DEMO_CUSTOMERS[i];
    const email = `customer${i + 1}@throttlein.test`;
    let user = await User.findOne({ email });
    if (user) {
      console.log(`  · customer exists: ${c.name} <${email}>`);
      created.push(user);
      continue;
    }
    user = new User({
      name: c.name,
      email,
      phone: pickPhone(100 + i),
      role: 'customer',
      status: 'approved',
      emailVerified: true,
      addresses: [
        {
          label: 'Home',
          fullName: c.name,
          phone: pickPhone(100 + i),
          line1: `${rint(10, 999)}, ${c.name.split(' ')[1] || 'Apartments'}`,
          line2: `Sector ${rint(1, 100)}`,
          city: c.city,
          state: c.state,
          pincode: c.pincode,
          country: 'India',
          isDefault: true,
        },
      ],
    });
    user.password = 'customer1234';
    await user.save({ validateBeforeSave: false });
    console.log(`  ✓ customer: ${c.name} → ${user.slug}`);
    created.push(user);
  }
  return created;
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Products                                                                */
/* ─────────────────────────────────────────────────────────────────────── */

async function seedProductsForSeller(seller, sellerIdx) {
  const created = [];
  for (let i = 0; i < PRODUCT_TEMPLATES.length; i++) {
    const t = PRODUCT_TEMPLATES[i];
    const name = `${seller.storeName} ${t.brand} ${t.cat} ${String.fromCharCode(65 + i)}`;
    const sku = `V${sellerIdx + 1}-P${i + 1}`;
    let p = await Product.findOne({ sku });
    if (p) {
      created.push(p);
      continue;
    }
    const category = await Category.findOne({ name: t.cat });
    if (!category) {
      console.warn(`  ⚠ category not found: ${t.cat} — run npm run seed first`);
      continue;
    }
    const brand = await Brand.findOne({ name: t.brand });
    const stock = rint(5, 80);
    p = new Product({
      seller: seller._id,
      name,
      category: category._id,
      brand: brand ? brand._id : null,
      description: `${name} — high-quality ${t.cat.toLowerCase()} from ${t.brand}. Sold by ${seller.storeName}.`,
      price: t.basePrice + rint(-300, 300),
      mrp: t.mrp,
      stock,
      images: [ph(`${seller.storeName} ${t.brand}`), ph(t.cat)],
      sku,
      sizes: t.sizes,
      color: choice(['Black', 'Grey', 'Red', 'Blue']),
      weightGrams: t.weight,
      status: 'active',
      rating: Math.round((rint(35, 50) / 10) * 10) / 10,
      reviewsCount: rint(0, 120),
      isFeatured: i === 0,
    });
    await p.save();
    created.push(p);
  }
  console.log(`  ✓ ${seller.storeName}: ${created.length} products`);
  return created;
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Orders                                                                  */
/* ─────────────────────────────────────────────────────────────────────── */

const STATUS_DISTRIBUTION = [
  'delivered',
  'delivered',
  'delivered',
  'delivered',
  'shipped',
  'shipped',
  'confirmed',
  'confirmed',
  'placed',
  'cancelled',
];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function buildTimestamps(status, placedAt) {
  const out = { createdAt: placedAt, updatedAt: placedAt };
  if (status === 'cancelled') {
    out.cancelledAt = new Date(placedAt.getTime() + rint(2, 48) * HOUR);
    out.updatedAt = out.cancelledAt;
    return out;
  }
  if (status === 'placed') return out;

  out.confirmedAt = new Date(placedAt.getTime() + rint(1, 6) * HOUR);
  if (status === 'confirmed') {
    out.updatedAt = out.confirmedAt;
    return out;
  }
  out.shippedAt = new Date(out.confirmedAt.getTime() + rint(12, 48) * HOUR);
  if (status === 'shipped') {
    out.updatedAt = out.shippedAt;
    return out;
  }
  out.deliveredAt = new Date(out.shippedAt.getTime() + rint(1, 5) * DAY);
  out.updatedAt = out.deliveredAt;
  return out;
}

async function seedOrdersForSeller(seller, sellerProducts, customers, sellerIdx) {
  if (sellerProducts.length === 0) return 0;
  let made = 0;
  for (let i = 0; i < 10; i++) {
    const orderNumber = `TIN-2026-DEMO-${String(sellerIdx + 1).padStart(2, '0')}${String(i + 1).padStart(2, '0')}`;
    const existing = await Order.findOne({ orderNumber });
    if (existing) continue;

    const customer = customers[(sellerIdx + i) % customers.length];
    const product = sellerProducts[i % sellerProducts.length];
    const qty = rint(1, 3);
    const subtotal = product.price * qty;
    const shippingFee = subtotal >= 5000 ? 0 : 99;
    const total = subtotal + shippingFee;
    const status = STATUS_DISTRIBUTION[i];
    // Spread placedAt across the last 6 months
    const placedAt = new Date(Date.now() - rint(7, 180) * DAY);
    const ts = buildTimestamps(status, placedAt);

    const addr = customer.addresses?.[0];
    if (!addr) continue;

    const order = new Order({
      orderNumber,
      user: customer._id,
      items: [
        {
          product: product._id,
          name: product.name,
          image: product.images?.[0] || '',
          seller: seller._id,
          brand: product.brand ? (await Brand.findById(product.brand))?.name || '' : '',
          category: (await Category.findById(product.category))?.name || '',
          size: product.sizes?.[0] || '',
          price: product.price,
          mrp: product.mrp,
          quantity: qty,
          subtotal,
        },
      ],
      shippingAddress: {
        label: addr.label,
        fullName: addr.fullName,
        phone: addr.phone,
        line1: addr.line1,
        line2: addr.line2,
        city: addr.city,
        state: addr.state,
        pincode: addr.pincode,
        country: addr.country,
      },
      itemsTotal: subtotal,
      shippingFee,
      total,
      paymentMethod: i % 3 === 0 ? 'online' : 'cod',
      paymentStatus: status === 'delivered' ? 'paid' : status === 'cancelled' ? 'refunded' : 'pending',
      status,
      confirmedAt: ts.confirmedAt,
      shippedAt: ts.shippedAt,
      deliveredAt: ts.deliveredAt,
      cancelledAt: ts.cancelledAt,
    });
    // Bypass orderNumber auto-generation by setting our deterministic one,
    // and override timestamps after save (Mongoose ignores explicit createdAt
    // unless { timestamps: false } at save time).
    await order.save({ timestamps: false });
    // Force the createdAt back to placedAt (Mongoose may have stamped 'now').
    await Order.updateOne({ _id: order._id }, { $set: { createdAt: placedAt, updatedAt: ts.updatedAt } });
    made += 1;
  }
  console.log(`  ✓ ${seller.storeName}: ${made} orders`);
  return made;
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Entry point                                                             */
/* ─────────────────────────────────────────────────────────────────────── */

(async function run() {
  if (!env.MONGO_URI) {
    console.error('MONGO_URI missing.');
    process.exit(1);
  }
  console.log('Connecting to MongoDB…');
  await mongoose.connect(env.MONGO_URI);

  console.log('\n— Sellers —');
  const sellers = await seedSellers();

  console.log('\n— Customers —');
  const customers = await seedCustomers();

  console.log('\n— Products (10 per seller) —');
  const productsBySeller = [];
  for (let i = 0; i < sellers.length; i++) {
    productsBySeller.push(await seedProductsForSeller(sellers[i], i));
  }

  console.log('\n— Orders (10 per seller) —');
  let orderCount = 0;
  for (let i = 0; i < sellers.length; i++) {
    orderCount += await seedOrdersForSeller(sellers[i], productsBySeller[i], customers, i);
  }

  console.log(`\nDone.`);
  console.log(`  sellers:   ${sellers.length}`);
  console.log(`  customers: ${customers.length}`);
  console.log(`  products:  ${productsBySeller.reduce((s, ps) => s + ps.length, 0)}`);
  console.log(`  orders:    ${orderCount} new (existing skipped)`);
  console.log(`\nLogins:`);
  console.log(`  sellers   → seller1@throttlein.test … seller10@throttlein.test  · password: seller1234`);
  console.log(`  customers → customer1@throttlein.test … customer10@throttlein.test · password: customer1234`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
