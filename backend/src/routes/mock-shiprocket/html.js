/** HTML building blocks for the mock label / invoice / manifest pages: logo, page shell, barcode, escaping, rupees. */

/* ──────────────────────────────────────────────────────────────────────── */
/* Logo + page shell                                                        */
/* ──────────────────────────────────────────────────────────────────────── */

/** Inline THROTTLEIN wordmark — copy of /frontend/public/images/logo.svg */
const LOGO_SVG = `
<svg width="160" height="38" viewBox="0 0 888 209" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="THROTTLEIN">
  <path d="M887.28 40.67L863.89 178.89H400.07C386.39 195.48 360.71 208.01 336.24 208.01C319.06 208.01 293.52 202.94 269.35 178.77L231.97 141.19H229.99L223.69 178.89H33.84L48.96 89.65H14.21L22.52 40.67H250.79C261.2 40.67 270.32 42.69 277.87 46.69C282.17 48.96 288.14 54.12 291.21 57.48C296.32 51.51 300.27 45.42 306.39 39.4C322.05 21.73 344.95 12 370.87 12C396.79 12 420.01 22.53 435.99 40.44H789.93L807.93 40.67H887.28Z" fill="black"/>
  <path d="M873.08 52.67L853.75 166.89H827.88L796.64 106.88H795.97L785.93 166.89H754.92L774.25 52.67H800.57L831 112.46H831.89L842.07 52.67H873.08Z" fill="white"/>
  <path d="M748.35 52.6801L729.03 166.89H698.02L717.34 52.6801H748.35Z" fill="white"/>
  <path d="M559.26 51.73L539.85 166.5H676.7L680.96 141.51H637.24L640.5 122.23H673.02L677.26 97.24H644.71L648.03 77.61H691.76L696 52.62H621.28L606.22 141.5H573.71L588.87 51.71H559.26V51.73Z" fill="white"/>
  <path d="M28.4102 77.65L32.6502 52.66H118.64L114.4 77.65H93.7001L78.6102 166.89H48.0502L63.1702 77.65H28.4102Z" fill="white"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M288.9 149.82L265.49 122.49C270.31 119.81 274.43 116.37 277.84 112.18C282.41 106.57 285.37 99.67 286.71 91.49C288.05 83.39 287.43 76.43 284.87 70.63C282.3 64.83 278.1 60.39 272.27 57.3C266.43 54.21 259.28 52.67 250.8 52.67H201.81L192.91 105.17H151.88L160.75 52.67H129.73L110.42 166.89H141.43L147.91 128.68H188.94L182.48 166.89H213.55L219.85 129.19H236.97L277.85 170.29C318.48 210.92 369.67 196.72 388.83 173.48C388.72 173.54 388.6 173.6 388.49 173.67C377.93 179.59 365.74 182.96 352.77 182.96C324.51 182.96 304.9 168.94 288.9 149.83V149.82ZM223.86 105.09H234.73C238.37 105.09 241.57 104.64 244.32 103.75C247.07 102.82 249.3 101.37 251.01 99.4C252.72 97.39 253.84 94.75 254.36 91.48C254.88 88.21 254.62 85.55 253.58 83.51C252.54 81.43 250.81 79.9 248.39 78.94C245.97 77.94 242.98 77.43 239.41 77.43H228.48L223.86 105.09Z" fill="white"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M352.86 166.89C384.4 166.89 409.97 141.32 409.97 109.78C409.97 78.24 384.4 52.67 352.86 52.67C321.32 52.67 295.75 78.24 295.75 109.78C295.75 141.32 321.32 166.89 352.86 166.89ZM363.94 89.85L352.86 76.89L341.78 89.85L324.74 90.43L327.96 107.17L317.79 120.85L332.89 128.77L337.25 145.25L352.86 138.38L368.46 145.25L372.82 128.77L387.92 120.85L377.75 107.17L380.97 90.43L363.93 89.85H363.94Z" fill="#BDFF00"/>
  <path d="M430.53 52.67C417.61 35.56 395.49 24 370.88 24C348.68 24 329.02 31.98 315.38 47.36C326.39 40.67 339.32 36.82 353.15 36.82C370.3 36.82 386.07 42.75 398.51 52.66C398.65 52.77 398.79 52.88 398.93 52.99L398.97 53.03L399.09 53.13L399.18 53.2C399.61 53.57 400.06 53.95 400.54 54.34C408.04 60.77 414.22 68.7 418.61 77.66H428.98L414.26 166.9H444.82L459.9 77.66H491.79L476.71 166.9H507.27L522.37 77.66H543.73L547.96 52.67H430.55H430.53Z" fill="white"/>
</svg>`;

/** Common page shell — print-friendly */
function shell({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                   "Helvetica Neue", Arial, sans-serif;
      margin: 0; padding: 24px; background: #f4f4f5; color: #141414;
      font-weight: 400;
    }
    .page {
      max-width: 680px; margin: 0 auto; background: white;
      border: 2px dashed #d4d4d8; border-radius: 12px; padding: 28px;
    }
    .header {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 16px; padding-bottom: 18px; border-bottom: 1px solid #e4e4e7;
    }
    .header .brand { display: flex; flex-direction: column; gap: 6px; }
    .brand-mark {
      display: inline-flex; align-items: center; width: fit-content;
    }
    .brand-sub { font-size: 11px; color: #71717a; letter-spacing: 0.05em; }
    .stamp {
      display: inline-block; padding: 4px 10px; border-radius: 999px;
      font-size: 10px; font-weight: 600; letter-spacing: 0.12em;
      text-transform: uppercase; background: #fef3c7; color: #92400e;
      border: 1px solid #fde68a; align-self: flex-start;
    }
    h1 { margin: 18px 0 4px; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
    .muted { color: #71717a; font-size: 12px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 18px; }
    .box {
      border: 1px solid #e4e4e7; border-radius: 8px; padding: 14px;
    }
    .box h3 {
      margin: 0 0 6px; font-size: 10px; letter-spacing: 0.18em;
      text-transform: uppercase; color: #71717a; font-weight: 600;
    }
    .box p { margin: 2px 0; font-size: 13px; line-height: 1.5; }
    .awb {
      margin-top: 22px; padding: 18px; background: #141414; color: white;
      border-radius: 10px; text-align: center;
    }
    .awb-label {
      font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase;
      color: #a1a1aa;
    }
    .awb-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 22px; font-weight: 600; margin-top: 4px;
      letter-spacing: 0.05em;
    }
    .barcode {
      margin-top: 12px; height: 48px; display: flex; gap: 1.5px;
      justify-content: center; align-items: center;
    }
    .barcode span {
      display: inline-block; height: 100%; background: white;
    }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
    th, td { padding: 8px 6px; text-align: left; border-bottom: 1px solid #e4e4e7; }
    th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #71717a; font-weight: 600; }
    .totals { margin-top: 12px; font-size: 13px; }
    .totals .grand { font-size: 15px; font-weight: 600; padding-top: 6px; border-top: 1px solid #141414; margin-top: 6px; }
    .right { text-align: right; }
    .footer { margin-top: 22px; padding-top: 14px; border-top: 1px dashed #d4d4d8; font-size: 11px; color: #71717a; line-height: 1.6; }
    /* Small legal-entity line at the very bottom of every generated
       document. Kept muted (~9px, light grey) so the primary
       Throttlein branding at the top stays visually dominant while
       still meeting the "operator name on invoice" requirement. */
    .entity-footer {
      margin: 24px 0 0;
      padding-top: 10px;
      border-top: 1px solid #eeeeee;
      text-align: center;
      font-size: 9px;
      letter-spacing: 0.06em;
      color: #a1a1aa;
    }
    @media print {
      body { background: white; padding: 0; }
      .page { border: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="brand">
        <span class="brand-mark">${LOGO_SVG}</span>
      </div>
      <span class="stamp">Mock · Dev mode</span>
    </div>
    ${body}
    <!-- Legal footprint — required on tax invoices in India. Kept small
         and greyed out at the very bottom so Throttlein stays the
         visual brand while Noseberry Pvt Ltd (the operating entity)
         still appears for GST / compliance purposes. -->
    <p class="entity-footer">
      Operated by Noseberry Pvt Ltd &middot; A Noseberry Digitals company &middot; India
    </p>
  </div>
</body>
</html>`;
}

/**
 * Build a barcode-ish stripe pattern. Two flavors:
 *   - `barcode(seed)`       → full wrapper `<div class="barcode">…</div>`
 *   - `barcodeBars(seed, n)` → just the inner <span> bars, for inline use
 */
function barcodeBars(seed = '', count = 40) {
  const bars = [];
  const s = String(seed) || String(Date.now());
  for (let i = 0; i < count; i += 1) {
    const w = (s.charCodeAt(i % s.length) % 4) + 1;
    bars.push(`<span style="width:${w}px"></span>`);
  }
  return bars.join('');
}
function barcode(seed = '') {
  return `<div class="barcode">${barcodeBars(seed, 40)}</div>`;
}

function esc(s) {
  return String(s ?? '').replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function inr(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = { LOGO_SVG, shell, barcodeBars, barcode, esc, inr };
