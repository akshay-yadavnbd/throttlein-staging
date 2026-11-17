/**
 * Shared zod pieces for request schemas. Every message here is a sentence
 * a person can read; the frontends show `message` verbatim.
 */
const { z } = require('zod');

// zod 4 words a missing value "Invalid input: expected string, received undefined"
// (or "Invalid option: …" for an enum); keep zod 3's "Required", since the apps
// show `message` as-is. A schema's own message (typeError below, or a check's
// message) still wins over this default.
const MISSING_CODES = new Set(['invalid_type', 'invalid_value']);
z.config({ customError: (iss) => (iss.input === undefined && MISSING_CODES.has(iss.code) ? 'Required' : undefined) });

/**
 * The type-error messages for a schema (zod 4 dropped `required_error` /
 * `invalid_type_error`): `required` when the value is missing, `invalid` when it
 * has the wrong type. Leave one out to keep zod's default for that case.
 *
 *   z.string(typeError('Email is required.', 'Email is required.'))
 */
const typeError = (required, invalid) => ({
  error: (iss) => (iss.input === undefined ? required : invalid),
});

const PASSWORD_MESSAGE = 'Password must be at least 12 characters and at most 72 UTF-8 bytes.';

/** Trimmed, lower-cased, well-formed email. */
const email = z
  .string(typeError('Email is required.', 'Email is required.'))
  .trim()
  .toLowerCase()
  .min(1, 'Email is required.')
  .max(254, 'A valid email is required.')
  .email('A valid email is required.');

/** The account password rule the backend enforces everywhere (12+ chars, ≤ 72 bytes). */
const password = z
  .string(typeError(PASSWORD_MESSAGE, PASSWORD_MESSAGE))
  .min(12, PASSWORD_MESSAGE)
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, PASSWORD_MESSAGE);

/** Phone as the seller forms accept it: digits with optional +, spaces, brackets, dashes. */
const phone = z
  .string(typeError('A valid phone number is required', 'A valid phone number is required'))
  .trim()
  .regex(/^[+0-9 ()-]{7,20}$/, 'A valid phone number is required');

/** A MongoDB ObjectId in its 24-hex form. */
const objectId = z.string(typeError('Invalid id', 'Invalid id')).regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/** An order reference: ObjectId or order number (TIN-…). */
const orderRef = z
  .string(typeError('Invalid order id', 'Invalid order id'))
  .trim()
  .min(1, 'Invalid order id')
  .max(80, 'Invalid order id');

/** A 64-hex verification / reset token. */
const hexToken = (message) => z.string(typeError(message, message)).regex(/^[a-f0-9]{64}$/i, message);

/** Optional query integer: '' and undefined stay undefined; otherwise coerced and bounded. */
const optionalInt = ({ min = 1, max = Number.MAX_SAFE_INTEGER, message = 'Invalid number' } = {}) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? undefined : v),
    z.coerce.number(typeError(undefined, message)).int(message).min(min, message).max(max, message).optional(),
  );

/** Optional query number (prices). */
const optionalNumber = (message = 'Invalid number') =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? undefined : v),
    z.coerce.number(typeError(undefined, message)).optional(),
  );

/** Optional short string from a query parameter (trimmed). */
const optionalText = (max = 200) => z.string().trim().max(max, `Must be at most ${max} characters.`).optional();

/** Accepts true/false, 'true'/'false', '1'/'0'. */
const boolish = z.preprocess(
  (v) => {
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(s)) return true;
      if (['0', 'false', 'no', 'off', ''].includes(s)) return false;
    }
    return v;
  },
  z.boolean(typeError(undefined, 'Expected true or false.')),
);

/** page / limit query, bounded. Unknown keys pass through. */
const paging = ({ maxLimit = 200 } = {}) =>
  z
    .object({
      page: optionalInt({ min: 1, message: 'page must be a positive number.' }),
      limit: optionalInt({ min: 1, max: maxLimit, message: `limit must be between 1 and ${maxLimit}.` }),
    })
    .passthrough();

/** Optional positive integer from a JSON body (courier ids). */
const optionalPositiveInt = (message = 'Invalid number') =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? undefined : v),
    z.coerce.number(typeError(undefined, message)).int(message).positive(message).optional(),
  );

module.exports = {
  z,
  typeError,
  PASSWORD_MESSAGE,
  email,
  password,
  phone,
  objectId,
  orderRef,
  hexToken,
  optionalInt,
  optionalNumber,
  optionalText,
  optionalPositiveInt,
  boolish,
  paging,
};
