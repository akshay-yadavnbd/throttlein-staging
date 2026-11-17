/**
 * Where uploads land, chosen once at boot: S3 when AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY / AWS_REGION / S3_BUCKET_NAME are set (and DISABLE_S3
 * is not), otherwise ./uploads on local disk (private files under the private root).
 */
const path = require('path');
const crypto = require('node:crypto');
const fs = require('fs');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { S3Client } = require('@aws-sdk/client-s3');
const { privateRoot } = require('../../utils/privateFiles');
const { env } = require('../../config/env');
const { logger } = require('../../utils/logger');
const { makeKey, resolveKeyPrefix, isPrivatePrefix } = require('./keys');
const { S3_KEY_PREFIX, toObjectKey } = require('../../utils/s3KeyPrefix');

/** The public uploads folder in disk mode (backend/<UPLOAD_DIR>, default ./uploads). */
const UPLOAD_DIR = path.join(__dirname, '..', '..', '..', env.UPLOAD_DIR || 'uploads');

// Set DISABLE_S3=true in .env to force local-disk uploads even if AWS creds are present.
const s3Disabled = String(env.DISABLE_S3 || '').toLowerCase() === 'true';

const useS3 =
  !s3Disabled && Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_REGION && env.S3_BUCKET_NAME);

let storage;
let s3Client = null;

if (useS3) {
  s3Client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });

  storage = multerS3({
    s3: s3Client,
    bucket: env.S3_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    cacheControl: 'public, max-age=31536000, immutable',
    metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
    // Prefix is resolved per-request so seller uploads land under
    // sellers/<id>/... and a cascade delete can wipe one folder. Admin
    // uploads keep the flat prefix. See `resolveKeyPrefix()`.
    // The environment folder (S3_KEY_PREFIX) is added here, at the bucket
    // boundary; fileToUrl() strips it again so the DB stores the bare key.
    key: (req, file, cb) => cb(null, toObjectKey(makeKey(file.originalname, resolveKeyPrefix(req)))),
  });

  logger.info(
    '%s',
    `Image uploads → S3 bucket "${env.S3_BUCKET_NAME}" (${env.AWS_REGION})` +
      `${S3_KEY_PREFIX ? ` under "${S3_KEY_PREFIX}"` : ''}. Serving via presigned URLs.`,
  );
} else {
  const uploadDir = UPLOAD_DIR;
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const isPrivate = isPrivatePrefix(resolveKeyPrefix(req));
      const destination = isPrivate ? privateRoot() : uploadDir;
      fs.mkdir(destination, { recursive: true }, (err) => cb(err, destination));
    },
    filename: (req, file, cb) => {
      const safeBase = path
        .basename(file.originalname, path.extname(file.originalname))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 40);
      cb(null, `${crypto.randomUUID()}-${safeBase}${path.extname(file.originalname).toLowerCase()}`);
    },
  });

  logger.info(
    '%s',
    s3Disabled
      ? 'Image uploads → local disk (./uploads) — S3 disabled via DISABLE_S3=true'
      : 'Image uploads → local disk (./uploads)',
  );
}

storage = require('../../utils/uploadValidation').validateStorage(storage);

module.exports = { storage, s3Client, useS3, UPLOAD_DIR };
