/**
 * Accounts: customer registration, sign-in for every role, the current
 * user's profile and password.
 */
const { signToken } = require('../../middleware/auth');
const { AppError } = require('../../errors/AppError');
const repo = require('./auth.repository');
const { profileUpdates } = require('./profile-input');

const PASSWORD_RULE = 'Password must be at least 12 characters and at most 72 UTF-8 bytes.';
const passwordOk = (p) => typeof p === 'string' && p.length >= 12 && Buffer.byteLength(p, 'utf8') <= 72;

/** Buyers skip the email-first flow: password now, signed in at once. */
async function registerCustomer({ name, email, password, phone }) {
  if (!name || !email || !password) throw AppError.badRequest('Name, email, and password are required.');
  if (!passwordOk(password)) throw AppError.badRequest(PASSWORD_RULE);
  const existing = await repo.findByEmail(email);
  if (existing) {
    if (existing.role !== 'customer') {
      const label = existing.role === 'seller' ? 'seller (seller)' : 'admin';
      throw AppError.conflict(
        `This email is already registered as a ${label} account. ` +
          (label === 'seller (seller)'
            ? 'Sign in at /seller/login or use a different email for your customer account.'
            : 'Use a different email for your customer account.'),
      );
    }
    throw AppError.conflict('A customer account already exists with this email. Try signing in.');
  }
  const user = await repo.createUser({
    name,
    email,
    password,
    phone,
    role: 'customer',
    status: 'approved',
    emailVerified: true,
  });
  return { token: signToken(user), user: user.toSafeJSON() };
}

/**
 * Sign-in for seller, staff, superadmin and customer. Each refusal names a
 * stable code the frontends switch on: MISSING_FIELDS, INVALID_CREDENTIALS,
 * ACCOUNT_SUSPENDED, EMAIL_UNVERIFIED (details.unverified + details.email).
 * Only the account's own password is accepted here; support access goes
 * through authenticated impersonation.
 */
async function login({ email, password }) {
  const invalid = () => new AppError('INVALID_CREDENTIALS', 'Invalid email or password.', undefined, { status: 401 });
  if (
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    !email.trim() ||
    !password ||
    email.length > 254 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    throw new AppError('MISSING_FIELDS', 'Please enter both your email and password.', undefined, { status: 400 });
  }
  const user = await repo.findByEmailWithPassword(email);
  if (!user) throw invalid();
  const ok = user.password && (await user.matchPassword(password));
  if (!ok) throw invalid();
  if (user.status === 'suspended') {
    throw new AppError('ACCOUNT_SUSPENDED', 'This account is suspended. Contact support.', undefined, { status: 403 });
  }
  if (user.role === 'seller' && !user.emailVerified) {
    throw new AppError(
      'EMAIL_UNVERIFIED',
      'Please verify your email.',
      { unverified: true, email: user.email },
      { status: 403 },
    );
  }
  return { token: signToken(user), user: user.toSafeJSON() };
}

async function updateProfile(userId, body) {
  const user = await repo.updateProfile(userId, profileUpdates(body));
  return { user: user.toSafeJSON() };
}

/** Saving bumps `tokenVersion`, so a fresh token keeps this device signed in while the others sign out. */
async function changePassword(userId, { currentPassword, newPassword }) {
  if (typeof currentPassword !== 'string' || !currentPassword || !passwordOk(newPassword)) {
    throw AppError.badRequest(
      'Current password and a new password (12 characters minimum, 72 UTF-8 bytes maximum) are required.',
    );
  }
  const user = await repo.findByIdWithPassword(userId);
  if (!(await user.matchPassword(currentPassword))) throw AppError.unauthorized('Current password is incorrect.');
  user.password = newPassword;
  await user.save();
  return { message: 'Password updated. Other devices have been signed out.', token: signToken(user) };
}

module.exports = { registerCustomer, login, updateProfile, changePassword, passwordOk, PASSWORD_RULE };
