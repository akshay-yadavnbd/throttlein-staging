/**
 * Catalogue module routers.
 *
 *   categories      /api/categories (public tree; admin writes need the `categories` permission)
 *   brands          /api/brands (public list; admin writes need the `brands` permission)
 *   reviews         /api/reviews (signed-in customers)
 *   sellerRequests  mounted inside routes/sellerOrderRoutes.js (/api/seller), after its
 *                   protect + requireRole('seller', 'superadmin') guard
 *   adminRequests   mounted inside routes/adminRoutes.js (/api/admin), after its staff
 *                   guard; every route needs the `brand-requests` permission
 *
 * The public product-review list stays on /api/products/:slug/reviews (products.routes.js
 * mounts `productReviews` from this module's index).
 */
const express = require('express');
const { protect, requirePermission } = require('../../middleware/auth');
const upload = require('../../middleware/upload');
const { validate } = require('../../middleware/validate');
const G = require('../../validation/generic');
const s = require('./catalog.schema');
const c = require('./catalog.controller');

const id = validate({ params: G.params({ id: 'objectId' }) });
const edit = validate({ params: G.params({ id: 'objectId' }), body: G.objectBody });
const body = validate({ body: G.objectBody });
const list = validate({ query: G.listQuery });

const categories = express.Router();
const categoryStaff = [protect, requirePermission('categories')];
categories.get('/', list, c.categoryTree);
categories.get('/admin', ...categoryStaff, list, c.categoryAdminList);
categories.post('/upload-icon', ...categoryStaff, body, ...c.uploadCategoryIcon);
categories.post('/', ...categoryStaff, body, c.createCategory);
categories.put('/:id', ...categoryStaff, edit, c.updateCategory);
categories.delete('/:id', ...categoryStaff, id, c.removeCategory);

const brands = express.Router();
const brandStaff = [protect, requirePermission('brands')];
brands.get('/', list, c.listBrands);
brands.post('/upload-logo', ...brandStaff, body, ...c.uploadBrandLogo);
brands.post('/', ...brandStaff, body, c.createBrand);
brands.put('/:id', ...brandStaff, edit, c.updateBrand);
brands.delete('/:id', ...brandStaff, id, c.removeBrand);

const reviews = express.Router();
reviews.post('/', protect, validate({ body: s.reviewUpsert }), c.upsertReview);
reviews.get('/mine', protect, list, c.myReviewsForOrder);
reviews.get('/eligibility', protect, list, c.reviewEligibility);
reviews.delete('/:productId', protect, validate({ params: G.params({ productId: 'objectId' }) }), c.deleteReview);
reviews.post('/uploads/images', protect, upload.array('images', 6), body, c.uploadReviewImages);

// Edit and withdraw are limited by the service to pending rows the caller owns,
// so decided requests stay intact as the audit trail.
const sellerRequests = express.Router();
sellerRequests.post('/brand-category-requests', body, c.submitRequest);
sellerRequests.get('/brand-category-requests', list, c.listOwnRequests);
sellerRequests.patch('/brand-category-requests/:id', edit, c.editOwnRequest);
sellerRequests.delete('/brand-category-requests/:id', id, c.withdrawOwnRequest);

const adminRequests = express.Router();
const reviewer = requirePermission('brand-requests');
adminRequests.get('/brand-category-requests', reviewer, list, c.adminListRequests);
adminRequests.get('/brand-category-requests/:id', reviewer, id, c.adminGetRequest);
adminRequests.post('/brand-category-requests/:id/approve', reviewer, edit, c.approveRequest);
adminRequests.post('/brand-category-requests/:id/reject', reviewer, edit, c.rejectRequest);
adminRequests.delete('/brand-category-requests/:id', reviewer, id, c.adminDeleteRequest);

module.exports = { categories, brands, reviews, sellerRequests, adminRequests };
