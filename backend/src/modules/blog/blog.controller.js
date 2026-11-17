/**
 * Blog HTTP handlers — public (/api/blog) and admin (/api/admin/blog).
 * `resolveSite` sets req.site on both routers; the fallback keeps direct
 * callers (tests, scripts) on the main site.
 */
const asyncHandler = require('express-async-handler');
const upload = require('../../middleware/upload');
const { AppError } = require('../../errors/AppError');
const { normalizeSite } = require('../../config/sites');
const { sendData, sendCreated } = require('../../utils/apiResponse');
const pub = require('./public-blog.service');
const postsService = require('./posts.service');
const taxonomy = require('./taxonomy.service');
const comments = require('./comments.service');

const siteOf = (req) => normalizeSite(req.site);
/** Every handler answers the `{ data, meta }` envelope. The storefront reads the public ones
 *  (/api/blog) through the tolerant `dataOf` / `envelopeOrLegacy` — they render server-side. */
const respond = (fn) => asyncHandler(async (req, res) => sendData(res, await fn(req)));
const respondCreated = (fn) => asyncHandler(async (req, res) => sendCreated(res, await fn(req)));
/** A service page `{ items, page, total, pages }` → `{ data: { items }, meta }`. */
const listing = (fn) =>
  asyncHandler(async (req, res) => {
    const { items, page, total, pages } = await fn(req);
    sendData(res, { items }, 200, {
      page: page ?? Number(req.query.page || 1),
      pageSize: Number(req.query.limit || 25),
      totalItems: total,
      totalPages: pages,
    });
  });

/* ── public ─────────────────────────────────────────────────────────── */
/** GET /api/blog — `{ data: { items }, meta }`; the service's page size rides in meta. */
exports.listPublic = asyncHandler(async (req, res) => {
  const { items, page, limit, total, pages } = await pub.list(siteOf(req), req.query);
  sendData(res, { items }, 200, { page, pageSize: limit, totalItems: total, totalPages: pages });
});
exports.getFeatured = respond((req) => pub.featured(siteOf(req)));
exports.getOnePublic = respond((req) => pub.getOne(siteOf(req), req.params.slug));
exports.listCategoriesPublic = respond((req) => pub.categories(siteOf(req)));
exports.listTagsPublic = respond((req) => pub.tags(siteOf(req)));
exports.listAuthorsPublic = respond(() => pub.authors());
exports.listComments = respond((req) => comments.listPublic(siteOf(req), req.params.slug));
exports.submitComment = respondCreated((req) => comments.submit(siteOf(req), req.params.slug, req.body, req.user));

/* ── admin: posts ───────────────────────────────────────────────────── */
exports.adminList = listing((req) => postsService.list(siteOf(req), req.query));
exports.adminGetOne = respond((req) => postsService.get(siteOf(req), req.params.id));
exports.adminCreate = respondCreated((req) => postsService.create(siteOf(req), req.body, req.user._id));
exports.adminUpdate = respond((req) => postsService.update(siteOf(req), req.params.id, req.body));
exports.adminDelete = respond((req) => postsService.remove(siteOf(req), req.params.id));
// Featured / inline image. A stable proxy URL so embedded images never expire.
exports.adminUploadImage = asyncHandler(async (req, res) => {
  if (!req.file) throw AppError.badRequest('No file uploaded — pass the image under the `image` field.');
  const stored = upload.fileToUrl(req.file);
  sendData(res, { url: stored.startsWith('/') ? stored : `/api/files/${stored}` });
});

/* ── admin: taxonomy ────────────────────────────────────────────────── */
exports.adminListCategories = respond((req) => taxonomy.listCategories(siteOf(req)));
exports.adminCreateCategory = respondCreated((req) => taxonomy.createCategory(siteOf(req), req.body));
exports.adminUpdateCategory = respond((req) => taxonomy.updateCategory(siteOf(req), req.params.id, req.body));
exports.adminDeleteCategory = respond((req) => taxonomy.removeCategory(siteOf(req), req.params.id));
exports.adminListTags = respond((req) => taxonomy.listTags(siteOf(req)));
exports.adminCreateTag = respondCreated((req) => taxonomy.createTag(siteOf(req), req.body));
exports.adminUpdateTag = respond((req) => taxonomy.updateTag(siteOf(req), req.params.id, req.body));
exports.adminDeleteTag = respond((req) => taxonomy.removeTag(siteOf(req), req.params.id));
exports.adminListAuthors = respond((req) => taxonomy.listAuthors(siteOf(req)));
exports.adminGetAuthor = respond((req) => taxonomy.getAuthor(req.params.id));
exports.adminCreateAuthor = respondCreated((req) => taxonomy.createAuthor(req.body));
exports.adminUpdateAuthor = respond((req) => taxonomy.updateAuthor(siteOf(req), req.params.id, req.body));
exports.adminDeleteAuthor = respond((req) => taxonomy.removeAuthor(siteOf(req), req.params.id, req.user.role));

/* ── admin: moderation ──────────────────────────────────────────────── */
exports.adminListComments = listing((req) => comments.adminList(siteOf(req), req.query));
exports.adminUpdateComment = respond((req) =>
  comments.setStatus(siteOf(req), req.params.id, req.body.status, req.user._id),
);
exports.adminDeleteComment = respond((req) => comments.remove(siteOf(req), req.params.id));
