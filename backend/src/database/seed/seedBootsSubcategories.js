/**
 * One-shot seed that adds the boots subtypes under the nested
 * "Boots" category. The category lives three levels deep:
 *
 *   Riding Gears (top-level)
 *   └── Rider Protection
 *       └── Boots
 *           ├── Boot Covers         ← seeded by this script
 *           ├── Short Boots         ← seeded by this script
 *           ├── Tall Boots          ← seeded by this script
 *           ├── Waterproof Boots    ← seeded by this script
 *           └── Socks               ← seeded by this script
 *
 * Idempotent: re-running the script is a no-op for categories that
 * already exist (looks them up by name under the same parent). New
 * categories are created with `isActive: true` and a sensible `order`
 * so they show up in the admin list immediately.
 *
 * Usage:
 *   node src/utils/seedBootsSubcategories.js
 *
 * Or via npm:
 *   npm run seed:boots-subs
 */

require('../../config/loadEnv');
const mongoose = require('mongoose');
const Category = require('../../modules/catalog/category.model');
const { env } = require('../../config/env');

// Full ancestor chain so the script doesn't accidentally pick a stray
// "Boots" elsewhere in the tree. Walks: top-level → child → child.
const PARENT_CHAIN = ['Riding Gears', 'Rider Protection', 'Boots'];

const SUBCATEGORIES = ['Boot Covers', 'Short Boots', 'Tall Boots', 'Waterproof Boots', 'Socks'];

async function run() {
  const mongoUri = env.MONGODB_URI || env.MONGO_URI;
  if (!mongoUri) {
    console.error('Missing MONGODB_URI (or MONGO_URI) in .env');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);

  // Walk the parent chain step-by-step so any missing ancestor produces
  // a clear, actionable error pointing to the exact level that's gone.
  let parent = null;
  for (let i = 0; i < PARENT_CHAIN.length; i++) {
    const name = PARENT_CHAIN[i];
    const filter = i === 0 ? { name, parent: null } : { name, parent: parent._id };
    const found = await Category.findOne(filter);
    if (!found) {
      console.error(
        `Could not find "${name}" under ${
          i === 0 ? 'the top level' : `"${PARENT_CHAIN[i - 1]}"`
        }. Create it via the admin Categories page first.`,
      );
      await mongoose.disconnect();
      process.exit(1);
    }
    parent = found;
  }

  console.log(`Seeding ${SUBCATEGORIES.length} subcategories under "${parent.name}".\n`);

  // Find the current max order under this parent so we can append the
  // new entries at the end without disturbing the existing sort.
  const existingChildren = await Category.find({ parent: parent._id }).sort({ order: -1 });
  let nextOrder = existingChildren.length > 0 ? (existingChildren[0].order || 0) + 1 : 0;

  let created = 0;
  let existed = 0;
  for (const name of SUBCATEGORIES) {
    const found = await Category.findOne({ name, parent: parent._id });
    if (found) {
      console.log(` -  ${name.padEnd(22)} already exists — skipping`);
      existed++;
      continue;
    }
    await Category.create({
      name,
      parent: parent._id,
      isActive: true,
      order: nextOrder++,
    });
    console.log(` ✓  ${name.padEnd(22)} created`);
    created++;
  }

  console.log(`\nDone. ${created} created, ${existed} already existed.`);
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
