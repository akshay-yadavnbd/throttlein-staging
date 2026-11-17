/**
 * Seed the super admin.
 * Idempotent — only creates the user if missing.
 *
 * Can also be run standalone:  npm run seed
 *
 * HARDENED (audit A05). The old version ran on every startup with baked-in
 * fallback credentials, promoted any existing account that happened to use
 * the configured email, and printed the password to the process log. Each
 * of those is now refused:
 *
 *   - Explicit configuration is REQUIRED: both SUPER_ADMIN_EMAIL and
 *     SUPER_ADMIN_PASSWORD must be set. No defaults, ever.
 *   - Weak/known placeholder passwords are rejected.
 *   - An existing account with that email is NEVER promoted. Role changes
 *     for real accounts are a deliberate admin action, not a side effect
 *     of an env var pointing at a customer's address.
 *   - The password is never logged.
 *
 * Result: with no SUPER_ADMIN_* configuration the seed is a no-op and the
 * deployment simply has no bootstrap admin — provision one explicitly.
 */
require('../../config/loadEnv');

const mongoose = require('mongoose');
const User = require('../../models/User');
const { env } = require('../../config/env');
const { logger } = require('../../utils/logger');

const PLACEHOLDER_PASSWORDS = new Set(['ChangeMe@123', 'changeme', 'password', 'admin', 'admin123', 'Admin@123']);

async function seedSuperAdmin() {
  const email = String(env.SUPER_ADMIN_EMAIL || '')
    .toLowerCase()
    .trim();
  const password = env.SUPER_ADMIN_PASSWORD || '';
  const name = env.SUPER_ADMIN_NAME || 'Super Admin';

  if (!email || !password) {
    // Not configured — nothing to do. Intentionally silent-ish: this runs
    // on every boot and most boots shouldn't be provisioning admins.
    logger.info('[seedAdmin] SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set — skipping admin bootstrap.');
    return null;
  }
  if (password.length < 12 || PLACEHOLDER_PASSWORDS.has(password)) {
    logger.error(
      '[seedAdmin] Refusing to bootstrap: SUPER_ADMIN_PASSWORD is a known placeholder or shorter than 12 characters.',
    );
    return null;
  }

  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role !== 'superadmin') {
      // Refuse silent promotion — an ordinary account keeping its own
      // password must not become a superadmin because of configuration.
      logger.error(
        '%s',
        `[seedAdmin] An account already exists for ${email} with role "${existing.role}". ` +
          'Refusing to promote it automatically — assign roles through the admin panel.',
      );
      return null;
    }
    logger.info(`[seedAdmin] Super admin already exists: ${email}`);
    return existing;
  }

  const user = await User.create({
    name,
    email,
    password,
    role: 'superadmin',
    status: 'approved',
  });
  // Never log the password.
  logger.info(`[seedAdmin] Super admin created: ${email}`);
  return user;
}

// Stand-alone runner
if (require.main === module) {
  (async () => {
    try {
      await mongoose.connect(env.MONGO_URI);
      await seedSuperAdmin();
      await mongoose.disconnect();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Seed error:');
      process.exit(1);
    }
  })();
}

module.exports = seedSuperAdmin;
