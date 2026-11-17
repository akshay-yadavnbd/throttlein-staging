/** Printable mock documents: shipping label, tax invoice, manifest (real order data when it exists). */
const { LOGO_SVG, shell, barcodeBars, barcode, esc, inr } = require('./html');
const { findOrderByAwbOrShipment, findOrderBySrId } = require('./lookups');

/**
 * GET /api/mock/label/:awb
 *
 * Pretty HTML shipping label populated with real order data. Printable via Ctrl+P.
 */
async function labelPage(req, res) {
  // URL param may actually be the shipment_id (that's what generateLabel
  // passes); findOrderByAwbOrShipment accepts either.
  const key = req.params.awb || 'UNKNOWN';
  res.set('Content-Type', 'text/html; charset=utf-8');

  let found = null;
  try {
    found = await findOrderByAwbOrShipment(key);
  } catch (_) {}

  // Default-fallback values if we can't resolve the key to a real order.
  const seller = found?.seller || null;
  /** @type {PostalAddress} */
  const sellerAddr = seller?.kyc?.pickupAddress || {};
  const sellerName = seller?.storeName || seller?.name || 'NBD Gearzz';

  /** @type {PostalAddress} */
  const shipTo = found?.order?.shippingAddress || {};
  const courierName = found?.shipment?.awbCourier || 'MockExpress';
  const orderNumber = found?.order?.orderNumber || '—';
  const awb = found?.shipment?.awbCode || key;
  const items = found?.order?.items?.filter((it) => String(it.seller) === String(seller?._id || '')) || [];
  const paymentMethod = (found?.order?.paymentMethod || 'cod').toUpperCase();
  const paymentLabel = paymentMethod === 'COD' ? 'COD' : 'PREPAID';

  const createdAt = found?.order?.createdAt ? new Date(found.order.createdAt) : new Date();
  const invoiceDate = createdAt.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // Invoice number derived from the order number — last segment after the dash.
  const invoiceNo = orderNumber.replace(/^TIN-/, 'INV').replace(/-/g, '');

  // Routing code — two-letter origin / destination derived from pincodes.
  const pinOrigin = String(sellerAddr.pincode || '000000').slice(0, 3);
  const pinDest = String(shipTo.pincode || '000000').slice(0, 3);
  const routingCode = `${pinOrigin}/${pinDest}`;

  // Total weight (kg) — sum of item weights, min 0.5 to match Shiprocket payload.
  const totalQty = items.reduce((s, it) => s + (it.quantity || 0), 0) || 1;
  const weightKg = Math.max(0.5, totalQty * 0.5).toFixed(2);

  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Shipping label · ${esc(awb)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                   "Helvetica Neue", Arial, sans-serif;
      margin: 0; padding: 24px; background: #f4f4f5; color: #141414;
      font-weight: 400;
    }
    .label {
      width: 460px; margin: 0 auto; background: white;
      border: 1.5px solid #141414; border-radius: 4px;
    }
    .stamp-wrap { text-align: center; padding: 6px 0 0; }
    .stamp {
      display: inline-block; padding: 3px 10px; border-radius: 999px;
      font-size: 9px; font-weight: 600; letter-spacing: 0.14em;
      text-transform: uppercase; background: #fef3c7; color: #92400e;
      border: 1px solid #fde68a;
    }
    .section { border-bottom: 1.5px solid #141414; padding: 12px 14px; }
    .section:last-child { border-bottom: none; }
    .section h3 {
      margin: 0 0 6px; font-size: 12px; font-weight: 700;
      letter-spacing: 0.01em; color: #141414;
    }
    .section h3 .hint { font-size: 10px; font-weight: 400; color: #52525b; }
    .section p { margin: 1px 0; font-size: 12px; line-height: 1.45; color: #18181b; }
    .grid-2 {
      display: grid; grid-template-columns: 1fr 200px; gap: 12px;
    }
    .grid-2 .right {
      border-left: 1.5px solid #141414; padding-left: 12px; margin-left: -12px;
      display: flex; flex-direction: column; gap: 4px;
    }
    .brand-corner {
      display: flex; align-items: center; justify-content: center;
      min-height: 50px;
    }
    .brand-corner svg { width: 120px; height: auto; }
    .kv { font-size: 11.5px; line-height: 1.6; }
    .kv .k { color: #18181b; display: inline-block; width: 92px; font-weight: 600; }
    .kv .v { color: #18181b; }
    .courier-name {
      text-align: center; font-size: 14px; font-weight: 700;
      letter-spacing: 0.02em; padding-bottom: 4px;
    }
    .barcode {
      height: 56px; display: flex; gap: 1.5px; justify-content: center;
      align-items: stretch; padding: 4px 0;
    }
    .barcode span {
      display: inline-block; background: #141414;
    }
    .barcode-num {
      text-align: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px; font-weight: 600; letter-spacing: 0.06em;
    }
    .routing {
      text-align: center; font-size: 11.5px; padding-top: 4px;
    }
    .routing strong { font-weight: 700; }
    .order-info { font-size: 11.5px; line-height: 1.5; }
    .order-info .order-num {
      font-weight: 700; font-size: 12.5px; margin-bottom: 2px;
    }
    .barcode-small {
      height: 36px; display: flex; gap: 1px; justify-content: flex-start;
      align-items: stretch; margin: 4px 0;
    }
    .barcode-small span { display: inline-block; background: #141414; }
    table.products { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    table.products th, table.products td {
      padding: 4px 6px; text-align: left; border-bottom: 1px solid #e4e4e7;
    }
    table.products th {
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
      color: #52525b; font-weight: 700; border-bottom: 1px solid #141414;
    }
    .footer-text { font-size: 10px; color: #52525b; line-height: 1.5; }
    @media print {
      body { background: white; padding: 0; }
      .label { border: 1.5px solid #141414; }
    }
  </style>
</head>
<body>
  <div class="stamp-wrap"><span class="stamp">Mock · Dev mode</span></div>
  <div class="label">
    <!-- 1. Ship To + brand corner -->
    <div class="section grid-2">
      <div>
        <h3>Ship To</h3>
        <p><strong>${esc(shipTo.fullName || 'Customer')}</strong></p>
        <p>${esc(shipTo.line1 || '')}</p>
        ${shipTo.line2 ? `<p>${esc(shipTo.line2)}</p>` : ''}
        <p>${esc([shipTo.city, shipTo.state, shipTo.country || 'India'].filter(Boolean).join(', '))}</p>
        <p>${esc(shipTo.pincode || '')}</p>
      </div>
      <div class="brand-corner">
        ${LOGO_SVG}
      </div>
    </div>

    <!-- 2. Dimensions / Payment / Weight on left, courier + barcode + routing on right -->
    <div class="section grid-2">
      <div class="kv">
        <div><span class="k">Dimensions:</span><span class="v">15×15×10 cm</span></div>
        <div><span class="k">Payment:</span><span class="v"><strong>${esc(paymentLabel)}</strong></span></div>
        <div><span class="k">Weight:</span><span class="v">${esc(weightKg)} KG</span></div>
        <div><span class="k">eWaybill No.:</span><span class="v">N/A</span></div>
      </div>
      <div class="right">
        <div class="courier-name">${esc(courierName)} Surface</div>
        ${barcode(awb)}
        <div class="barcode-num">${esc(awb)}</div>
        <div class="routing">Routing Code: <strong>${esc(routingCode)}</strong></div>
      </div>
    </div>

    <!-- 3. Shipped By on left, Order info on right -->
    <div class="section grid-2">
      <div>
        <h3>Shipped By <span class="hint">(If undelivered, return to)</span></h3>
        <p><strong>${esc(sellerName)}</strong></p>
        <p>${esc(sellerAddr.line1 || 'Pickup address')}</p>
        ${sellerAddr.line2 ? `<p>${esc(sellerAddr.line2)}</p>` : ''}
        <p>${esc([sellerAddr.city, sellerAddr.state].filter(Boolean).join(', '))}</p>
        <p>${esc(sellerAddr.pincode || '')}</p>
        ${seller?.kyc?.gstin ? `<p style="margin-top:2px"><strong>GSTIN:</strong> ${esc(seller.kyc.gstin)}</p>` : ''}
      </div>
      <div class="order-info">
        <div class="order-num">Order #: ${esc(orderNumber)}</div>
        <div class="barcode-small">${barcodeBars(orderNumber, 30)}</div>
        <div>Invoice No.: <strong>${esc(invoiceNo)}</strong></div>
        <div>Invoice Date: ${esc(invoiceDate)}</div>
      </div>
    </div>

    <!-- 4. Product Name & SKU -->
    <div class="section">
      <h3>Product Name &amp; SKU</h3>
      ${
        items.length
          ? `
        <table class="products">
          <tbody>
            ${items
              .map(
                (it) => `
              <tr>
                <td>${esc(it.name)}${it.size ? ` · Size ${esc(it.size)}` : ''}</td>
                <td style="text-align:right">SKU: ${esc(
                  String(it.product || '')
                    .slice(-10)
                    .toUpperCase(),
                )}</td>
                <td style="text-align:right;width:30px">×${esc(it.quantity)}</td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      `
          : `<p>Mock product · SKU: ${esc(awb.slice(-10))}</p>`
      }
    </div>

    <!-- 5. Footer disclaimer -->
    <div class="section">
      <div class="footer-text">
        All disputes are subject to ${esc(sellerAddr.state || 'India')} jurisdiction only.
        Goods once sold will only be taken back or exchanged as per the store's exchange / return policy.
      </div>
    </div>
  </div>
</body>
</html>`);
}

/**
 * GET /api/mock/invoice/:orderId
 *
 * Pretty HTML tax invoice populated with real order data.
 */

async function invoicePage(req, res) {
  const orderId = req.params.orderId || 'UNKNOWN';
  const today = new Date().toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  res.set('Content-Type', 'text/html; charset=utf-8');

  let found = null;
  try {
    found = await findOrderBySrId(orderId);
  } catch (_) {}

  const seller = found?.seller || null;
  /** @type {PostalAddress} */
  const sellerAddr = seller?.kyc?.pickupAddress || {};
  const sellerName = seller?.storeName || seller?.name || 'NBD Gearzz';
  const order = found?.order || null;
  /** @type {PostalAddress} */
  const shipTo = order?.shippingAddress || {};

  // Only the seller's items (filter order.items by seller id).
  const items = (order?.items || []).filter((it) => String(it.seller) === String(seller?._id || ''));
  const itemsToShow = items.length
    ? items
    : [{ name: 'Sample product (mock)', quantity: 1, price: 1000, subtotal: 1000 }];
  const sub = itemsToShow.reduce((s, it) => s + (it.subtotal || it.price * it.quantity || 0), 0);
  const gst = Math.round(sub * 0.18 * 100) / 100;
  const total = sub + gst;

  res.send(
    shell({
      title: `Invoice · ${orderId}`,
      body: `
      <h1>Tax Invoice</h1>
      <div class="muted">${order ? `Order ${esc(order.orderNumber)} · ` : ''}Generated ${esc(today)}</div>

      <div class="row">
        <div class="box">
          <h3>Order Fulfilled by</h3>
          <p><strong>${esc(sellerName)}</strong></p>
          <p>${esc(sellerAddr.line1 || 'Pickup address')}</p>
          ${sellerAddr.line2 ? `<p>${esc(sellerAddr.line2)}</p>` : ''}
          <p>${esc([sellerAddr.city, sellerAddr.state, sellerAddr.pincode].filter(Boolean).join(', '))}</p>
          ${seller?.kyc?.gstin ? `<p style="margin-top:6px;color:#52525b">GSTIN: ${esc(seller.kyc.gstin)}</p>` : ''}
          ${seller?.kyc?.pan ? `<p style="color:#52525b">PAN: ${esc(seller.kyc.pan)}</p>` : ''}
        </div>
        <div class="box">
          <h3>Billed to</h3>
          <p><strong>${esc(shipTo.fullName || 'Customer')}</strong></p>
          <p>${esc(shipTo.line1 || '')}</p>
          ${shipTo.line2 ? `<p>${esc(shipTo.line2)}</p>` : ''}
          <p>${esc([shipTo.city, shipTo.state, shipTo.pincode].filter(Boolean).join(', '))}</p>
          ${shipTo.country ? `<p>${esc(shipTo.country)}</p>` : ''}
          ${shipTo.phone ? `<p style="margin-top:6px;color:#52525b">Phone: ${esc(shipTo.phone)}</p>` : ''}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th class="right">Qty</th>
            <th class="right">Unit</th>
            <th class="right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsToShow
            .map(
              (it) => `
            <tr>
              <td>${esc(it.name)}${it.size ? ` <span style="color:#71717a">· Size ${esc(it.size)}</span>` : ''}</td>
              <td class="right">${esc(it.quantity)}</td>
              <td class="right">₹${inr(it.price)}</td>
              <td class="right">₹${inr(it.subtotal || it.price * it.quantity)}</td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>

      <div class="totals">
        <div style="display:flex;justify-content:space-between;padding:4px 0">
          <span>Subtotal</span><span>₹${inr(sub)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0">
          <span>GST (18%)</span><span>₹${inr(gst)}</span>
        </div>
        <div style="display:flex;justify-content:space-between" class="grand">
          <span>Total</span><span>₹${inr(total)}</span>
        </div>
      </div>

      <div class="footer">
        <strong>This is a mock invoice for development use only.</strong>
        Real tax invoices include the seller's signature and are served via
        Shiprocket once <code>SHIPROCKET_MOCK_MODE=false</code> and the wallet
        is funded.
      </div>
    `,
    }),
  );
}

const { manifestPage } = require('./manifest-page');
module.exports = { labelPage, invoicePage, manifestPage };
