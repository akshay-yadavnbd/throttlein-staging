/**
 * Boundary validation — validate every input at the edge.
 *
 *   router.post('/login', validate({ body: loginSchema }, { code: 'MISSING_FIELDS' }), ctrl.login);
 *
 * Parses `req.params`, `req.query` and `req.body` with the zod schemas given
 * and REPLACES them with the parsed values (trimmed, lower-cased, coerced,
 * defaulted), so controllers only ever see validated, typed data. A failure
 * becomes one AppError — code VALIDATION_FAILED (400) unless the route
 * names another — whose `message` joins the field sentences and whose
 * `details.issues` lists `{ in, path, message }` per field.
 *
 * Schemas live in src/validation/<domain>.schema.js; shared pieces (email,
 * password, object id, paging) in src/validation/common.js.
 */
const { AppError } = require('../errors/AppError');

const PARTS = ['params', 'query', 'body'];

function validate(schemas, options = {}) {
  if (!schemas || typeof schemas !== 'object') throw new TypeError('validate() needs { params?, query?, body? }');
  const { code, message: fixedMessage } = options;

  return function validateRequest(req, _res, next) {
    const issues = [];
    for (const part of PARTS) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        if (part === 'body') {
          req.body = result.data;
        } else {
          // Express 5 exposes query/params through getters; redefine the
          // property so the parsed value is what every later read sees.
          Object.defineProperty(req, part, {
            value: result.data,
            writable: true,
            configurable: true,
            enumerable: true,
          });
        }
      } else {
        // zod 4 keeps running a field's checks after its type error (an array
        // where a string belongs also fails `.min()`); like zod 3, a field with
        // a type error reports only that.
        const mistyped = new Set(
          result.error.issues.filter((i) => i.code === 'invalid_type').map((i) => i.path.join('.')),
        );
        for (const issue of result.error.issues) {
          const path = issue.path.join('.');
          if (issue.code !== 'invalid_type' && mistyped.has(path)) continue;
          issues.push({ in: part, path, message: issue.message });
        }
      }
    }
    if (issues.length === 0) return next();

    // One readable paragraph: each distinct field message as a sentence.
    const sentences = [...new Set(issues.map((i) => i.message))].map((s) => (/[.!?]$/.test(s) ? s : `${s}.`));
    const message = fixedMessage || sentences.join(' ');
    next(new AppError(code || 'VALIDATION_FAILED', message, { issues }, { status: 400 }));
  };
}

module.exports = { validate };
