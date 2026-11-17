const express = require('express');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Product = require('../modules/products/product.model');
const { AppError } = require('../errors/AppError');
const { sendData } = require('../utils/apiResponse');
const { validate } = require('../middleware/validate');
const G = require('../validation/generic');

const router = express.Router();

// Final-approval gate for public seller visibility: BOTH account status and
// KYC status must be 'approved'. Pending / rejected / suspended sellers and
// anyone without verified KYC are 404'd from the storefront.
/** @type {Record<string, any>} */
const PUBLIC_SELLER_FILTER = {
  role: 'seller',
  status: 'approved',
  'kyc.status': 'approved',
};

// GET /api/sellers — public list of approved sellers (for storefront seller pages)
router.get(
  '/',
  validate({ query: G.listQuery }),
  asyncHandler(async (req, res) => {
    const sellers = await User.find(PUBLIC_SELLER_FILTER)
      .select('name storeName createdAt avatar')
      .sort({ createdAt: -1 });
    sendData(res, { items: sellers });
  }),
);

// GET /api/sellers/:id — public seller profile + their active products
router.get(
  '/:id',
  validate({ params: G.params({ id: 'objectId' }) }),
  asyncHandler(async (req, res) => {
    const seller = await User.findOne({
      _id: req.params.id,
      ...PUBLIC_SELLER_FILTER,
    }).select('name storeName phone address avatar createdAt');
    if (!seller) {
      throw AppError.notFound('Seller not found.');
    }
    const products = await Product.find({ seller: seller._id, status: 'active' }).sort({
      createdAt: -1,
    });
    sendData(res, { seller, products });
  }),
);

module.exports = router;
