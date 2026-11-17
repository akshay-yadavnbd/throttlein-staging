/**
 * restructure-categories.js
 *
 * Rebuilds the catalog around the new two-level taxonomy (19 parent
 * categories, each with subcategories) and moves every product into it.
 *
 * How existing categories are handled — three mechanisms, safest first:
 *   1. ABSORB   — an existing category whose name matches a target
 *                 (case/plural-insensitive) is renamed to the canonical
 *                 name and re-parented. Products stay attached — no
 *                 reassignment needed. ("Riding Jacket" → becomes the
 *                 "Riding Jackets" parent; "Touring Gloves" moves under
 *                 "Riding Gloves".)
 *   2. REPARENT — old categories that deserve to live on as extra
 *                 children of a new parent keep their products and just
 *                 move + get a cleaned-up name ("FLUID GUARDS & CAPS" →
 *                 "Fluid Guards & Caps" under Bike Protection).
 *   3. REASSIGN — old categories whose name has no place in the new
 *                 tree get their products (and their descendants'
 *                 products) moved to the mapped target, then the empty
 *                 old category is deactivated ("Bluetooth" products →
 *                 "Mobile & Navigation > Intercom Systems").
 *
 * Anything not covered is left untouched and listed with its product
 * count so nothing silently disappears. The Shop by Bike tree is never
 * touched. Old categories are deactivated, not deleted.
 *
 * DRY RUN by default — prints every planned action. Run with --apply
 * to execute.
 *
 *   node scripts/restructure-categories.js
 *   node scripts/restructure-categories.js --apply
 */
require('../loadEnv');
const mongoose = require('mongoose');
const Category = require('../src/modules/catalog/category.model');
const Product = require('../src/modules/products/product.model');

const APPLY = process.argv.includes('--apply');

/* ─── Target taxonomy ─────────────────────────────────────────────── */
const TREE = {
  // Rider gear
  Helmets: [
    'Full Face Helmets',
    'Modular / Flip-Up Helmets',
    'Open Face Helmets',
    'Off-Road / Motocross Helmets',
    'Adventure Helmets',
    'Half Helmets',
    'Touring Helmets',
    'Kids Helmets',
    'Bluetooth Helmets',
    'Helmet Accessories',
  ],
  'Riding Jackets': [
    'Textile Jackets',
    'Mesh Jackets',
    'Leather Jackets',
    'Adventure Jackets',
    'Touring Jackets',
    'Winter Jackets',
    'Rain Jackets',
    'Protective Armored Jackets',
  ],
  'Riding Gloves': [
    'Summer Gloves',
    'Winter Gloves',
    'Waterproof Gloves',
    'Racing Gloves',
    'Touring Gloves',
    'Off-Road Gloves',
    'Urban Riding Gloves',
  ],
  'Riding Pants': ['Riding Jeans', 'Touring Pants', 'Adventure Pants', 'Waterproof Pants', 'Protective Riding Pants'],
  'Riding Boots': [
    'Touring Boots',
    'Racing Boots',
    'Adventure Boots',
    'Urban Riding Shoes',
    'Waterproof Boots',
    'Off-Road Boots',
  ],
  'Riding Suits': ['One Piece Suits', 'Two Piece Suits', 'Track Suits', 'Touring Suits'],
  'Protection Gear': [
    'Knee Guards',
    'Elbow Guards',
    'Back Protectors',
    'Chest Protectors',
    'Neck Protectors',
    'Armored Shorts',
    'Body Armor',
  ],
  'Rain Gear': ['Rain Suits', 'Rain Jackets', 'Rain Pants', 'Waterproof Covers', 'Shoe Covers'],
  // Motorcycle accessories
  'Luggage & Touring': [
    'Saddle Bags',
    'Tank Bags',
    'Tail Bags',
    'Top Boxes',
    'Side Panniers',
    'Backpacks',
    'Mobile Pouches',
    'Hydration Packs',
  ],
  'Mobile & Navigation': ['Mobile Holders', 'GPS Mounts', 'USB Chargers', 'Action Camera Mounts', 'Intercom Systems'],
  'Bike Protection': [
    'Crash Guards',
    'Frame Sliders',
    'Engine Guards',
    'Lever Guards',
    'Radiator Guards',
    'Bash Plates',
    'Fork Sliders',
  ],
  Lighting: ['Auxiliary Lights', 'Fog Lights', 'LED Indicators', 'Tail Lights', 'Headlight Upgrades'],
  'Performance Parts': [
    'Exhaust Systems',
    'Air Filters',
    'Brake Pads',
    'Chains & Sprockets',
    'Suspension Upgrades',
    'Clutch Kits',
  ],
  'Bike Care': ['Chain Lubricants', 'Bike Shampoo', 'Polish & Wax', 'Cleaning Kits', 'Microfiber Cloths'],
  Security: ['Disc Locks', 'Chain Locks', 'GPS Trackers', 'Alarm Systems'],
  Electronics: ['Tire Pressure Monitors', 'Dash Cameras', 'Battery Chargers', 'Jump Starters'],
  // Lifestyle & merchandise
  Apparel: ['T-Shirts', 'Hoodies', 'Caps', 'Jerseys'],
  Collectibles: ['Stickers', 'Keychains', 'Posters', 'Miniatures'],
  'Camping & Travel': ['Tents', 'Sleeping Bags', 'Cooking Gear', 'Travel Accessories'],
};

/* Old categories that survive as EXTRA children of a new parent —
   products stay attached, only the name/parent change. */
const REPARENT = [
  { match: 'headlight grill', canonical: 'Headlight Grill', parent: 'Bike Protection' },
  { match: 'fluid guards & caps', canonical: 'Fluid Guards & Caps', parent: 'Bike Protection' },
  { match: 'mirror', canonical: 'Mirrors', parent: 'Bike Protection' },
  { match: 'carrier & back rack', canonical: 'Carrier & Back Rack', parent: 'Luggage & Touring' },
  { match: 'extra fuel carrier', canonical: 'Extra Fuel Carrier', parent: 'Luggage & Touring' },
  { match: 'spark plugs', canonical: 'Spark Plugs', parent: 'Performance Parts' },
  { match: 'engine oil', canonical: 'Engine Oil', parent: 'Bike Care' },
  { match: 'coolant', canonical: 'Coolant', parent: 'Bike Care' },
  { match: 'base layer upper', canonical: 'Base Layers', parent: 'Apparel' },
];

/* Old category name → new target path. Products (incl. descendants')
   are moved, then the emptied old category is deactivated. */
const REASSIGN = {
  gloves: 'Riding Gloves',
  'riding boots/shoes': 'Riding Boots',
  boots: 'Riding Boots',
  jackets: 'Riding Jackets',
  'riding denims': 'Riding Pants > Riding Jeans',
  'rain liner jackets': 'Rain Gear > Rain Jackets',
  bluetooth: 'Mobile & Navigation > Intercom Systems',
  navigation: 'Mobile & Navigation',
  'rider tech': 'Mobile & Navigation',
  headlight: 'Lighting > Headlight Upgrades',
  lights: 'Lighting',
  exhaust: 'Performance Parts > Exhaust Systems',
  'air filter': 'Performance Parts > Air Filters',
  'chain & sprocket': 'Performance Parts > Chains & Sprockets',
  'chain lube/cleaner': 'Bike Care > Chain Lubricants',
  'trail pack': 'Luggage & Touring > Backpacks',
  'helmets and accessories': 'Helmets',
  'bags and backpacks': 'Luggage & Touring',
  'rider protection': 'Protection Gear',
};

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim();
const deplural = (s) => s.replace(/s\b/g, '');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const all = await Category.find({});
  const byId = new Map(all.map((c) => [String(c._id), c]));
  const sbb = all.find((c) => c.parent === null && c.name === 'Shop by Bike');
  const inBikeTree = (c) => {
    let cur = c;
    while (cur) {
      if (sbb && String(cur._id) === String(sbb._id)) return true;
      cur = cur.parent ? byId.get(String(cur.parent)) : null;
    }
    return false;
  };
  const cats = all.filter((c) => !inBikeTree(c));
  const countFor = (id) => Product.countDocuments({ category: id });
  const childrenOf = (id) => cats.filter((c) => String(c.parent || '') === String(id));
  const descendants = (id) => {
    const out = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      for (const ch of childrenOf(cur)) {
        out.push(ch);
        stack.push(String(ch._id));
      }
    }
    return out;
  };

  const claimed = new Set(); // category ids already absorbed into the new tree
  const targetByPath = new Map(); // "Parent" or "Parent > Child" → doc

  function findMatch(name) {
    const n = norm(name),
      dn = deplural(norm(name));
    return cats.find((c) => !claimed.has(String(c._id)) && (norm(c.name) === n || deplural(norm(c.name)) === dn));
  }

  async function ensure(name, parentDoc, path) {
    let doc = findMatch(name);
    if (doc) {
      const renames = [];
      if (doc.name !== name) renames.push(`rename "${doc.name}" → "${name}"`);
      const wantParent = parentDoc ? String(parentDoc._id) : null;
      if (String(doc.parent || '') !== String(wantParent || '')) {
        renames.push(`move under "${parentDoc ? parentDoc.name : 'top level'}"`);
      }
      if (renames.length) {
        console.log(`  ABSORB  ${path}: ${renames.join(', ')} (${await countFor(doc._id)} products stay)`);
        if (APPLY) {
          doc.name = name;
          doc.parent = parentDoc ? parentDoc._id : null;
          doc.isActive = true;
          await doc.save();
        }
      }
    } else {
      console.log(`  CREATE  ${path}`);
      doc = new Category({ name, parent: parentDoc ? parentDoc._id : null, isActive: true });
      if (APPLY) await doc.save();
      cats.push(doc);
      byId.set(String(doc._id), doc);
    }
    claimed.add(String(doc._id));
    targetByPath.set(path, doc);
    return doc;
  }

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (use --apply to execute)'}\n`);

  console.log('── build target tree ───────────────────');
  for (const [parent, children] of Object.entries(TREE)) {
    const pDoc = await ensure(parent, null, parent);
    for (const child of children) await ensure(child, pDoc, `${parent} > ${child}`);
  }

  console.log('\n── re-parent kept categories ───────────');
  for (const r of REPARENT) {
    const doc = cats.find((c) => !claimed.has(String(c._id)) && norm(c.name) === norm(r.match));
    if (!doc) continue;
    const parentDoc = targetByPath.get(r.parent);
    console.log(`  REPARENT "${doc.name}" → "${r.parent} > ${r.canonical}" (${await countFor(doc._id)} products stay)`);
    if (APPLY) {
      doc.name = r.canonical;
      doc.parent = parentDoc._id;
      doc.isActive = true;
      await doc.save();
    }
    claimed.add(String(doc._id));
  }

  console.log('\n── move products from retired names ────');
  for (const [oldName, targetPath] of Object.entries(REASSIGN)) {
    const target = targetByPath.get(targetPath);
    if (!target) {
      console.log(`  !! target "${targetPath}" missing — skipped`);
      continue;
    }
    const matches = cats.filter((c) => !claimed.has(String(c._id)) && norm(c.name) === norm(oldName));
    for (const old of matches) {
      const ids = [old._id, ...descendants(String(old._id)).map((d) => d._id)];
      const n = await Product.countDocuments({ category: { $in: ids } });
      console.log(`  MOVE    ${n} products: "${old.name}" → "${targetPath}", then deactivate old`);
      if (APPLY && n > 0) {
        await Product.updateMany({ category: { $in: ids } }, { $set: { category: target._id } });
      }
      if (APPLY) {
        old.isActive = false;
        await old.save();
      }
      claimed.add(String(old._id));
    }
  }

  console.log('\n── leftovers (untouched) ───────────────');
  let leftovers = 0;
  for (const c of cats) {
    if (claimed.has(String(c._id))) continue;
    const n = await countFor(c._id);
    const kids = childrenOf(String(c._id)).length;
    if (n === 0 && kids === 0) {
      console.log(`  DEACTIVATE (empty) "${c.name}"`);
      if (APPLY) {
        c.isActive = false;
        await c.save();
      }
    } else {
      leftovers += 1;
      console.log(`  KEEP "${c.name}" — ${n} products, ${kids} children (review manually)`);
    }
  }
  if (!leftovers) console.log('  (none needing review)');

  if (APPLY) {
    console.log('\n── products per new parent ─────────────');
    for (const parent of Object.keys(TREE)) {
      const pDoc = targetByPath.get(parent);
      const ids = [pDoc._id, ...descendants(String(pDoc._id)).map((d) => d._id)];
      const n = await Product.countDocuments({ category: { $in: ids } });
      if (n > 0) console.log(`  ${String(n).padStart(4)}  ${parent}`);
    }
  }

  console.log('\nDone.');
  process.exit(0);
})().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
