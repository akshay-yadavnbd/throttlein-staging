const mongoose = require('mongoose');

/**
 * Seller-submitted request to add a new Brand or Category. Admin reviews on
 * the Brand & Category requests page; approval flow on the admin side creates
 * the real Brand / Category resource and then stamps this request as
 * approved (linking back via createdResourceId for traceability).
 */
const categoryBrandRequestSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['brand', 'category'],
      required: true,
    },
    name: { type: String, required: true, trim: true },
    // For a category request: the parent the new category should be added
    // under (null = top level). For a brand request: the category the seller
    // wants this brand to be associated with (advisory only).
    parentCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },
    notes: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    decisionNote: { type: String, default: '' },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    decidedAt: { type: Date, default: null },
    // The Brand or Category _id that was created when this request was
    // approved. Lets admin trace the chain later.
    createdResourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('CategoryBrandRequest', categoryBrandRequestSchema);
