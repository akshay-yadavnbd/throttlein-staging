const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, enum: ['kyc', 'return-evidence'], required: true },
  },
  { timestamps: true },
);
module.exports = mongoose.model('PrivateUpload', schema);
