/** Request schemas for the CMS module (cms.routes.js). */
const { z, objectId, optionalText, typeError } = require('../../validation/common');

const objectIdParams = z.object({ id: objectId });
const slugParams = z.object({
  slug: z.string(typeError('Invalid slug')).trim().min(1, 'Invalid slug').max(200, 'Invalid slug'),
});

/** `?active=1` narrows public lists to active rows. */
const activeQuery = z.object({ active: optionalText(5) }).passthrough();
const pagesQuery = z
  .object({ q: optionalText(200), all: optionalText(5), type: optionalText(30), template: optionalText(40) })
  .passthrough();
const routeQuery = z
  .object({ slug: optionalText(200), parent: optionalText(200), brand: optionalText(200) })
  .passthrough();
const staticMetaQuery = z.object({ route: optionalText(300) }).passthrough();

/** The body must be a JSON object; the services own the field rules. */
const objectBody = z.object({}).passthrough();

module.exports = { objectIdParams, slugParams, activeQuery, pagesQuery, routeQuery, staticMetaQuery, objectBody };
