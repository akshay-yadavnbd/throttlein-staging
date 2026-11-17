/**
 * Homepage furniture: banners, promo blocks and the two singletons (SEO
 * block, seller CTA). Statements only. Singletons are created on first
 * read so the admin always has something to edit.
 */
const HomeBanner = require('./home-banner.model');
const PromoBlock = require('./promo-block.model');
const HomeSeoBlock = require('./home-seo-block.model');
const SellerCta = require('./seller-cta.model');

const banners = (filter) => HomeBanner.find(filter).sort({ order: 1, createdAt: 1 });
const findBanner = (id) => HomeBanner.findById(id);
const createBanner = (fields) => HomeBanner.create(fields);

const promoBlocks = (filter) => PromoBlock.find(filter).sort({ order: 1, createdAt: 1 });
const promoBlocksAdmin = () => PromoBlock.find({}).sort({ order: 1, _id: 1 });
const findPromoBlock = (id) => PromoBlock.findById(id);
const lastPromoBlock = () => PromoBlock.findOne({}).sort({ order: -1 }).lean();
const createPromoBlock = (fields) => PromoBlock.create(fields);

async function singleton(Model) {
  let doc = await Model.findOne();
  if (!doc) doc = await Model.create({});
  return doc;
}
const homeSeoBlock = () => singleton(HomeSeoBlock);
const sellerCta = () => singleton(SellerCta);

module.exports = {
  banners,
  findBanner,
  createBanner,
  promoBlocks,
  promoBlocksAdmin,
  findPromoBlock,
  lastPromoBlock,
  createPromoBlock,
  homeSeoBlock,
  sellerCta,
};
