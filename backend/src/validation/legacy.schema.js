/**
 * Request bodies for the public and customer routes whose controllers are
 * not modules yet (blog
 * comments, pickup OTP). Headline fields are typed; unknown keys pass
 * through to the controller, which owns the rules.
 */
const { z, objectId, optionalText, typeError } = require('./common');

const blogComment = z
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

const otp = z
  .object({
    otp: z
      .string(typeError('Enter the 6-digit code.', 'Enter the 6-digit code.'))
      .trim()
      .regex(/^\d{6}$/, 'Enter the 6-digit code.'),
  })
  .passthrough();

module.exports = { blogComment, otp };
