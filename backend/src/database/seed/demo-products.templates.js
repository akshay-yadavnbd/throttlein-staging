/** Per-category product templates for seedDemoProducts.js. */
/**
 * Templates keyed by a coarse category bucket. The matcher list tries
 * substrings of the actual Mongo category name (case-insensitive), so
 * adding new categories to the DB doesn't require updating this file
 * unless you want a more specific template than the default.
 */
const TEMPLATES = {
  helmet: {
    matchers: ['helmet'],
    nameTemplates: [
      '%adj Race Helmet',
      '%adj Touring Modular Helmet',
      '%adj Full-Face Helmet',
      '%adj Adventure Helmet',
      '%adj Urban Open-Face',
      '%adj Sport Helmet',
    ],
    priceRange: [3500, 22000],
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    features: [
      'Removable, washable inner liner',
      'Pinlock-ready visor',
      'Optimised airflow vents',
      'Carbon-fibre top shell',
      'Drop-down sun visor',
      'Bluetooth-ready ear pockets',
      'DOT and ECE 22.06 certified',
      'Quick-release Double-D ring strap',
    ],
  },
  jacket: {
    matchers: ['jacket'],
    nameTemplates: [
      '%adj Riding Jacket',
      '%adj Adventure Jacket',
      '%adj Touring Jacket',
      '%adj Mesh Riding Jacket',
      '%adj All-Season Jacket',
    ],
    priceRange: [4500, 25000],
    sizes: ['S', 'M', 'L', 'XL', 'XXL', '3XL'],
    features: [
      'CE Level 2 armour at shoulders, elbows and back',
      'Waterproof / breathable membrane',
      'Reflective panels for night visibility',
      'YKK zippers throughout',
      'Removable thermal liner',
      'Air-flow mesh chest and back vents',
      'Adjustable cuffs and waist',
    ],
  },
  boots: {
    matchers: ['boot', 'footwear', 'shoe'],
    nameTemplates: ['%adj Riding Boots', '%adj Touring Boots', '%adj Adventure Boots', '%adj Sport Boots'],
    priceRange: [3000, 15000],
    sizes: ['7', '8', '9', '10', '11', '12'],
    features: [
      'Microfiber upper',
      'Reinforced toe and heel',
      'Anti-slip sole',
      'Water-resistant membrane',
      'Ankle protector',
    ],
  },
  pants: {
    matchers: ['pant', 'trouser'],
    nameTemplates: ['%adj Riding Pants', '%adj Adventure Pants', '%adj Mesh Riding Pants'],
    priceRange: [3000, 14000],
    sizes: ['28', '30', '32', '34', '36', '38'],
    features: [
      'Hip and knee armour pockets',
      'Multiple stretch panels',
      'Waterproof outer shell',
      'Reflective leg stripes',
    ],
  },
  gloves: {
    matchers: ['glove'],
    nameTemplates: ['%adj Riding Gloves', '%adj Summer Gloves', '%adj Touring Gloves'],
    priceRange: [800, 6500],
    sizes: ['S', 'M', 'L', 'XL'],
    features: ['Knuckle protector', 'Touchscreen-friendly index finger', 'Goat-leather palm', 'Padded palm slider'],
  },
  light: {
    matchers: ['light', 'lamp', 'led'],
    nameTemplates: ['%adj Auxiliary Light Pair', '%adj LED Spot', '%adj Crash-guard Light'],
    priceRange: [1500, 9500],
    sizes: [],
    features: ['Cree LED chip', 'Anodised aluminium housing', 'Universal 12V fit', 'IP67 weather sealing'],
  },
  mount: {
    matchers: ['mount', 'holder', 'grip'],
    nameTemplates: ['%adj Phone Mount', '%adj Action-cam Mount', '%adj Handlebar Mount'],
    priceRange: [400, 3500],
    sizes: [],
    features: [
      'Universal handlebar clamp',
      'Vibration-isolation gel core',
      'Quick-release lock',
      'Anti-theft locking pin',
    ],
  },
  bag: {
    matchers: ['bag', 'luggage', 'pannier'],
    nameTemplates: ['%adj Saddle Bag', '%adj Tank Bag', '%adj Tail Bag', '%adj Pannier'],
    priceRange: [2000, 14000],
    sizes: [],
    features: [
      'Heavy-duty waterproof tarpaulin',
      'Reflective piping for visibility',
      'Expandable storage compartment',
      'Magnetic / strap mount',
    ],
  },
  default: {
    matchers: [],
    nameTemplates: ['%adj Accessory', '%adj Rider Kit', '%adj Universal Add-on'],
    priceRange: [500, 5000],
    sizes: [],
    features: ['Premium-grade build', 'Universal fit', 'Designed for Indian conditions'],
  },
};

module.exports = { TEMPLATES };
