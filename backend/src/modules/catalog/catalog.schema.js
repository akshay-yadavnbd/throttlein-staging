/** Request schemas the catalogue routes own (the rest use validation/generic). */
const { z, objectId, orderRef, optionalText, typeError } = require('../../validation/common');

const reviewUpsert = z
  .object({
    productId: objectId,
    orderId: orderRef.optional(),
    rating: z.coerce
      .number(typeError(undefined, 'Rating must be a number.'))
      .int('Rating must be a whole number.')
      .min(1, 'Rating must be between 1 and 5.')
      .max(5, 'Rating must be between 1 and 5.')
      .optional(),
    title: optionalText(160),
    comment: z.string().max(4000, 'Comment must be at most 4000 characters.').optional(),
    images: z.array(z.string().max(500)).max(10, 'At most 10 images.').optional(),
  })
  .passthrough();

module.exports = { reviewUpsert };
