/**
 * GST rules shared by the product form, order snapshots and tax invoices.
 *
 * Listed prices are GST-INCLUSIVE: the customer pays the shelf price and
 * the invoice splits it back into taxable value + tax. A seller sets the
 * rate per product (motorcycle parts and riding gear sit in different
 * slabs); products that predate the field use DEFAULT_GST_RATE.
 */
'use strict';

const GST_RATES = [0, 5, 12, 18, 28];
const DEFAULT_GST_RATE = 18;

/** HSN is 4, 6 or 8 digits; '' = not set. */
const HSN_RE = /^(\d{4}|\d{6}|\d{8})$/;

/** Form/CSV value → a valid rate, `undefined` when blank, or NaN when invalid. */
function parseGstRate(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const n = Number(String(value).replace(/%$/, '').trim());
  return GST_RATES.includes(n) ? n : NaN;
}

/** Form/CSV value → normalised HSN ('' when blank), or null when invalid. */
function parseHsn(value) {
  const s = String(value ?? '').replace(/\s+/g, '');
  if (!s) return '';
  return HSN_RE.test(s) ? s : null;
}

/** The rate an order line is taxed at: its snapshot, else the product's, else the default. */
function effectiveRate(...candidates) {
  for (const c of candidates) {
    const n = Number(c);
    if (c !== undefined && c !== null && c !== '' && GST_RATES.includes(n)) return n;
  }
  return DEFAULT_GST_RATE;
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Split a GST-inclusive amount. Intra-state supply (seller and customer in
 * the same state) is CGST + SGST in equal halves; inter-state is IGST.
 * Halves are rounded so cgst + sgst === tax exactly.
 */
function splitInclusive(amount, rate, intraState) {
  const gross = round2(amount);
  const taxable = round2(gross / (1 + rate / 100));
  const tax = round2(gross - taxable);
  if (!intraState) return { gross, taxable, rate, tax, igst: tax, cgst: 0, sgst: 0 };
  const cgst = round2(tax / 2);
  return { gross, taxable, rate, tax, igst: 0, cgst, sgst: round2(tax - cgst) };
}

/* GST state codes (first two digits of a GSTIN). Keys are lower-cased,
 * punctuation-free names; ALIASES catches the spellings addresses use. */
const STATE_CODES = {
  'jammu and kashmir': '01',
  'himachal pradesh': '02',
  punjab: '03',
  chandigarh: '04',
  uttarakhand: '05',
  haryana: '06',
  delhi: '07',
  rajasthan: '08',
  'uttar pradesh': '09',
  bihar: '10',
  sikkim: '11',
  'arunachal pradesh': '12',
  nagaland: '13',
  manipur: '14',
  mizoram: '15',
  tripura: '16',
  meghalaya: '17',
  assam: '18',
  'west bengal': '19',
  jharkhand: '20',
  odisha: '21',
  chhattisgarh: '22',
  'madhya pradesh': '23',
  gujarat: '24',
  'dadra and nagar haveli and daman and diu': '26',
  maharashtra: '27',
  karnataka: '29',
  goa: '30',
  lakshadweep: '31',
  kerala: '32',
  'tamil nadu': '33',
  puducherry: '34',
  'andaman and nicobar islands': '35',
  telangana: '36',
  'andhra pradesh': '37',
  ladakh: '38',
};
const ALIASES = {
  'new delhi': 'delhi',
  'nct of delhi': 'delhi',
  'delhi ncr': 'delhi',
  orissa: 'odisha',
  uttaranchal: 'uttarakhand',
  pondicherry: 'puducherry',
  'j and k': 'jammu and kashmir',
  'jammu kashmir': 'jammu and kashmir',
  'andaman and nicobar': 'andaman and nicobar islands',
  'daman and diu': 'dadra and nagar haveli and daman and diu',
  'dadra and nagar haveli': 'dadra and nagar haveli and daman and diu',
  up: 'uttar pradesh',
  mp: 'madhya pradesh',
  tn: 'tamil nadu',
  wb: 'west bengal',
};

function normaliseState(name) {
  const key = String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ALIASES[key] || key;
}

/** Two-digit GST state code for a state name, or '' when unknown. */
function stateCode(name) {
  return STATE_CODES[normaliseState(name)] || '';
}

/** Same state? Uses the GSTIN's state code when the seller has one — it is authoritative. */
function isIntraState({ sellerState, sellerGstin, customerState }) {
  const sellerCode = /^\d{2}/.test(String(sellerGstin || ''))
    ? String(sellerGstin).slice(0, 2)
    : stateCode(sellerState);
  const customerCode = stateCode(customerState);
  if (sellerCode && customerCode) return sellerCode === customerCode;
  return normaliseState(sellerState) !== '' && normaliseState(sellerState) === normaliseState(customerState);
}

module.exports = {
  GST_RATES,
  DEFAULT_GST_RATE,
  HSN_RE,
  parseGstRate,
  parseHsn,
  effectiveRate,
  splitInclusive,
  stateCode,
  isIntraState,
  round2,
};
