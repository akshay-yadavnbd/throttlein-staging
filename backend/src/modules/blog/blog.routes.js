/**
 * Blog routers.
 *
 *   public  /api/blog         site-scoped reads + comment submission
 *   admin   /api/admin/blog   gated by the SITE-SCOPED blogs permission
 *           (`blogs` on throttlein.com, `seller-blogs` on the seller
 *           property; superadmin always wins). `resolveSite` runs before
 *           the guard so it knows which key to demand (X-Admin-Site from
 *           the admin panel's site switcher).
 *
 * Both are mounted by routes/api.js apart from adminRoutes so the blog
 * guard never fights the general admin guard.
 */
const express = require('express');
const { protect, optionalAuth, requireSitePermission } = require('../../middleware/auth');
const resolveSite = require('../../middleware/resolveSite');
const upload = require('../../middleware/upload');
const trackMediaUpload = require('../../middleware/trackMediaUpload');
const rateLimit = require('../../middleware/rateLimit');
const { validate } = require('../../middleware/validate');
const b = require('./blog.schema');
const c = require('./blog.controller');

/* ── public ─────────────────────────────────────────────────────────── */
const publicRouter = express.Router();
publicRouter.use(resolveSite);
publicRouter.get('/', validate({ query: b.listQuery }), c.listPublic);
publicRouter.get('/featured', c.getFeatured);
publicRouter.get('/categories', c.listCategoriesPublic);
publicRouter.get('/tags', c.listTagsPublic);
publicRouter.get('/authors', c.listAuthorsPublic);
// Guests may comment; signed-in users get attribution through optionalAuth.
publicRouter.get('/:slug/comments', validate({ params: b.slugParams }), c.listComments);
publicRouter.post(
  '/:slug/comments',
  rateLimit({ name: 'blog-comment', max: 10, window: 900 }),
  optionalAuth,
  validate({ params: b.slugParams, body: b.commentBody }),
  c.submitComment,
);
// Single post LAST so /featured, /categories, /tags are never read as slugs.
publicRouter.get('/:slug', validate({ params: b.slugParams }), c.getOnePublic);

/* ── admin ──────────────────────────────────────────────────────────── */
const adminRouter = express.Router();
adminRouter.use(protect, resolveSite, requireSitePermission('blogs'));
const byId = validate({ params: b.objectIdParams });
const edit = validate({ params: b.objectIdParams, body: b.objectBody });

adminRouter.get('/', validate({ query: b.listQuery }), c.adminList);
adminRouter.post('/', validate({ body: b.objectBody }), c.adminCreate);
// Blog assets land in their own `blogs-images/` prefix, apart from logos and banners.
adminRouter.post(
  '/upload-image',
  validate({ body: b.objectBody }),
  upload.setUploadPrefix(() => 'blogs-images'),
  upload.single('image'),
  trackMediaUpload,
  c.adminUploadImage,
);

// Static paths before /:id so none of them is read as a post id.
adminRouter.get('/categories', c.adminListCategories);
adminRouter.post('/categories', validate({ body: b.objectBody }), c.adminCreateCategory);
adminRouter.put('/categories/:id', edit, c.adminUpdateCategory);
adminRouter.delete('/categories/:id', byId, c.adminDeleteCategory);

adminRouter.get('/tags', c.adminListTags);
adminRouter.post('/tags', validate({ body: b.objectBody }), c.adminCreateTag);
adminRouter.put('/tags/:id', edit, c.adminUpdateTag);
adminRouter.delete('/tags/:id', byId, c.adminDeleteTag);

// Authors are a shared roster (no site field); any site's blogs key may pick from it.
adminRouter.get('/authors', c.adminListAuthors);
adminRouter.post('/authors', validate({ body: b.objectBody }), c.adminCreateAuthor);
adminRouter.get('/authors/:id', byId, c.adminGetAuthor);
adminRouter.put('/authors/:id', edit, c.adminUpdateAuthor);
adminRouter.delete('/authors/:id', byId, c.adminDeleteAuthor);

adminRouter.get('/comments', validate({ query: b.commentsQuery }), c.adminListComments);
adminRouter.patch(
  '/comments/:id',
  validate({ params: b.objectIdParams, body: b.moderationBody }),
  c.adminUpdateComment,
);
adminRouter.delete('/comments/:id', byId, c.adminDeleteComment);

adminRouter.get('/:id', validate({ params: b.idOrSlugParams }), c.adminGetOne);
adminRouter.put('/:id', edit, c.adminUpdate);
adminRouter.delete('/:id', byId, c.adminDelete);

module.exports = { public: publicRouter, admin: adminRouter };
