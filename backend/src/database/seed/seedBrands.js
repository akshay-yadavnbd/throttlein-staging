/**
 * Bootstrap the brand catalog on first run.
 *
 * Behaviour:
 *  - If the Brand collection is EMPTY, the full BRANDS list is created.
 *  - If there's already at least one brand, the seeder NO-OPS so that
 *    admin deletions/edits are permanent across restarts.
 *
 * Force a re-seed by setting env var SEED_BRANDS=force.
 */
const Brand = require('../../modules/catalog/brand.model');
const { env } = require('../../config/env');
const { logger } = require('../../utils/logger');

const BRANDS = [
  // ── Helmets ──────────────────────────────────────────────
  'Steelbird',
  'Studds',
  'Vega',
  'MT Helmets',
  'LS2',
  'AGV',
  'Shoei',
  'Arai',
  'Bell Helmets',
  'HJC',
  'Axor',
  'SMK',
  'KYT',
  'Airoh',
  'Stunner',
  'O2 Helmets',

  // ── Riding gear / apparel ────────────────────────────────
  'Rynox',
  'VIATERRA',
  'Royal Enfield',
  'Solace',
  'Aspida',
  'Knox',
  'Spyder',
  'Tarmac',
  'BBG (Biking Brotherhood Gears)',
  'MotoTorque',
  'Asphalt Riding Gears',
  'Decathlon',
  'Cramster',
  'TIIVRA',
  'Liberta',
  'Forma Boots',
  'TCX',
  'Sidi',
  'Alpinestars',

  // ── Bike accessories (crash guards, sliders, mounts, fairings) ──
  'ZANA',
  'Carbonado',
  'Hyperrider',
  'HJG',
  'Mototrance',
  'ENROUTE',
  'Trip Machine',
  'GIVI',
  'SHAD',
  'Puig',
  'R&G Racing',
  'Barkbusters',
  'Madstad',

  // ── Tyres ────────────────────────────────────────────────
  'MRF',
  'Apollo Tyres',
  'Ceat',
  'TVS Eurogrip',
  'Michelin',
  'Pirelli',
  'Metzeler',
  'Bridgestone',
  'Continental',
  'Maxxis',

  // ── Locks ────────────────────────────────────────────────
  'Compass Locks',
  'Godrej',
  'KOVIX',
  'Yulo',

  // ── Lighting ─────────────────────────────────────────────
  'Hella',
  'Philips',
  'Osram',
  'KEEP-ER',

  // ── Mirrors ──────────────────────────────────────────────
  'Rizoma',
  'Magazi',

  // ── Action cameras / GPS / electronics ───────────────────
  'GoPro',
  'DJI',
  'SJCam',
  'Insta360',
  'TomTom',
  'Garmin',

  // ── Communication / Intercom ─────────────────────────────
  'Sena',
  'Cardo',
  'MIDLAND',
  'Interphone',
  'Vimoto',
  'Daytona',
  'FreedConn',

  // ── Phone mounts / chargers ──────────────────────────────
  'Quad Lock',
  'RAM Mount',
  'Tough Mount',

  // ── Performance / Exhaust ────────────────────────────────
  'Akrapovic',
  'SC-Project',
  'Yoshimura',
  'K&N',
  'Red Rooster Performance',
];

async function seedBrands() {
  const existing = await Brand.countDocuments();
  const force = String(env.SEED_BRANDS || '').toLowerCase() === 'force';

  if (existing > 0 && !force) {
    logger.info(`Brands ready (${existing} total) — skipping seed (use SEED_BRANDS=force to repopulate)`);
    return;
  }

  let order = 0;
  for (const name of BRANDS) {
    order++;
    await Brand.create({ name, order, isActive: true });
  }
  const total = await Brand.countDocuments();
  logger.info(`Brands bootstrapped (${total} total)`);
}

module.exports = seedBrands;
