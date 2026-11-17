/** Every User query the auth module makes. Statements only. */
const User = require('../../models/User');

const normalEmail = (email) =>
  String(email || '')
    .trim()
    .toLowerCase();

const findByEmail = (email) => User.findOne({ email: normalEmail(email) });
/** With the hidden password hash, for a credential check. */
const findByEmailWithPassword = (email) => User.findOne({ email: normalEmail(email) }).select('+password');
const findByIdWithPassword = (id) => User.findById(id).select('+password');

/** The account whose email-verification token (hashed) is still live. */
const findByVerifyToken = (hashed) =>
  User.findOne({ emailVerifyToken: hashed, emailVerifyExpires: { $gt: Date.now() } }).select(
    '+emailVerifyToken +emailVerifyExpires',
  );
/** The account whose password-reset token (hashed) is still live. */
const findByResetToken = (hashed) =>
  User.findOne({ passwordResetToken: hashed, passwordResetExpires: { $gt: Date.now() } }).select(
    '+password +passwordResetToken +passwordResetExpires',
  );

/** An unsaved document (the caller mints a token on it, then saves). */
const newUser = (fields) => new User(fields);
const createUser = (fields) => User.create(fields);
/** Whitelisted profile fields, validated by the schema's validators. */
const updateProfile = (id, updates) =>
  User.findByIdAndUpdate(id, updates, { returnDocument: 'after', runValidators: true });

module.exports = {
  normalEmail,
  findByEmail,
  findByEmailWithPassword,
  findByIdWithPassword,
  findByVerifyToken,
  findByResetToken,
  newUser,
  createUser,
  updateProfile,
};
