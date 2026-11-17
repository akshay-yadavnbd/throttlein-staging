const crypto = require('node:crypto');
const path = require('node:path');
const { env } = require('../config/env');
const { fromObjectKey } = require('./s3KeyPrefix');
const { AppError } = require('../errors/AppError');

const uploadRoot = () => path.resolve(__dirname, '../..', env.UPLOAD_DIR || 'uploads');
const privateRoot = () => path.resolve(__dirname, '../..', env.PRIVATE_UPLOAD_DIR || 'private-uploads');
const apiOrigin = () =>
  (env.PUBLIC_API_URL || `http://localhost:${env.PORT || 5000}/api`).replace(/\/api\/?$/, '').replace(/\/$/, '');
const badFile = () => AppError.badRequest('Invalid or unauthorized private file.');

function canonicalPrivateKey(value) {
  if (typeof value !== 'string' || !value || value.length > 8192) throw badFile();
  let key = value;
  if (/^https?:\/\//i.test(key)) {
    const url = new URL(key);
    if (url.origin === apiOrigin() && url.pathname === '/api/private-files') key = url.searchParams.get('key') || '';
    else if (url.origin === apiOrigin() && url.pathname.startsWith('/uploads/')) key = url.pathname;
    else if (
      env.S3_BUCKET_NAME &&
      [`${env.S3_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com`, `${env.S3_BUCKET_NAME}.s3.amazonaws.com`].includes(
        url.hostname,
      )
    )
      key = fromObjectKey(decodeURIComponent(url.pathname.slice(1)));
    else throw badFile();
  }
  if (key.includes('..') || key.includes('\\') || key.includes('\0') || /[?#]/.test(key)) throw badFile();
  if (/^\/(private-uploads|uploads)\/[a-zA-Z0-9_.-]+$/.test(key)) return key;
  if (/^(kyc\/|sellers\/[^/]+\/kyc\/|return-evidence\/)/.test(key)) return key;
  throw badFile();
}

function signDiskFile(key, expiresIn = 3600) {
  const secret = env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('Private file signing is not configured.');
  const expires = String(Math.floor(Date.now() / 1000) + Math.min(3600, expiresIn));
  const signature = crypto.createHmac('sha256', secret).update(`private-file\n${key}\n${expires}`).digest('hex');
  return `${apiOrigin()}/api/private-files?${new URLSearchParams({ key, expires, signature })}`;
}

function privateDiskHandler(req, res, next) {
  try {
    const key = canonicalPrivateKey(req.query.key);
    const { expires, signature } = req.query;
    const now = Math.floor(Date.now() / 1000);
    if (
      !/^\/(private-uploads|uploads)\//.test(key) ||
      !/^\d+$/.test(expires || '') ||
      Number(expires) < now ||
      Number(expires) > now + 3600 ||
      !/^[a-f0-9]{64}$/.test(signature || '') ||
      !env.JWT_SECRET
    )
      throw badFile();
    const expected = crypto.createHmac('sha256', env.JWT_SECRET).update(`private-file\n${key}\n${expires}`).digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw badFile();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.sendFile(
      path.basename(key),
      { root: key.startsWith('/private-uploads/') ? privateRoot() : uploadRoot(), dotfiles: 'deny' },
      (err) => {
        if (err && !res.headersSent) res.status(404).end();
      },
    );
  } catch (_) {
    next(AppError.forbidden('Private file access denied.'));
  }
}

async function ownedPrivateKey(value, userId, purpose, existing = []) {
  if (!value) return '';
  const key = canonicalPrivateKey(value);
  // Existing references are checked on the caller's own record by the controller.
  if (
    existing.some((v) => {
      try {
        return canonicalPrivateKey(v) === key;
      } catch {
        return false;
      }
    })
  )
    return key;
  const PrivateUpload = require('../models/PrivateUpload');
  if (!(await PrivateUpload.exists({ key, owner: userId, purpose }))) throw badFile();
  return key;
}

/** Legacy flat files have no private prefix. Deny anything referenced by KYC/returns. */
async function guardPublicDisk(req, res, next) {
  try {
    const key = `/uploads${decodeURIComponent(req.path)}`;
    if (!/^\/uploads\/[a-zA-Z0-9_.-]+\.(png|jpe?g|webp|gif|svg|avif|mp4|mov|webm|3gp)$/i.test(key))
      return res.status(403).end();
    const User = require('../models/User');
    const Order = require('../modules/orders/order.model');
    const privateKyc = await User.exists({
      $or: [
        'kyc.gstCertificate',
        'kyc.panCard',
        'kyc.bankDetails.cancelledCheque',
        'kycRevision.gstCertificate',
        'kycRevision.panCard',
        'kycRevision.bankDetails.cancelledCheque',
        'kyc.pan.file',
        'kyc.gst.file',
        'kyc.cheque.file',
        'kyc.aadhaar.file',
      ].map((field) => ({ [field]: { $in: [key, `${apiOrigin()}${key}`] } })),
    });
    const privateEvidence = await Order.exists({
      'returnRequests.attachments.url': { $in: [key, `${apiOrigin()}${key}`] },
    });
    if (privateKyc || privateEvidence) return res.status(403).end();
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    next();
  } catch (err) {
    next(err);
  }
}
module.exports = {
  canonicalPrivateKey,
  signDiskFile,
  privateDiskHandler,
  ownedPrivateKey,
  guardPublicDisk,
  privateRoot,
};
