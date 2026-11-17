/**
 * Draft a product from a public product URL (the seller's "Import from URL").
 * Read-only: nothing is saved; the seller reviews the draft and saves it as a
 * normal product. The extraction pipeline lives in url-extract.js.
 *
 * The seller must confirm they may reuse the source's content and images,
 * and the server's Groq key must be configured. Only our own fixed messages
 * reach the client: provider bodies, page data and keys are never returned
 * or logged.
 */
const { env } = require('../../config/env');
const { AppError } = require('../../errors/AppError');
const extract = require('./url-extract');

async function importFromUrl(body = {}) {
  if (body.confirmRights !== true)
    throw AppError.badRequest('Confirm you have permission to reuse the source content and images.');
  if (!env.GROQ_API_KEY)
    throw AppError.unavailable('URL import is not configured yet. Ask the administrator to enable it.');
  try {
    return await extract.importProductUrl(body.url);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error.status) throw AppError.fromStatus(error.status, error.message);
    throw AppError.upstream('Could not import this product. Please try again or add it manually.');
  }
}

module.exports = { importFromUrl };
