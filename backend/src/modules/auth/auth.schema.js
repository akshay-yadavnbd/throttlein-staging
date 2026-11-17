/** Request schemas for /api/auth (auth.routes.js). */
const { z, email, password, phone, hexToken, optionalText, typeError } = require('../../validation/common');

const name = z
  .string(typeError('Your name is required', 'Your name is required'))
  .trim()
  .min(1, 'Your name is required')
  .max(200, 'Your name is too long.');

/** Seller self-registration (email-first; the password comes after verification). */
const registerSeller = z
  .object({
    name,
    // `storeName` is current; `shopName` is the legacy spelling still accepted.
    storeName: z.string().trim().max(200, 'Store Name is too long.').optional(),
    shopName: z.string().trim().max(200, 'Store Name is too long.').optional(),
    email,
    phone,
  })
  .superRefine((v, ctx) => {
    if (!v.storeName && !v.shopName)
      ctx.addIssue({ code: 'custom', path: ['storeName'], message: 'Store Name is required' });
  });

const setPassword = z.object({
  token: hexToken('Verification token is required.'),
  password,
});

const emailOnly = z.object({ email });

const registerCustomer = z.object({
  name: z
    .string(typeError('Name, email, and password are required.'))
    .trim()
    .min(1, 'Name, email, and password are required.')
    .max(200, 'Your name is too long.'),
  email,
  password,
  phone: z.string().trim().max(40, 'A valid phone number is required').optional(),
});

/** Login: presence only (no format rule — an unknown email must read as "invalid credentials", not "bad email"). */
const login = z.object({
  email: z.string().trim().min(1).max(254),
  password: z
    .string()
    .min(1)
    .refine((v) => Buffer.byteLength(v, 'utf8') <= 72),
});

const changePassword = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

const resetPasswordParams = z.object({
  token: z.string().trim().min(1, 'Reset token is required.').max(200, 'Reset token is required.'),
});
const resetPassword = z
  .object({
    password,
    confirmPassword: z.string().optional(),
  })
  .refine((v) => v.confirmPassword === undefined || v.confirmPassword === v.password, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });

const verifyTokenParams = z.object({
  token: z.string().trim().min(1, 'Verification token is required.').max(200, 'Verification token is required.'),
});

/** Profile edits: profile-input.js whitelists and clamps; the schema types the text fields. */
const updateProfile = z
  .object({
    name: optionalText(200),
    storeName: optionalText(200),
    shopName: optionalText(200),
    phone: optionalText(40),
    alternatePhone: optionalText(40),
  })
  .passthrough();

module.exports = {
  registerSeller,
  setPassword,
  emailOnly,
  registerCustomer,
  login,
  changePassword,
  resetPasswordParams,
  resetPassword,
  verifyTokenParams,
  updateProfile,
};
