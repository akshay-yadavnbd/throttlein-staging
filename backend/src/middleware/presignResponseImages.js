/**
 * Global response middleware — wraps `res.json` so every payload sent by an
 * Express route is first walked through `signImagesIn()`. That function
 * replaces every image-looking field (Product.images[], Brand.logo,
 * Category.icon, HomeBanner.image, User.avatar / kyc.*.file, etc.) with a
 * fresh presigned S3 URL.
 *
 * Why a global wrap instead of patching each controller?
 *   - Images surface in many controllers (products, orders, reviews,
 *     wishlist, brands, categories, banners, trending, kyc, admin). Touching
 *     each res.json call invites drift — a new endpoint added later would
 *     return raw S3 keys.
 *   - Public URLs stay public; private disk and S3 references receive
 *     expiring links on every authorized response.
 *
 * Signing failures enter the error handler without sending raw references.
 *
 * Mount this AFTER express.json() but BEFORE the route mounting.
 */
const { signImagesIn } = require('../utils/signImages');
const { logger } = require('../utils/logger');

module.exports = function presignResponseImages(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    // Fire-and-forget would lose error context; await the signing so any
    // throw lands in Express's normal error path.
    signImagesIn(payload)
      .then((signed) => originalJson(signed))
      .catch((err) => {
        logger.error({ err }, '[presignResponseImages] failed:');
        res.json = originalJson;
        next(err);
      });
    return res;
  };

  next();
};
