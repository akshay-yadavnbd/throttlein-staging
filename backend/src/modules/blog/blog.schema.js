/** Request schemas for the blog module (blog.routes.js). */
const { z, objectId, optionalInt, optionalText, paging, typeError } = require('../../validation/common');

const objectIdParams = z.object({ id: objectId });
/** Admin reads accept an id OR a slug. */
const idOrSlugParams = z.object({
  id: z.string(typeError('Post not found.')).trim().min(1, 'Post not found.').max(200, 'Post not found.'),
});
const slugParams = z.object({
  slug: z.string(typeError('Invalid slug')).trim().min(1, 'Invalid slug').max(200, 'Invalid slug'),
});

// 1000: admin Blogs (COUNTS_LIMIT) and the sitemaps (limit=500) load every post at once.
const listQuery = paging({ maxLimit: 1000 }).extend({
  q: optionalText(200),
  category: optionalText(200),
  tag: optionalText(200),
  exclude: optionalText(2000),
  status: optionalText(30),
});
const commentsQuery = z
  .object({
    status: optionalText(20),
    page: optionalInt({ min: 1, message: 'page must be a positive number.' }),
    limit: optionalInt({ min: 1, max: 200, message: 'limit must be between 1 and 200.' }),
  })
  .passthrough();

const objectBody = z.object({}).passthrough();

const commentBody = z
  .object({
    body: z
      .string(typeError('Comment text is required.', 'Comment text is required.'))
      .trim()
      .min(1, 'Comment text is required.')
      .max(5000, 'Comment must be at most 5000 characters.'),
    parent: z.union([objectId, z.null()]).optional(),
    guestName: optionalText(120),
    guestEmail: optionalText(254),
  })
  .passthrough();

const moderationBody = z
  .object({ status: z.string(typeError('Invalid status.')).trim().max(20, 'Invalid status.') })
  .passthrough();

module.exports = {
  objectIdParams,
  idOrSlugParams,
  slugParams,
  listQuery,
  commentsQuery,
  objectBody,
  commentBody,
  moderationBody,
};
