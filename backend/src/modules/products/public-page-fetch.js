'use strict';
const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');
const { AppError } = require('../../errors/AppError');

const fail = (message) => AppError.unprocessable(message);
// Only public IPv4 destinations. IPv6-only origins are deliberately unsupported.
// DNS is resolved once per hop and pinned to the TLS connection to prevent rebinding.
function publicIPv4(ip) {
  if (net.isIP(ip) !== 4) return false;
  if (ip === '168.63.129.16') return false; // Azure platform virtual IP
  const [a, b, c] = ip.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0 && c === 113)
  );
}
function parsePublicUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw fail('Enter a valid public HTTPS product URL.');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail('Enter a valid public HTTPS product URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw fail('Only HTTPS URLs without credentials or custom ports are supported.');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !host.includes('.') ||
    /(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host) ||
    (net.isIP(host) && !publicIPv4(host)) ||
    host.includes(':')
  ) {
    throw fail('Private or local network URLs are not allowed.');
  }
  url.hash = '';
  return url;
}
async function publicPageFetch(
  value,
  {
    maxBytes = 2 * 1024 * 1024,
    timeoutMs = 12000,
    accept = 'text/html,application/xhtml+xml',
    lookup = dns.resolve4,
    request = https.get,
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop <= 3; hop++) {
    const url = parsePublicUrl(value);
    let timer;
    const remaining = () => Math.max(1, deadline - Date.now());
    const addresses = await Promise.race([
      net.isIP(url.hostname) ? Promise.resolve([url.hostname]) : lookup(url.hostname),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(fail('The source website timed out.')), remaining());
      }),
    ]).finally(() => clearTimeout(timer));
    if (!addresses.length || addresses.some((ip) => !publicIPv4(ip)))
      throw fail('Private or local network destinations are not allowed.');
    if (Date.now() >= deadline) throw fail('The source website timed out.');
    const result = await new Promise((resolve, reject) => {
      let req;
      const timeout = setTimeout(() => req?.destroy(fail('The source website timed out.')), remaining());
      req = request(
        url,
        {
          agent: false,
          family: 4,
          lookup: (_host, options, cb) =>
            options?.all ? cb(null, [{ address: addresses[0], family: 4 }]) : cb(null, addresses[0], 4),
          headers: { Accept: accept, 'Accept-Encoding': 'identity', 'User-Agent': 'ThrottleIn-ProductImporter/1.0' },
        },
        (res) => {
          const status = res.statusCode;
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
            res.destroy();
            resolve({ redirect: new URL(res.headers.location, url).href });
            return;
          }
          if (status !== 200) {
            res.destroy();
            reject(fail('This page is unavailable or blocks automated imports. Add the product manually.'));
            return;
          }
          const mime = String(res.headers['content-type'] || '')
            .split(';')[0]
            .trim()
            .toLowerCase();
          if (
            !accept.split(',').includes(mime) ||
            (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')
          ) {
            res.destroy();
            reject(fail('The source returned an unsupported format.'));
            return;
          }
          if (Number(res.headers['content-length']) > maxBytes) {
            res.destroy();
            reject(fail('The source file is too large to import.'));
            return;
          }
          let size = 0;
          const chunks = [];
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) res.destroy(fail('The source file is too large to import.'));
            else chunks.push(chunk);
          });
          res.on('error', reject);
          res.on('aborted', () => reject(fail('The source download was interrupted.')));
          res.on('end', () => resolve({ url: url.href, mime, body: Buffer.concat(chunks) }));
        },
      );
      req.on('error', () =>
        reject(fail('Could not securely fetch the source. It may block imports or be unavailable.')),
      );
      req.on('close', () => clearTimeout(timeout));
    });
    if (!result.redirect) return result;
    value = result.redirect;
  }
  throw fail('The source redirects too many times. Use the final product URL.');
}
module.exports = { publicPageFetch, parsePublicUrl, publicIPv4 };
