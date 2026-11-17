const mongoose = require('mongoose');
const { SITES, DEFAULT_SITE } = require('../../config/sites');

/**
 * Redirect — admin-managed URL redirects served by the storefront's
 * Next.js middleware. Lets admins fix 404s / rename routes / honour
 * legacy URLs without a code deploy.
 *
 * Match semantics
 *   We currently support EXACT-PATH matching only. `source` must be a
 *   pathname (e.g. `/helmets`) — no query string, no host, no trailing
 *   slash duplication. Wildcard / regex matching can be added later
 *   behind a `matchType` field if needed.
 *
 * Status code
 *   301 (permanent) is the default and is what you want for SEO
 *   renames — the destination inherits the source's link equity.
 *   302 (temporary) is offered as an escape hatch for time-limited
 *   redirects (e.g. a campaign URL that should revert later).
 *
 * hitCount
 *   Incremented by the middleware on every redirect served. Surfaced
 *   in the admin list so admins can spot dead redirects (zero hits
 *   over months) or hot ones (lots of inbound legacy traffic — worth
 *   keeping forever).
 */
const redirectSchema = new mongoose.Schema(
  {
    // Which property this redirect applies to. throttlein.com/old-page
    // and seller.throttlein.com/old-page are independent rules, so the
    // source path is unique per site rather than globally.
    site: {
      type: String,
      enum: SITES,
      default: DEFAULT_SITE,
      required: true,
      index: true,
    },
    source: {
      type: String,
      required: true,
      trim: true,
      // Uniqueness is declared once via `redirectSchema.index(...)`
      // below — avoids the Mongoose "duplicate schema index" warning
      // that fires when both `unique: true` here AND a separate
      // `.index({...}, { unique: true })` declaration coexist.
      // Normalise to always start with `/` so the middleware can do a
      // simple exact-string lookup against `request.nextUrl.pathname`.
      set: (v) => {
        if (!v || typeof v !== 'string') return v;
        const trimmed = v.trim();
        return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
      },
    },
    destination: { type: String, required: true, trim: true },
    statusCode: { type: Number, enum: [301, 302], default: 301 },
    isActive: { type: Boolean, default: true },
    note: { type: String, default: '', trim: true, maxlength: 280 },
    hitCount: { type: Number, default: 0 },
    lastHitAt: { type: Date },
  },
  { timestamps: true },
);

// Site + source path is the lookup key for the storefront proxy.
redirectSchema.index({ site: 1, source: 1 }, { unique: true });

module.exports = mongoose.model('Redirect', redirectSchema);
