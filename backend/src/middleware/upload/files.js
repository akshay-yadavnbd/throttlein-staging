/**
 * Stored upload values ⇄ fetchable URLs, and deletes. The database holds the bare
 * S3 key (or "/uploads/<file>" on disk); public images resolve through
 * publicFileUrl(), private ones (KYC, return evidence) through short-lived presigned URLs.
 */
const path = require('path');
const fs = require('fs');
const {
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { canonicalPrivateKey, signDiskFile, privateRoot } = require('../../utils/privateFiles');
const { env } = require('../../config/env');
const { logger } = require('../../utils/logger');
const { normaliseToKey } = require('./keys');
const { S3_KEY_PREFIX, toObjectKey, fromObjectKey } = require('../../utils/s3KeyPrefix');
const { s3Client, UPLOAD_DIR } = require('./storage');

/**
 * Given a multer-file produced by either storage backend, return the string
 * that should be persisted in the database.
 *
 *  - S3 mode:  returns the bare object key (e.g. "products/1234-foo.png").
 *              Resolution to a fetchable URL happens later via presignKey().
 *  - Disk:     returns "/uploads/<filename>" — handled by the static-files
 *              middleware mounted in src/app.js.
 *
 * Storing the bare key (instead of a proxy URL like "/api/files/<key>") lets
 * the serializer mint a fresh presigned URL on every response without having
 * to parse / strip prefixes.
 */
function fileToUrl(f) {
  if (f.key) return fromObjectKey(f.key);
  return `${f.destination === privateRoot() ? '/private-uploads' : '/uploads'}/${f.filename}`;
}

/**
 * Delete a single object from S3 (best effort). Accepts a bare key, a
 * legacy /api/files/<key> proxy URL, or a disk path — the latter two
 * are normalised first; disk paths are removed from local storage.
 *
 * Errors are swallowed and logged: cleanup is opportunistic, callers
 * shouldn't fail the request because the file was already gone.
 */
async function deleteKey(value) {
  if (!value || typeof value !== 'string') return;
  // Disk-stored asset — unlink from /uploads/
  if (value.startsWith('/uploads/')) {
    const filename = path.basename(value);
    const uploadDir = UPLOAD_DIR;
    try {
      await fs.promises.unlink(path.join(uploadDir, filename));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err }, '[deleteKey] disk unlink failed for %s', filename);
      }
    }
    return;
  }
  if (!s3Client) return;
  const key = normaliseToKey(value);
  if (!key) return;
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: env.S3_BUCKET_NAME,
        Key: toObjectKey(key),
      }),
    );
  } catch (err) {
    logger.warn({ err }, '[deleteKey] S3 delete failed for %s', key);
  }
}

/**
 * Delete every object under an S3 prefix. Used by the seller-delete
 * cascade: pass `sellers/<id>/` and every product image, KYC doc, and
 * profile photo under that folder gets removed in batches of 1000 (S3's
 * DeleteObjects hard limit).
 *
 * Returns a `{ deleted }` count for logging. Silently no-ops in disk
 * mode — there's nothing to scan locally; the upload directory mixes
 * files from every user.
 */
async function deletePrefix(prefix) {
  if (!s3Client || !prefix) return { deleted: 0 };
  // Tighten the prefix — trailing slash prevents `sellers/123` from
  // accidentally matching `sellers/1234/...`.
  // Listed keys come back with the environment folder already on them
  // and are deleted as-is.
  const Prefix = toObjectKey(prefix.endsWith('/') ? prefix : `${prefix}/`);
  let ContinuationToken;
  let totalDeleted = 0;

  do {
    let listed;
    try {
      listed = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: env.S3_BUCKET_NAME,
          Prefix,
          ContinuationToken,
        }),
      );
    } catch (err) {
      logger.warn({ err }, '[deletePrefix] list failed for %s', Prefix);
      break;
    }

    const keys = (listed.Contents || []).map((o) => ({ Key: o.Key }));
    if (keys.length) {
      try {
        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: env.S3_BUCKET_NAME,
            Delete: { Objects: keys, Quiet: true },
          }),
        );
        totalDeleted += keys.length;
      } catch (err) {
        logger.warn({ err }, '[deletePrefix] batch delete failed for %s', Prefix);
      }
    }

    ContinuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (ContinuationToken);

  return { deleted: totalDeleted };
}

/**
 * Public file URL — points at the backend's `/api/files/<key>` stream
 * proxy, which serves the object with a 1-year immutable Cache-Control.
 *
 * Why prefer this over a presigned S3 URL for public images?
 *   1. Stable: the URL doesn't expire, so crawlers (Google, Semrush,
 *      social-card previewers) and CDN edges hold a single permanent
 *      reference. Presigned URLs expire in <=1 hour, which is what
 *      caused the Semrush "67 broken internal images" report — the
 *      signatures in the SSR HTML were dead by the time the audit
 *      bot followed them.
 *   2. No URL-encoding traps: presigned URLs contain `?X-Amz-...&` query
 *      strings that get truncated when Next.js wraps them as
 *      `/_next/image?url=...` (because the inner `?` ends the `url=`
 *      value). The proxy URL has no query string, so the optimizer
 *      receives it intact.
 *   3. CDN-friendly: a `max-age=31536000, immutable` response is
 *      cacheable by Cloudflare and any other layer downstream.
 *
 * Base URL resolution (in priority order):
 *   1. PUBLIC_FILES_BASE — explicit override, e.g.
 *      `https://api.throttlein.com/api/files`.
 *   2. PUBLIC_API_URL    — generic API origin; we append `/files`.
 *   3. The default local-dev value so the dev environment works
 *      out of the box.
 */
function publicFilesBase() {
  // Explicit override always wins — set this to a CDN domain or any
  // other URL prefix you want all public images to be rooted under.
  if (env.PUBLIC_FILES_BASE) {
    return String(env.PUBLIC_FILES_BASE).replace(/\/+$/, '');
  }
  // Direct virtual-hosted S3 URL. Emits something like
  // https://throttlein.s3.ap-south-1.amazonaws.com — permanent, no
  // signature, no expiry, no /_next/image query-string trap. Requires
  // the bucket policy to allow public s3:GetObject on the public
  // prefixes (products, sellers slash slug slash products, banners,
  // brands, categories, blogs-images). KYC and return-evidence keys
  // never flow through this function — they go through presignKey().
  if (env.S3_BUCKET_NAME && env.AWS_REGION) {
    // The environment folder is part of the object path, so it is part of the
    // base. (A PUBLIC_FILES_BASE override must include it itself when it fronts
    // the bucket directly; the /api/files proxy adds it.)
    return `https://${env.S3_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com${S3_KEY_PREFIX ? `/${S3_KEY_PREFIX.slice(0, -1)}` : ''}`;
  }
  // Fallback — the backend /api/files proxy. Used in disk-mode dev
  // and any environment where S3 isn't configured.
  if (env.PUBLIC_API_URL) {
    return `${String(env.PUBLIC_API_URL).replace(/\/+$/, '')}/files`;
  }
  return 'http://localhost:5000/api/files';
}

function publicFileUrl(value) {
  if (!value) return '';
  // Already-absolute URLs and disk-mode paths short-circuit so this is
  // safe to call on any stored value without first checking the mode.
  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
  if (value.startsWith('/uploads/')) return value;
  // Frontend-static asset — served by the Next.js app itself, pass through.
  if (value.startsWith('/images/')) return value;

  const key = normaliseToKey(value);
  if (!key) return value;
  return `${publicFilesBase()}/${key}`;
}

/**
 * Presigner — only used for private fields like KYC documents and
 * return-request evidence where access should be time-limited. Public
 * images (products, brands, categories, banners, blog covers, etc.)
 * use `publicFileUrl` instead.
 */
async function presignKey(value, expiresIn = 3600) {
  if (!value) return '';
  const key = canonicalPrivateKey(value);
  if (/^\/(private-uploads|uploads)\//.test(key)) return signDiskFile(key, expiresIn);
  if (!s3Client) throw new Error('Private storage is unavailable.');
  return getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: toObjectKey(key),
      ResponseCacheControl: 'private, no-store',
      ResponseContentDisposition: 'attachment',
    }),
    { expiresIn: Math.min(3600, expiresIn) },
  );
}

// Public export links have a separate signer and cannot reach private prefixes.
async function presignPublicKey(value, expiresIn = 3600) {
  const key = normaliseToKey(value);
  if (
    !key ||
    key.includes('..') ||
    /(^|\/)(kyc|return-evidence)(\/|$)/.test(key) ||
    !/^(products\/|sellers\/[^/]+\/products\/)/.test(key)
  )
    throw new Error('Invalid public image key.');
  if (!s3Client) return publicFileUrl(value);
  return getSignedUrl(s3Client, new GetObjectCommand({ Bucket: env.S3_BUCKET_NAME, Key: toObjectKey(key) }), {
    expiresIn,
  });
}

module.exports = { fileToUrl, deleteKey, deletePrefix, publicFileUrl, presignKey, presignPublicKey };
