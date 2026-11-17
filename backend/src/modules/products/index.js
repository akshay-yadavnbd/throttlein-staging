/**
 * Products module — public surface.
 *
 *   routes      products.routes.js        /api/products
 *   controllers storefront / seller-catalog / seller-media / import-export
 *   services    storefront, search, catalog-tree, catalog, product-images, media, export, import
 *   pure        product-input (form parsers), listing-image, csv-format
 *   data        products.repository (Product), catalog.repository (Category, Brand, User reads)
 */
const storefront = require('./storefront.controller');
const seller = require('./seller-catalog.controller');
const media = require('./seller-media.controller');
const sheets = require('./import-export.controller');
const { withListingImage, listingImageFor } = require('./listing-image');

module.exports = {
  ...storefront,
  ...seller,
  ...media,
  ...sheets,
  // Shared helpers other code may use
  withListingImage,
  listingImageFor,
  routes: require('./products.routes'),
};
