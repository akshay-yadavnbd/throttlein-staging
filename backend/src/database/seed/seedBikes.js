/**
 * Populate the "Shop by Bike" subtree with motorcycle makes and their
 * most popular models sold in India.
 *
 * This is ADDITIVE and IDEMPOTENT — running it repeatedly never duplicates
 * a make or model. It only creates rows that don't already exist by name
 * under the right parent.
 *
 * Run with:
 *   node src/utils/seedBikes.js
 *   # or
 *   npm run seed:bikes
 */
const mongoose = require('mongoose');
require('../../config/loadEnv');
const Category = require('../../modules/catalog/category.model');
const { env } = require('../../config/env');

const { BIKES } = require('./bikes.fixtures');

/** Get-or-create a child category by name under a specific parent. */
async function ensureCategory(name, parentId, order) {
  const found = await Category.findOne({ name, parent: parentId });
  if (found) return { cat: found, created: false };
  const cat = await Category.create({ name, parent: parentId, order, isActive: true });
  return { cat, created: true };
}

/**
 * Find a make under Shop by Bike. Tries the official name first, then a
 * couple of common variants (e.g. "Harley Davidson" without the hyphen).
 * Creates a fresh one only if none of the variants exist.
 */
async function ensureMake(officialName, parentId, order) {
  // Common aliases admins might have created in earlier seeds
  const aliases = [
    officialName,
    officialName.replace(/-/g, ' '),
    officialName.replace(/-/g, ''),
    officialName.replace(/\s+/g, '-'),
  ];
  for (const candidate of aliases) {
    const found = await Category.findOne({ name: candidate, parent: parentId });
    if (found) return { cat: found, created: false, matchedAs: candidate };
  }
  const cat = await Category.create({
    name: officialName,
    parent: parentId,
    order,
    isActive: true,
  });
  return { cat, created: true, matchedAs: officialName };
}

async function run() {
  if (!env.MONGO_URI) {
    console.error('MONGO_URI missing in .env');
    process.exit(1);
  }
  console.log('Connecting to MongoDB…');
  await mongoose.connect(env.MONGO_URI);

  const shopByBike = await Category.findOne({ name: 'Shop by Bike', parent: null });
  if (!shopByBike) {
    console.error('"Shop by Bike" root category not found — run the main category seeder first.');
    process.exit(1);
  }

  let makesCreated = 0;
  let makesReused = 0;
  let modelsCreated = 0;
  let modelsReused = 0;

  let i = 0;
  for (const [makeName, models] of Object.entries(BIKES)) {
    const { cat: make, created: makeNew, matchedAs } = await ensureMake(makeName, shopByBike._id, i++);
    if (makeNew) makesCreated += 1;
    else makesReused += 1;
    if (!makeNew && matchedAs !== makeName) {
      console.log(`  · ${makeName} — reusing existing "${matchedAs}"`);
    } else {
      console.log(`  · ${makeName} ${makeNew ? '(new)' : '(exists)'}`);
    }

    let j = 0;
    for (const modelName of models) {
      const { created } = await ensureCategory(modelName, make._id, j++);
      if (created) modelsCreated += 1;
      else modelsReused += 1;
    }
  }

  console.log('\nSeed complete.');
  console.log(`Makes: ${makesCreated} created · ${makesReused} reused`);
  console.log(`Models: ${modelsCreated} created · ${modelsReused} reused`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((e) => {
  console.error('Bike seed failed:', e);
  process.exit(1);
});
