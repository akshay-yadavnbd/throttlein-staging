/**
 * Products are capped at ₹10,00,000 (price, MRP and variant overrides) —
 * on the model, so every write path is covered, and on the request schema,
 * so the form gets the sentence before a save is attempted.
 */
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Product = require('../src/modules/products/product.model');
const { productFields } = require('../src/modules/products/products.schema');
const { MAX_PRICE } = require('../src/modules/products/price-limit');

const base = () => ({
  seller: new mongoose.Types.ObjectId(),
  category: new mongoose.Types.ObjectId(),
  name: 'Helmet',
  price: 1999,
});
const errorsOf = (fields) => new Product({ ...base(), ...fields }).validateSync()?.errors || {};

test('the cap is ₹10,00,000', () => {
  assert.equal(MAX_PRICE, 1_000_000);
});

test('a price or MRP of exactly the cap is allowed', () => {
  assert.deepEqual(Object.keys(errorsOf({ price: MAX_PRICE, mrp: MAX_PRICE })), []);
});

test('a price over the cap is refused with a sentence', () => {
  const errors = errorsOf({ price: MAX_PRICE + 1 });
  assert.equal(errors.price?.message, 'Price can be at most ₹10,00,000.');
});

test('an MRP over the cap is refused', () => {
  assert.equal(errorsOf({ mrp: 6_000_000 }).mrp?.message, 'MRP can be at most ₹10,00,000.');
});

test('variant price and MRP overrides are capped too', () => {
  const errors = errorsOf({ variants: [{ size: 'M', color: 'Black', stock: 1, price: 2_000_000, mrp: 3_000_000 }] });
  assert.equal(errors['variants.0.price']?.message, 'Variant price can be at most ₹10,00,000.');
  assert.equal(errors['variants.0.mrp']?.message, 'Variant MRP can be at most ₹10,00,000.');
});

test('the request schema refuses an over-cap price before any save', () => {
  const res = productFields.safeParse({ price: '1000000000000' });
  assert.equal(res.success, false);
  assert.equal(res.error.issues[0].message, 'Price can be at most ₹10,00,000.');
});

test('the request schema passes in-range and omitted prices', () => {
  assert.equal(productFields.safeParse({ price: '1000000', mrp: '999999' }).success, true);
  assert.equal(productFields.safeParse({ name: 'No price on this update' }).success, true);
});
