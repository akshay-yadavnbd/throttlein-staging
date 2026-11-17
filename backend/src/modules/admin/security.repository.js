/**
 * The platform security singleton (master access key) and the admin audit
 * log. Statements only; the hashing lives on the PlatformSecurity model.
 */
const PlatformSecurity = require('./platform-security.model');
const AdminAuditLog = require('./admin-audit-log.model');

/** The singleton with its hidden hash (created on first read). */
const loadSecurity = () => PlatformSecurity.loadWithHash();
const publicLoginEnabled = (doc) => PlatformSecurity.publicLoginEnabled(doc);
const setPublicLogin = (enabled) =>
  PlatformSecurity.updateOne({ _id: 'master' }, { $set: { masterKeyLoginEnabled: enabled } }, { upsert: true });
/** Hash + store a new key; `{ rotating }` says whether one existed. */
const setMasterKey = (plain, admin) => PlatformSecurity.setMasterKey(plain, admin);
const verifyMasterKey = (plain) => PlatformSecurity.verifyMasterKey(plain);

/** One audit row; never throws into the request (the model swallows). */
const audit = (entry) => AdminAuditLog.record(entry);

module.exports = { loadSecurity, publicLoginEnabled, setPublicLogin, setMasterKey, verifyMasterKey, audit };
