/** Demo sellers, customers and product templates for `npm run seed:demo` (seedDemoData.js). */
/* ─────────────────────────────────────────────────────────────────────── */
/* Seed data                                                               */
/* ─────────────────────────────────────────────────────────────────────── */

const DEMO_SELLERS = [
  {
    name: 'Aarav Sharma',
    storeName: 'MotoForge Customs',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
    gstin: '27ABCDE1234F1Z5',
    pan: 'ABCDE1234F',
  },
  {
    name: 'Riya Verma',
    storeName: 'Throttle Therapy',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
    gstin: '29BCDEF2345G2A6',
    pan: 'BCDEF2345G',
  },
  {
    name: 'Karan Mehta',
    storeName: 'Rev Bros Gear',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
    gstin: '27CDEFG3456H3B7',
    pan: 'CDEFG3456H',
  },
  {
    name: 'Priya Iyer',
    storeName: 'Helmetry',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600001',
    gstin: '33DEFGH4567I4C8',
    pan: 'DEFGH4567I',
  },
  {
    name: 'Vikas Singh',
    storeName: 'Tarmac Tribe',
    city: 'Delhi',
    state: 'Delhi',
    pincode: '110001',
    gstin: '07EFGHI5678J5D9',
    pan: 'EFGHI5678J',
  },
  {
    name: 'Ananya Reddy',
    storeName: 'Adrenaline Outfitters',
    city: 'Hyderabad',
    state: 'Telangana',
    pincode: '500001',
    gstin: '36FGHIJ6789K6E0',
    pan: 'FGHIJ6789K',
  },
  {
    name: 'Rohit Nair',
    storeName: 'Pillion Pro',
    city: 'Kochi',
    state: 'Kerala',
    pincode: '682001',
    gstin: '32GHIJK7890L7F1',
    pan: 'GHIJK7890L',
  },
  {
    name: 'Sneha Kapoor',
    storeName: 'TwoWheel Trove',
    city: 'Jaipur',
    state: 'Rajasthan',
    pincode: '302001',
    gstin: '08HIJKL8901M8G2',
    pan: 'HIJKL8901M',
  },
  {
    name: 'Arjun Patel',
    storeName: 'Garage Goods Co.',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pincode: '380001',
    gstin: '24IJKLM9012N9H3',
    pan: 'IJKLM9012N',
  },
  {
    name: 'Neha Joshi',
    storeName: 'Apex Riders Hub',
    city: 'Kolkata',
    state: 'West Bengal',
    pincode: '700001',
    gstin: '19JKLMN0123O1I4',
    pan: 'JKLMN0123O',
  },
];

const DEMO_CUSTOMERS = [
  { name: 'Aditya Khanna', city: 'Gurugram', state: 'Haryana', pincode: '122001' },
  { name: 'Meera Shah', city: 'Pune', state: 'Maharashtra', pincode: '411014' },
  { name: 'Rahul Banerjee', city: 'Kolkata', state: 'West Bengal', pincode: '700064' },
  { name: 'Divya Pillai', city: 'Bengaluru', state: 'Karnataka', pincode: '560078' },
  { name: 'Sanjay Rao', city: 'Chennai', state: 'Tamil Nadu', pincode: '600040' },
  { name: 'Pooja Malhotra', city: 'Noida', state: 'Uttar Pradesh', pincode: '201301' },
  { name: 'Ishaan Bhatia', city: 'Hyderabad', state: 'Telangana', pincode: '500032' },
  { name: 'Tanvi Desai', city: 'Mumbai', state: 'Maharashtra', pincode: '400072' },
  { name: 'Aman Gupta', city: 'Delhi', state: 'Delhi', pincode: '110092' },
  { name: 'Kavya Menon', city: 'Coimbatore', state: 'Tamil Nadu', pincode: '641001' },
];

/** Product templates — seller's name gets prefixed when seeded so slugs stay unique. */
const PRODUCT_TEMPLATES = [
  { cat: 'Jackets', brand: 'Rynox', basePrice: 14999, mrp: 17999, weight: 2000, sizes: ['S', 'M', 'L', 'XL'] },
  { cat: 'Pants', brand: 'Spyder', basePrice: 7499, mrp: 8999, weight: 1100, sizes: ['30', '32', '34', '36'] },
  { cat: 'Boots', brand: 'TCX', basePrice: 16999, mrp: 19999, weight: 1900, sizes: ['8', '9', '10', '11'] },
  { cat: 'Gloves', brand: 'Knox', basePrice: 8999, mrp: 10499, weight: 320, sizes: ['M', 'L', 'XL'] },
  { cat: 'Auxiliary Light', brand: 'Hella', basePrice: 9999, mrp: 12499, weight: 1100, sizes: [] },
  { cat: 'Mounts and Chargers', brand: 'Quad Lock', basePrice: 3299, mrp: 3799, weight: 220, sizes: [] },
  { cat: 'Aluminium Top Cases and Panniers', brand: 'GIVI', basePrice: 25999, mrp: 28999, weight: 5400, sizes: [] },
  { cat: 'Jackets', brand: 'Rynox', basePrice: 11499, mrp: 13999, weight: 1700, sizes: ['M', 'L', 'XL'] },
  { cat: 'Gloves', brand: 'Knox', basePrice: 5499, mrp: 6499, weight: 250, sizes: ['M', 'L', 'XL'] },
  { cat: 'Mounts and Chargers', brand: 'Quad Lock', basePrice: 4599, mrp: 5199, weight: 280, sizes: [] },
];

module.exports = { DEMO_SELLERS, DEMO_CUSTOMERS, PRODUCT_TEMPLATES };
