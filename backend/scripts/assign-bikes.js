/**
 * assign-bikes.js
 *
 * Finds products that are clearly bike-specific from their NAME
 * ("Red Rooster Performance Stellar Black for Continental GT /
 * Interceptor 650", "Kawasaki Z1000 brake pad …") but have no `bike`
 * assigned, and attaches them to the right model under Shop by Bike.
 *
 * Matching, strongest first:
 *   1. Existing Shop by Bike MODEL names from the DB, matched loosely
 *      (case-insensitive; spaces/hyphens/slashes interchangeable), the
 *      longest name wins ("Continental GT 650" beats "GT 650").
 *   2. ALIASES — common shorthand sellers use ("Interceptor", "GT 650",
 *      "Gold Star") mapped to a canonical Make > Model. If that model
 *      (or its make) doesn't exist yet, it is CREATED under the maker.
 *   3. Make-plus-code inference — a make name followed by a token with
 *      digits ("Kawasaki Z1000 …") creates/uses that model under the
 *      make.
 *
 * A product naming several bikes ("Continental GT / Interceptor 650")
 * gets the longest single match (a product carries ONE bike ref) and is
 * flagged in the report so you can review.
 *
 * DRY RUN by default. --apply to execute. --seller=email to scope.
 *
 *   node scripts/assign-bikes.js --seller=revvgearz@gmail.com
 *   node scripts/assign-bikes.js --seller=revvgearz@gmail.com --apply
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Category = require('../src/modules/catalog/category.model');
const Product = require('../src/modules/products/product.model');
const User = require('../src/models/User');

const APPLY = process.argv.includes('--apply');
const sellerEmail = (process.argv.find((a) => a.startsWith('--seller=')) || '').split('=')[1];

/* Shorthand → canonical Make/Model. Model is created under the make if
   it doesn't exist in the tree yet. Extend freely. */
const ALIASES = [
  { alias: 'interceptor 650', make: 'Royal Enfield', model: 'Interceptor 650' },
  { alias: 'interceptor', make: 'Royal Enfield', model: 'Interceptor 650' },
  { alias: 'int 650', make: 'Royal Enfield', model: 'Interceptor 650' },
  { alias: 'continental gt 650', make: 'Royal Enfield', model: 'Continental GT 650' },
  { alias: 'continental gt', make: 'Royal Enfield', model: 'Continental GT 650' },
  { alias: 'gt 650', make: 'Royal Enfield', model: 'Continental GT 650' },
  { alias: 'super meteor', make: 'Royal Enfield', model: 'Super Meteor 650' },
  { alias: 'himalayan 450', make: 'Royal Enfield', model: 'Himalayan 450' },
  { alias: 'himalayan', make: 'Royal Enfield', model: 'Himalayan' },
  { alias: 'scram 411', make: 'Royal Enfield', model: 'Scram 411' },
  { alias: 'hunter 350', make: 'Royal Enfield', model: 'Hunter 350' },
  { alias: 'classic 350', make: 'Royal Enfield', model: 'Classic 350' },
  { alias: 'meteor 350', make: 'Royal Enfield', model: 'Meteor 350' },
  { alias: 'bullet 350', make: 'Royal Enfield', model: 'Bullet 350' },
  { alias: 'guerrilla 450', make: 'Royal Enfield', model: 'Guerrilla 450' },
  { alias: 'shotgun 650', make: 'Royal Enfield', model: 'Shotgun 650' },
  { alias: 'gold star 650', make: 'BSA', model: 'Gold Star 650' },
  { alias: 'gold star', make: 'BSA', model: 'Gold Star 650' },
  { alias: 'goldstar', make: 'BSA', model: 'Gold Star 650' },
  { alias: 'dominar 400', make: 'Bajaj', model: 'Dominar 400' },
  { alias: 'dominar 250', make: 'Bajaj', model: 'Dominar 250' },
  { alias: 'dominar', make: 'Bajaj', model: 'Dominar 400' },
  { alias: 'xpulse 200', make: 'Hero', model: 'Xpulse 200' },
  { alias: 'xpulse', make: 'Hero', model: 'Xpulse 200' },
  { alias: 'duke 390', make: 'KTM', model: 'Duke 390' },
  { alias: 'duke 250', make: 'KTM', model: 'Duke 250' },
  { alias: 'duke 200', make: 'KTM', model: 'Duke 200' },
  { alias: 'adventure 390', make: 'KTM', model: 'Adventure 390' },
  { alias: 'rc 390', make: 'KTM', model: 'RC 390' },
  { alias: 'speed 400', make: 'Triumph', model: 'Speed 400' },
  { alias: 'scrambler 400x', make: 'Triumph', model: 'Scrambler 400 X' },
  { alias: 'scrambler 400 x', make: 'Triumph', model: 'Scrambler 400 X' },
  { alias: 'x440', make: 'Harley-Davidson', model: 'X440' },
  { alias: 'apache rr 310', make: 'TVS', model: 'Apache RR 310' },
  { alias: 'apache rtr 200', make: 'TVS', model: 'Apache RTR 200 4V' },
];

/* Loose regex from a name: token gaps accept spaces / hyphens / slashes,
   and the whole thing is word-bounded so "GT 650" can't match inside
   "MGT 6500". */
function looseRe(name) {
  const tokens = String(name)
    .trim()
    .split(/[\s\-/]+/)
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![a-z0-9])${tokens.join('[\\s\\-\\/]*')}(?![a-z0-9])`, 'i');
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  const root = await Category.findOne({ name: 'Shop by Bike', parent: null });
  if (!root) {
    console.error('"Shop by Bike" root not found.');
    process.exit(1);
  }
  const makes = await Category.find({ parent: root._id });
  const makeByName = new Map(makes.map((m) => [m.name.toLowerCase(), m]));
  const models = await Category.find({ parent: { $in: makes.map((m) => m._id) } });
  const makeById = new Map(makes.map((m) => [String(m._id), m]));

  // Matchers from EXISTING models — longest names first.
  const dbMatchers = models
    .map((m) => ({ re: looseRe(m.name), doc: m, label: m.name, len: m.name.length }))
    .sort((a, b) => b.len - a.len);
  const aliasMatchers = ALIASES.map((a) => ({ ...a, re: looseRe(a.alias), len: a.alias.length })).sort(
    (a, b) => b.len - a.len,
  );

  async function ensureMake(name) {
    let m = makeByName.get(name.toLowerCase());
    if (m) return m;
    console.log(`  + create make "${name}" under Shop by Bike`);
    m = new Category({ name, parent: root._id, isActive: true });
    if (APPLY) await m.save();
    makes.push(m);
    makeByName.set(name.toLowerCase(), m);
    makeById.set(String(m._id), m);
    return m;
  }
  async function ensureModel(name, make) {
    const existing = models.find(
      (x) => String(x.parent) === String(make._id) && x.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) return existing;
    console.log(`  + create model "${make.name} > ${name}"`);
    const doc = new Category({ name, parent: make._id, isActive: true });
    if (APPLY) await doc.save();
    models.push(doc);
    dbMatchers.push({ re: looseRe(name), doc, label: name, len: name.length });
    dbMatchers.sort((a, b) => b.len - a.len);
    return doc;
  }

  // Products in scope: no bike assigned.
  const filter = { $or: [{ bike: null }, { bike: { $exists: false } }] };
  if (sellerEmail) {
    const seller = await User.findOne({ email: sellerEmail.toLowerCase().trim() });
    if (!seller) {
      console.error(`No user ${sellerEmail}`);
      process.exit(1);
    }
    filter.seller = seller._id;
  }
  const products = await Product.find(filter).select('name bike');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (--apply to execute)'}`);
  console.log(`${products.length} products without a bike\n`);

  let assigned = 0,
    multi = 0,
    makeOnly = 0;
  for (const p of products) {
    const name = p.name || '';

    // 1) all existing-model hits
    const hits = [];
    for (const m of dbMatchers) {
      const match = name.match(m.re);
      if (match) hits.push({ doc: m.doc, label: m.label, text: match[0] });
    }
    // 2) alias hits (may create the model)
    let aliasHit = null;
    if (hits.length === 0) {
      for (const a of aliasMatchers) {
        const match = name.match(a.re);
        if (match) {
          aliasHit = { ...a, text: match[0] };
          break;
        }
      }
    }

    let target = null,
      note = '';
    if (hits.length > 0) {
      // longest matched text wins; extra distinct models get flagged
      hits.sort((a, b) => b.text.length - a.text.length);
      target = hits[0].doc;
      const others = [...new Set(hits.slice(1).map((h) => h.label))].filter((l) => l !== hits[0].label);
      if (others.length) {
        note = ` (also matched: ${others.join(', ')})`;
        multi += 1;
      }
    } else if (aliasHit) {
      const make = await ensureMake(aliasHit.make);
      target = await ensureModel(aliasHit.model, make);
    } else {
      // 3) "<Make> <model-code>" inference — code must contain a digit
      for (const [mkName, mk] of makeByName) {
        const m = name.match(
          new RegExp(
            `(?<![a-z0-9])${mkName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}[\\s\\-]+([a-z]*\\d[\\w\\-]*)`,
            'i',
          ),
        );
        if (m) {
          const code = m[1].toUpperCase();
          target = await ensureModel(code, mk);
          note = ' (inferred from make + code)';
          break;
        }
      }
      if (!target && makes.some((mk) => looseRe(mk.name).test(name))) makeOnly += 1;
    }

    if (target) {
      const parent = makeById.get(String(target.parent));
      console.log(`  ✓ ${name.slice(0, 70)} → ${parent?.name || '?'} > ${target.name}${note}`);
      if (APPLY) {
        p.bike = target._id;
        await p.save();
      }
      assigned += 1;
    }
  }

  console.log(`\nAssigned: ${assigned} of ${products.length}`);
  if (multi) console.log(`Multi-bike names (longest match used, review above): ${multi}`);
  if (makeOnly) console.log(`Make mentioned but model unclear (left unassigned): ${makeOnly}`);
  process.exit(0);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
