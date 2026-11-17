/**
 * Bootstrap the category tree on first run.
 *
 * Behaviour:
 *  - If the Category collection is EMPTY, the full TREE is created. This is
 *    the first-time bootstrap so the admin starts with a useful taxonomy.
 *  - If there's already at least one category, the seeder NO-OPS so that
 *    admin deletions/edits are permanent across restarts.
 *
 * Force a re-seed by setting env var SEED_CATEGORIES=force (e.g. to repopulate
 * after wiping the collection in dev).
 */
const Category = require('../../modules/catalog/category.model');
const { env } = require('../../config/env');
const { logger } = require('../../utils/logger');

/**
 * Tree definition — a node is either:
 *   - a string (leaf category name)
 *   - an object { name, children?: Node[] }
 *
 * Sourced from bandidospitstop.com navigation (May 2026).
 */
const TREE = [
  {
    name: 'Shop by Bike',
    children: [
      {
        name: 'Royal Enfield',
        children: [
          'Classic 650',
          'Bear 650',
          'Guerrilla 450',
          'Himalayan 450',
          'Super Meteor 650',
          'Hunter 350',
          'Himalayan',
          'Classic 350 Reborn',
          'Meteor 350',
          'Classic',
          'Standard',
          'Electra',
          'Interceptor',
          'Thunderbird',
          'Thunderbird X',
          'Continental GT',
          'Scram',
        ],
      },
      {
        name: 'Yamaha',
        children: ['XSR 155', 'RX 100', 'Aerox 155', 'MT 15', 'R3', 'R15 V1', 'R15 V2', 'R15 V3', 'R15 V4', 'R1'],
      },
      {
        name: 'KTM',
        children: [
          '390 Enduro R',
          'Adventure 890',
          'Adventure 390 2025',
          'Adventure 390',
          'Duke 125',
          'Duke 200',
          'Duke 250 BS6',
          'Duke 250',
          'Duke 390',
          'RC 390',
        ],
      },
      {
        name: 'Bajaj',
        children: ['NS400Z', 'Pulsar 220', 'Pulsar NS 200', 'Pulsar RS 200', 'Dominar 400', 'Pulsar 150', 'Pulsar 180'],
      },
      {
        name: 'Honda',
        children: [
          'XL750 Transalp',
          'NX500',
          'CB 200X',
          'Hness CB 350',
          'Hornet 160R',
          'CBR 250 R',
          'CB 300',
          'CB 350 RS',
          'CB 500X',
          'NX400',
          'CB650R',
          'CBR 650R',
          'CBR 1000RR',
        ],
      },
      {
        name: 'Suzuki',
        children: ['Gixxer', 'Gixxer SF', 'V Strom 250', 'Hayabusa', 'GSX-S750', 'V Strom 800DE', 'V Strom DL650'],
      },
      { name: 'Hero', children: ['Xpulse 210', 'Mavrick 440', 'Xpulse 200', 'Impulse'] },
      { name: 'BMW', children: ['F 900 GS', 'G 310GS', 'G 310R', 'R 1300 GS', 'S1000R', 'S 1000 RR', 'R1200GS'] },
      {
        name: 'Kawasaki',
        children: ['Versys 650', 'Ninja 300', 'Z 900', 'Versys 1000', 'Ninja 400', 'Ninja ZX-10R', 'Ninja ZX6R'],
      },
      { name: 'Triumph', children: ['Scrambler 400 X', 'Speed 400', 'Tiger Sport 660', 'Tiger', 'Trident 660'] },
      { name: 'TVS', children: ['Apache RTX 300', 'TVS Ronin', 'Apache 200', 'Apache RTR 160', 'Apache RTR 310'] },
      { name: 'Ather', children: ['Ather 450 X'] },
      { name: 'Ola' },
      { name: 'Harley Davidson', children: ['Harley 440X'] },
      { name: 'Benelli', children: ['Benelli 600', 'TRK 502'] },
      { name: 'Ducati', children: ['Panigale V4'] },
      { name: 'Aprilia', children: ['RS660'] },
    ],
  },

  { name: 'Super Bikes' },

  {
    name: 'Motorcycle Accessories',
    children: [
      {
        name: 'Bike Protection',
        children: [
          'Lock System',
          'Crash Guard',
          'Frame Slider',
          'Fluid Guards and Cap',
          'Master Cylinder Guard',
          'Engine Guard and Skid Plate',
          'Headlight Grill',
          'Radiator Grill',
          'Tank Protectors',
          'Body Cover',
          'Screen Protectors',
          'Stand and Extenders',
          'Chain Cover and Sprocket',
          'Boot Guards',
        ],
      },
      {
        name: 'Handlebar and Accessories',
        children: [
          'Grips and Throttles',
          'Hand Guard',
          'Handle Bars',
          'Handle Riser',
          'Lever Guards',
          'Mirror',
          'Mounts and Chargers',
          'Handle Accessories',
        ],
      },
      {
        name: 'Lighting',
        children: [
          'Tail Light',
          'Auxiliary Light',
          'Light Accessories',
          'Indicator',
          'Headlight',
          'Hazard Module',
          'Fancy LED Light',
        ],
      },
      {
        name: 'Performance Accessories',
        children: ['Air Filter', 'Exhaust', 'Performance', 'Exhaust Accessories', 'Racing Spare Parts Accessories'],
      },
      { name: 'Body Fairing and Fenders', children: ['Body Fairing', 'Fenders and Extenders', 'Tail Tidy'] },
      { name: 'Bike Essentials', children: ['Windshield', 'Winglet', 'Seat'] },
      { name: 'Foot Controls', children: ['Foot Pegs and Mounts'] },
      { name: 'Cleaning Accessories' },
      { name: 'Wheel Accessories', children: ['Wheel Cover'] },
    ],
  },

  {
    name: 'Riding Gears',
    children: [
      {
        name: 'Rider Protection',
        children: ['Jackets', 'Gloves', 'Pants', 'Boots', 'Knee and Elbow Guards', 'Shoe Protector'],
      },
      { name: 'Casuals', children: ['Face Mask and Balaclava', 'Rain Coats'] },
    ],
  },

  {
    name: 'Luggage & Touring',
    children: [
      { name: 'Bags and Backpacks', children: ['Backpack', 'Saddle Bag', 'Tank Bag', 'Tail Bag'] },
      {
        name: 'Luggage Accessories',
        children: ['Aluminium Top Cases and Panniers', 'Plastic Top Case and Panniers', 'Panniers'],
      },
      { name: 'Carriers and Backrest', children: ['Carriers and Back Rack', 'Back Rest'] },
      { name: 'Touring Accessories', children: ['Saddle Stay', 'Jerry Can and Mounts', 'Bungee Cords and Nets'] },
    ],
  },

  {
    name: 'Helmets and Accessories',
    children: [
      { name: 'Full Face Helmet' },
      { name: 'Half Face Helmet' },
      { name: 'Offroad Helmets' },
      { name: 'Accessories', children: ['Goggles', 'Helmet Accessories'] },
      { name: 'Rider Tech', children: ['Action Camera and Accessories', 'Communication', 'Navigation System'] },
    ],
  },

  { name: 'Combos' },
  { name: 'Garage Sale' },
];

async function seedNode(node, parent = null, order = 0) {
  const name = typeof node === 'string' ? node : node.name;
  let cat = await Category.findOne({ name, parent });
  if (!cat) {
    cat = await Category.create({
      name,
      parent,
      order,
      isActive: true,
    });
  }
  if (typeof node === 'object' && Array.isArray(node.children)) {
    let i = 0;
    for (const child of node.children) {
      await seedNode(child, cat._id, i++);
    }
  }
  return cat;
}

async function seedCategories() {
  const existing = await Category.countDocuments();
  const force = String(env.SEED_CATEGORIES || '').toLowerCase() === 'force';

  if (existing > 0 && !force) {
    logger.info(`Categories ready (${existing} total) — skipping seed (use SEED_CATEGORIES=force to repopulate)`);
    return;
  }

  let i = 0;
  for (const root of TREE) {
    await seedNode(root, null, i++);
  }
  const total = await Category.countDocuments();
  logger.info(`Categories bootstrapped (${total} total)`);
}

module.exports = seedCategories;
