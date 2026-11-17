/**
 * Request schemas for the admin module (admin.routes.js). They type the
 * edge — ids well-formed, paging bounded, enumerations named — and leave
 * the rules with messages the admin panel shows to the services.
 */
const { z, objectId, orderRef, optionalInt, optionalText, paging, typeError } = require('../../validation/common');

const idOrSlug = z.string(typeError('Invalid id')).trim().min(1, 'Invalid id').max(200, 'Invalid id');
const idOrSlugParams = z.object({ id: idOrSlug });
const objectIdParams = z.object({ id: objectId });
const orderRefParams = z.object({ idOrNumber: orderRef });

/** Bounded paging + search; the admin tables page up to 500 rows. */
const listQuery = paging({ maxLimit: 500 }).extend({ q: optionalText(200) });
const sellersQuery = listQuery.extend({ status: optionalText(20), stage: optionalText(30), stalled: optionalText(5) });
const productsQuery = listQuery.extend({ status: optionalText(20), scope: optionalText(10) });
const ordersQuery = listQuery.extend({
  status: optionalText(30),
  paymentStatus: optionalText(30),
  sellerId: optionalText(200),
  from: optionalText(10),
  to: optionalText(10),
  format: optionalText(10),
  archived: optionalText(5),
});

/** The body must be a JSON object; the service owns the field rules. */
const objectBody = z.object({}).passthrough();

const sellerStatusBody = z
  .object({
    status: z.enum(['pending', 'approved', 'suspended'], { error: 'Invalid status.' }),
  })
  .passthrough();

const masterKeyBody = z.object({ adminPassword: z.string().optional(), newKey: z.string().optional() }).passthrough();
const impersonateBody = z.object({ password: z.string().optional() }).passthrough();
const archiveBody = z.object({ reason: optionalText(300) }).passthrough();

const walletStatementQuery = z
  .object({
    from: optionalText(20),
    to: optionalText(20),
    page: optionalInt({ min: 1, message: 'page must be a positive number.' }),
  })
  .passthrough();
const redisInspectQuery = z
  .object({
    prefix: optionalText(200),
    pattern: optionalText(200),
    includeGroupItems: optionalText(5),
    topN: optionalInt({ min: 1, max: 500, message: 'topN must be between 1 and 500.' }),
    oversizeKB: optionalInt({ min: 1, message: 'oversizeKB must be a positive number.' }),
  })
  .passthrough();
const redisDeleteQuery = z
  .object({
    confirm: optionalText(5),
    prefix: z.union([z.string().trim().max(200), z.array(z.string().trim().max(200))]).optional(),
  })
  .passthrough();

module.exports = {
  idOrSlugParams,
  objectIdParams,
  orderRefParams,
  listQuery,
  sellersQuery,
  productsQuery,
  ordersQuery,
  objectBody,
  sellerStatusBody,
  masterKeyBody,
  impersonateBody,
  archiveBody,
  walletStatementQuery,
  redisInspectQuery,
  redisDeleteQuery,
};
