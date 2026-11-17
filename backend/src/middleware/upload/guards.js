/**
 * Wraps every multer parser method (single / array / fields / none / any) so each
 * upload is rate-limited, its multipart fields pass the same input checks as JSON
 * bodies, and private uploads (KYC, return evidence) are recorded with their owner.
 */
const { assertSafeInput } = require('../requestSecurity');
const { resolveKeyPrefix } = require('./keys');
const { fileToUrl } = require('./files');

// Validate multipart fields after Multer parses them, before any controller
// can turn a JSON field into a database selector. Record ownership of private uploads.
function guardParsers(instances) {
  for (const instance of instances) {
    for (const method of ['single', 'array', 'fields', 'none', 'any']) {
      const original = instance[method].bind(instance);
      instance[method] = (...args) => {
        const parse = original(...args);
        const limit = require('../rateLimit')({
          name: 'uploads',
          max: 30,
          window: 900,
          keyBy: (req) => String(req.user?._id || req.ip),
        });
        return (req, res, next) =>
          limit(req, res, (limitError) => {
            if (limitError) return next(limitError);
            parse(req, res, async (err) => {
              if (err) return next(err);
              try {
                assertSafeInput(req.body);
                for (const value of Object.values(req.body || {})) {
                  if (typeof value === 'string' && /^[[{]/.test(value.trim())) {
                    let parsed;
                    try {
                      parsed = JSON.parse(value);
                    } catch {
                      continue;
                    }
                    assertSafeInput(parsed);
                  }
                }
                const prefix = resolveKeyPrefix(req);
                const purpose = /(^|\/)kyc(\/|$)/.test(prefix)
                  ? 'kyc'
                  : /(^|\/)return-evidence(\/|$)/.test(prefix)
                    ? 'return-evidence'
                    : '';
                if (purpose) {
                  const PrivateUpload = require('../../models/PrivateUpload');
                  const files = req.file
                    ? [req.file]
                    : Array.isArray(req.files)
                      ? req.files
                      : Object.values(req.files || {}).flat();
                  for (const file of files)
                    await PrivateUpload.create({ key: fileToUrl(file), owner: req.user._id, purpose });
                }
                next();
              } catch (error) {
                next(error);
              }
            });
          });
      };
    }
  }
}

module.exports = { guardParsers };
