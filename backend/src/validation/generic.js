/**
 * Route-level schemas for domains that are not modules yet. They type the
 * edge — ids well-formed, paging bounded, bodies that are objects — and
 * leave the business rules to the controller, so a hand-check there never
 * disagrees with the schema. A domain gets its own `<domain>.schema.js`
 * when it becomes a module.
 */
const { z, objectId, orderRef, optionalInt, optionalText, typeError } = require('./common');

const KINDS = {
  objectId,
  /** A route param that may be an ObjectId OR a slug (sellers, customers). */
  idOrSlug: z.string(typeError('Invalid id')).trim().min(1, 'Invalid id').max(200, 'Invalid id'),
  slug: z.string(typeError('Invalid slug')).trim().min(1, 'Invalid slug').max(200, 'Invalid slug'),
  orderRef,
  text: z.string(typeError('Invalid value')).trim().min(1, 'Invalid value').max(200, 'Invalid value'),
};

/** `params({ id: 'objectId', slug: 'slug' })` → a params schema. */
function params(spec) {
  /** @type {Record<string, import('zod').ZodType>} */
  const shape = {};
  for (const [name, kind] of Object.entries(spec)) {
    if (!KINDS[kind]) throw new TypeError(`Unknown param kind: ${kind}`);
    shape[name] = KINDS[kind];
  }
  return z.object(shape);
}

/** Bounded paging plus the common search keys; everything else passes through. */
const listQuery = z
  .object({
    page: optionalInt({ min: 1, message: 'page must be a positive number.' }),
    limit: optionalInt({ min: 1, max: 500, message: 'limit must be between 1 and 500.' }),
    q: optionalText(200),
    search: optionalText(200),
  })
  .passthrough();

/** The body must be a JSON object (not an array, string or null); fields are the controller's. */
const objectBody = z.object({}).passthrough();

module.exports = { params, listQuery, objectBody, KINDS };
