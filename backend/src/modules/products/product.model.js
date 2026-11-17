const mongoose = require('mongoose');
const { GST_RATES, DEFAULT_GST_RATE } = require('../../utils/gst');
const { MAX_PRICE, MAX_PRICE_LABEL } = require('./price-limit');

const productSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    // URL slug. Auto-derived from `name` on save and kept unique across the
    // collection via the pre-save hook below - collisions resolve to -2, -3.
    slug: { type: String, trim: true, lowercase: true, index: true, sparse: true, unique: true },

    // Product category - points to a node in the Category collection
    // (under any top-level except "Shop by Bike").
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
      index: true,
    },

    // Optional: the bike (or bike make) this product is designed for.
    // Must be a node within the "Shop by Bike" subtree.
    bike: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
      index: true,
    },

    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      default: null,
      index: true,
    },
    description: { type: String, default: '' },

    price: { type: Number, required: true, min: 0, max: [MAX_PRICE, `Price can be at most ${MAX_PRICE_LABEL}.`] },
    mrp: { type: Number, min: 0, max: [MAX_PRICE, `MRP can be at most ${MAX_PRICE_LABEL}.`] },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    stock: { type: Number, default: 0, min: 0 },

    images: [{ type: String }],
    // Optional color name whose first color-specific photo represents this
    // product in listing cards. Empty = use main gallery first, then first
    // color gallery with photos.
    listingColor: { type: String, trim: true, default: '' },
    sku: { type: String, trim: true },
    color: { type: String, trim: true },
    sizes: { type: [String], default: [] },
    // Physical weight + box dimensions used for Shiprocket rate quotes
    // and label printing. Weight is enforced required at the controller
    // layer (schema allows nullish so admin backfills can proceed); the
    // three dimensions have a small sensible default (a folded-glove
    // parcel) but sellers are expected to override for accurate volumetric
    // pricing on bulky items like jackets and helmets.
    weightGrams: { type: Number, min: 0 },
    lengthCm: { type: Number, min: 0, default: 15 },
    breadthCm: { type: Number, min: 0, default: 15 },
    heightCm: { type: Number, min: 0, default: 10 },
    // GST slab the (tax-inclusive) price carries, and the HSN code printed
    // on tax invoices. Frozen onto each order line at purchase — see utils/gst.js.
    gstRate: { type: Number, enum: GST_RATES, default: DEFAULT_GST_RATE },
    hsn: { type: String, trim: true, default: '', match: [/^(|\d{4}|\d{6}|\d{8})$/, 'HSN must be 4, 6 or 8 digits'] },

    // Per-(size, color) variant stock - Phase 1 variants matrix.
    // When non-empty the controller recomputes top-level `stock` as
    // the sum of variant stocks so existing storefront filters keep
    // working. Leave empty for classic single-SKU behaviour.
    variants: {
      type: [
        {
          size: { type: String, trim: true, default: '' },
          color: { type: String, trim: true, default: '' },
          stock: { type: Number, default: 0, min: 0 },
          sku: { type: String, trim: true, default: '' },
          // Optional per-variant price override. null = this variant
          // sells at product's top-level base price.
          price: {
            type: Number,
            default: null,
            min: 0,
            max: [MAX_PRICE, `Variant price can be at most ${MAX_PRICE_LABEL}.`],
          },
          mrp: {
            type: Number,
            default: null,
            min: 0,
            max: [MAX_PRICE, `Variant MRP can be at most ${MAX_PRICE_LABEL}.`],
          },
        },
      ],
      default: [],
    },

    // Per-color image galleries - optional. Each entry pins images to
    // one of the colors named in variants[].color. Colors with no
    // entry fall back to the main `images` list.
    colorImages: {
      type: [
        {
          color: { type: String, trim: true, default: '' },
          images: { type: [String], default: [] },
        },
      ],
      default: [],
    },

    status: {
      type: String,
      enum: ['draft', 'active', 'rejected', 'out_of_stock'],
      default: 'active',
    },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewsCount: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },

    // Location tags - slugified, lowercase. Drives location-page filters.
    cities: {
      type: [{ type: String, lowercase: true, trim: true }],
      default: [],
      index: true,
    },
    states: {
      type: [{ type: String, lowercase: true, trim: true }],
      default: [],
      index: true,
    },
    country: {
      type: String,
      lowercase: true,
      trim: true,
      default: '',
      index: true,
    },

    // SEO overrides - optional per-product values that, when set, win
    // over the auto-generated title/description/image in the
    // storefront's generateMetadata.
    seoTitle: { type: String, default: '', trim: true, maxlength: 100 },
    seoDescription: { type: String, default: '', trim: true, maxlength: 200 },
    ogImage: { type: String, default: '', trim: true },

    // Size chart image - optional single image showing measurements /
    // fit guidance. Displayed on the storefront next to the size
    // selector so shoppers can pick the right size before buying.
    sizeChartImage: { type: String, default: '', trim: true },

    // A+ Content Images - optional Amazon-style marketing images
    // rendered on the storefront PDP below the "Customers also viewed"
    // rail. Up to 3 slots: [0]=top-left, [1]=top-right, [2]=bottom-wide
    // banner. Empty strings mark unused slots so the array shape stays
    // stable (length 3) and slot positions map cleanly on the client.
    aPlusImages: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => !Array.isArray(arr) || arr.length <= 3,
        message: 'aPlusImages accepts at most 3 entries.',
      },
    },

    // Return / exchange overrides - optional per-product overrides
    // for the seller's profile defaults. When null the storefront
    // falls back to the seller profile. Set to 0 to explicitly
    // disable returns/exchanges for this product.
    returnPolicyDays: { type: Number, default: null, min: 0, max: 365 },
    exchangePolicyDays: { type: Number, default: null, min: 0, max: 365 },

    // Per-product COD override. Even if the seller has COD enabled
    // globally (User.codEnabled), setting this to false restricts
    // this product to online payment only.
    codAvailable: { type: Boolean, default: true },
  },
  { timestamps: true },
);

function slugifyBase(input) {
  return (
    String(input || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'product'
  );
}

// LAST-LINE-OF-DEFENSE guardrail: catches ANY save() that would drop
// `images` from N>0 to 0. Runs regardless of which controller kicked
// off the save (updateProduct, importBulk, seed script, one-off REPL
// session, cron job - all of them). If the caller genuinely wants to
// wipe the array, they must set `doc.$locals.imagesWipeAcknowledged =
// true` immediately before `save()`. Every other empty assignment gets
// silently reverted and logged so we can trace who tried.
//
// Rationale: sellers have repeatedly seen their product photos vanish
// after routine edits. Adding this at the schema level means the
// invariant "images can only shrink to 0 with explicit consent" is
// enforced no matter what code path is misbehaving.
productSchema.pre('save', async function guardImagesWipe() {
  if (this.isNew) return;
  // ALWAYS snapshot the prior images for the post-save damage-assessment
  // hook — even in the happy path — so that if some code path bypasses
  // this pre-save layer (e.g. via updateOne that later triggers a save
  // through hooks, or a mongoose internal quirk) the post-save layer
  // still knows what to restore.
  try {
    const priorSnap = await this.$model().findById(this._id).select('images').lean();
    this.$locals = this.$locals || {};
    this.$locals._preSaveImageSnapshot = Array.isArray(priorSnap?.images) ? [...priorSnap.images] : [];
  } catch {
    /* if the lookup fails, damage assessment will re-query on its own */
  }
  const nextImages = Array.isArray(this.images) ? this.images : [];
  if (nextImages.length > 0) return; // Nothing to guard against.
  const acknowledged = !!(this.$locals && this.$locals.imagesWipeAcknowledged);
  if (acknowledged) return;
  const priorList = this.$locals?._preSaveImageSnapshot;
  if (Array.isArray(priorList) && priorList.length > 0) {
    logger.warn(
      '%s',
      `[product-schema] guardImagesWipe: refused to clear ${priorList.length} image(s) on product ${this._id}. ` +
        `Caller did not set doc.$locals.imagesWipeAcknowledged = true. ` +
        `Stack: ${new Error().stack.split('\n').slice(2, 6).join(' | ')}`,
    );
    this.images = priorList;
  }
});

productSchema.pre('save', async function () {
  const needsSlug = this.isModified('name') || !this.slug;
  if (needsSlug) {
    const base = slugifyBase(this.name);
    let candidate = base;
    let n = 1;
    while (await this.$model().exists({ slug: candidate, _id: { $ne: this._id } })) {
      n += 1;
      candidate = `${base}-${n}`;
      if (n > 50) {
        candidate = `${base}-${Date.now().toString(36)}`;
        break;
      }
    }
    this.slug = candidate;
  }
  if (this.mrp && this.price && this.mrp > this.price) {
    this.discountPercent = Math.round(((this.mrp - this.price) / this.mrp) * 100);
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST-SAVE DAMAGE ASSESSMENT — belt AND suspenders on top of
// guardImagesWipe. If somehow images landed in the DB as [] AFTER a
// save (e.g. a bug in the pre-save chain), this hook re-writes the
// prior images via a raw updateOne and logs a loud incident line.
// Direct-write bypasses (updateOne / findOneAndUpdate on the query
// path) still won't trigger this — they don't fire save hooks at all
// — but any doc.save() path is covered.
productSchema.post('save', async function damageAssessment() {
  try {
    if (this.$locals && this.$locals.imagesWipeAcknowledged) return;
    const nowImages = Array.isArray(this.images) ? this.images : [];
    if (nowImages.length > 0) return;
    const priorList =
      this.$locals && Array.isArray(this.$locals._preSaveImageSnapshot) ? this.$locals._preSaveImageSnapshot : null;
    if (!priorList || priorList.length === 0) return;
    await this.$model().updateOne({ _id: this._id }, { $set: { images: priorList } });
    logger.error(
      '%s',
      `[product-schema] damageAssessment: RE-WROTE ${priorList.length} image(s) that a save() had wiped on product ${this._id}. ` +
        `Pre-save guard was bypassed somehow. Stack: ${new Error().stack.split('\n').slice(2, 6).join(' | ')}`,
    );
  } catch (err) {
    logger.warn(`[product-schema] damageAssessment: rollback failed for ${this._id}: ${err.message}`);
  }
});

productSchema.index({ name: 'text', description: 'text' });

// Auto-cleanup S3 objects when image fields are replaced or the doc
// is deleted. See utils/imageCleanup.js for the diff-and-delete logic.
const { attachImageCleanup } = require('../../utils/imageCleanup');
attachImageCleanup(productSchema, [
  { path: 'images', isArray: true },
  { path: 'ogImage' },
  { path: 'sizeChartImage' },
  { path: 'aPlusImages', isArray: true },
  { path: 'description', isHtml: true },
  { path: 'colorImages', isDocArray: true, itemPath: 'images' },
]);

// Email everyone on the "notify me when back in stock" list the moment
// `stock` crosses 0 → >0, regardless of which code path wrote it. See
// utils/notifyRestock.js.
const { attachRestockNotify } = require('../../utils/notifyRestock');
const { logger } = require('../../utils/logger');
attachRestockNotify(productSchema);

module.exports = mongoose.model('Product', productSchema);
