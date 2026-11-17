/**
 * Server-side file proxy for S3-backed uploads.
 *
 * Browsers never see S3 URLs. Instead, every uploaded file is reachable via
 *   GET /api/files/<key>
 * which uses the server's AWS credentials to stream the object back from
 * S3 (the bucket can stay fully private). Benefits:
 *
 *   1. URLs are stable + domain-consistent (throttlein.in/api/files/...).
 *   2. Bucket can be private — no public-read policy needed.
 *   3. Auth / rate limiting / signed URLs / signed cookies can be added in
 *      this one place later without touching every consumer.
 *   4. Drop-in switch later: replace S3 with another provider (R2, GCS)
 *      without changing any frontend URL.
 *
 * Local-disk mode (when S3 isn't configured) still serves files from
 * `/uploads/<filename>` via the static-files middleware in src/app.js —
 * those URLs are populated by `upload.fileToUrl` and continue to work.
 */
const express = require('express');
const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { env } = require('../config/env');
const { logger } = require('../utils/logger');
const { toObjectKey } = require('../utils/s3KeyPrefix');

const router = express.Router();

const s3Configured =
  !env.DISABLE_S3 &&
  Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_REGION && env.S3_BUCKET_NAME);

let s3 = null;
if (s3Configured) {
  s3 = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * GET /api/files/<key…>
 *
 * Key can contain slashes (e.g. products/1747934857-a3b9c2-jacket.jpg).
 * Express 5 requires NAMED wildcards — `/*key` captures the rest of the
 * path as `req.params.key` (an array of path segments). Falls back to
 * 404 if S3 isn't configured (local-disk mode uses Express static).
 */
router.get('/files/*key', async (req, res) => {
  if (!s3) {
    return res.status(404).type('text/plain').send('S3 not configured');
  }
  // Express 5 named wildcard: params.key is an ARRAY of segments
  // (['products', 'foo.jpg']). Rejoin with '/' to rebuild the S3 key.
  // Reject path traversal attempts.
  const raw = Array.isArray(req.params.key) ? req.params.key.join('/') : String(req.params.key || '');
  const key = raw.replace(/^\/+/, '');
  if (!key || key.includes('..')) {
    return res.status(400).type('text/plain').send('Bad key');
  }

  /**
   * PUBLIC-PREFIX ALLOWLIST (audit A04).
   *
   * This route is unauthenticated and marks responses publicly cacheable,
   * so it must only ever serve public media. Before this guard it accepted
   * ANY object key, which turned it into an S3 bypass for private
   * documents: KYC uploads live under `sellers/<slug>/kyc/` (and legacy
   * `kyc/`) and are meant to be reachable only through short-lived
   * presigned URLs minted for their owner/admin.
   *
   * Rules:
   *   - any path segment named `kyc` or `return-evidence` → 403, no-store
   *   - `sellers/<slug>/…` → only the `products` purpose is public
   *   - otherwise the TOP-LEVEL prefix must be a known public media root
   * Deny-by-default: an unknown prefix is refused loudly (logged) rather
   * than silently served, so a genuinely public new prefix shows up fast
   * and gets added here consciously.
   */
  const PUBLIC_ROOTS = new Set([
    'products',
    'banners',
    'brands',
    'categories',
    'blogs-images',
    'testimonials',
    'bikes',
    'media',
  ]);
  const segs = key.split('/');
  const isPrivateSeg = segs.some((s) => s === 'kyc' || s === 'return-evidence');
  const isPublic =
    !isPrivateSeg && (segs[0] === 'sellers' ? segs.length >= 3 && segs[2] === 'products' : PUBLIC_ROOTS.has(segs[0]));
  if (!isPublic) {
    logger.warn('[files proxy] refused non-public key: %s', key);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).type('text/plain').send('Access denied');
  }

  try {
    // ETag-based caching — browser sends If-None-Match, we 304 if unchanged.
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch) {
      try {
        const head = await s3.send(
          new HeadObjectCommand({
            Bucket: env.S3_BUCKET_NAME,
            Key: toObjectKey(key),
          }),
        );
        if (head.ETag && head.ETag.replace(/^"|"$/g, '') === String(ifNoneMatch).replace(/^"|"$/g, '')) {
          return res.status(304).end();
        }
      } catch (_) {
        /* fall through to GET — let GET return the real error */
      }
    }

    const out = await s3.send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET_NAME,
        // URLs carry the bare key; the environment folder is added here.
        Key: toObjectKey(key),
      }),
    );

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    if (out.ContentType) res.setHeader('Content-Type', out.ContentType);
    if (!/^image\/(png|jpeg|webp|gif|avif)$|^video\//i.test(out.ContentType || ''))
      res.setHeader('Content-Disposition', 'attachment');
    if (out.ContentLength) res.setHeader('Content-Length', out.ContentLength);
    if (out.ETag) res.setHeader('ETag', out.ETag);
    if (out.LastModified) res.setHeader('Last-Modified', out.LastModified.toUTCString());
    // Files we generate have content-addressable names (timestamp + random),
    // so they're immutable once uploaded. One-year max-age + immutable hints
    // give a clean CDN story when we put one in front of this later.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    // Stream the S3 body directly to the client — no buffering in Node memory.
    /** @type {any} */
    const body = out.Body;
    if (body && typeof body.pipe === 'function') {
      body.pipe(res);
    } else if (body && typeof body.transformToWebStream === 'function') {
      // AWS SDK v3 returns a web-stream in newer runtimes; convert to Node stream.
      const { Readable } = require('stream');
      Readable.fromWeb(body.transformToWebStream()).pipe(res);
    } else {
      // Last resort — buffer.
      const chunks = [];
      for await (const chunk of body) chunks.push(chunk);
      res.end(Buffer.concat(chunks));
    }
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NoSuchKey') {
      return res.status(404).type('text/plain').send('Not found');
    }
    if (e?.$metadata?.httpStatusCode === 403 || e?.name === 'AccessDenied') {
      return res.status(403).type('text/plain').send('Access denied');
    }
    logger.error({ err: e }, '[files proxy] %s', key);
    res.status(500).type('text/plain').send('Failed to fetch file');
  }
});

module.exports = router;
