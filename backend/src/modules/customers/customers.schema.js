/** Request bodies for the shopper routes. Headline fields are typed; unknown keys pass through to the service. */
const { z, objectId, optionalText, typeError } = require('../../validation/common');

const quantity = z.coerce
  .number(typeError(undefined, 'Quantity must be a number.'))
  .int('Quantity must be a whole number.')
  .min(0, 'Quantity cannot be negative.')
  .max(999, 'Quantity is too large.');

const cartAdd = z
  .object({
    productId: objectId,
    quantity: quantity.optional(),
    size: optionalText(60),
    color: optionalText(60),
  })
  .passthrough();

const cartUpdate = z.object({ quantity: quantity.optional() }).passthrough();

const productRef = z.object({ productId: objectId }).passthrough();

const address = z
  .object({
    fullName: optionalText(120),
    phone: optionalText(40),
    line1: optionalText(300),
    line2: optionalText(300),
    city: optionalText(120),
    state: optionalText(120),
    pincode: optionalText(20),
    country: optionalText(80),
    label: optionalText(40),
  })
  .passthrough();

module.exports = { cartAdd, cartUpdate, productRef, address };
