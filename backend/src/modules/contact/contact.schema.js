/** The contact form body. Headline fields are typed; unknown keys pass through to the service. */
const { z, optionalText } = require('../../validation/common');

const contact = z
  .object({
    fullName: optionalText(120),
    name: optionalText(120),
    email: optionalText(254),
    phone: optionalText(40),
    topic: optionalText(120),
    message: z.string().max(5000, 'Message must be at most 5000 characters.').optional(),
  })
  .passthrough();

module.exports = { contact };
