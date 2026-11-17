/** Printable mock manifest for one or more Shiprocket shipments. */
const { ordersByShipmentIds } = require('./lookups');

/**
 * GET /api/mock/manifest/:shipmentIds
 *
 * Mock manifest — a printable HTML page listing every shipment in the
 * comma-separated id list. Shiprocket's real manifest is a PDF; this is the
 * dev-mode placeholder so clicking "Today's manifest" actually opens
 * something instead of 404-ing.
 */

async function manifestPage(req, res) {
  res.set('Content-Type', 'text/html; charset=utf-8');
  const ids = String(req.params.shipmentIds || '')
    .split(',')
    .filter(Boolean);
  const orders = await ordersByShipmentIds(ids);
  const rows = [];
  for (const o of orders) {
    for (const s of o.sellerShipments || []) {
      if (!ids.includes(String(s.shipmentId))) continue;
      rows.push({
        orderNumber: o.orderNumber,
        awb: s.awbCode,
        courier: s.awbCourier,
        customer: o.shippingAddress?.fullName,
        city: o.shippingAddress?.city,
        pincode: o.shippingAddress?.pincode,
      });
    }
  }
  const today = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
  res.send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>Manifest · ${today}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 24px; background: #f4f4f5; }
  .page { max-width: 760px; margin: 0 auto; background: white; border: 2px dashed #d4d4d8; border-radius: 12px; padding: 28px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 18px; border-bottom: 1px solid #e4e4e7; }
  .stamp { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
  h1 { margin: 18px 0 4px; font-size: 22px; font-weight: 600; }
  .muted { color: #71717a; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px; }
  th, td { padding: 8px; text-align: left; border-bottom: 1px solid #e4e4e7; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #71717a; font-weight: 600; border-bottom: 1px solid #141414; }
  .footer { margin-top: 22px; padding-top: 14px; border-top: 1px dashed #d4d4d8; font-size: 11px; color: #71717a; line-height: 1.6; }
  .sig { margin-top: 24px; display: flex; gap: 24px; }
  .sig div { flex: 1; border-top: 1px solid #141414; padding-top: 6px; font-size: 11px; color: #52525b; }
  @media print { body { background: white; padding: 0; } .page { border: none; } }
</style></head><body><div class="page">
  <div class="header"><div><h1 style="margin:0">Pickup Manifest</h1><div class="muted">Generated ${today} · ${rows.length} shipment(s)</div></div><span class="stamp">Mock · Dev mode</span></div>
  <table><thead><tr><th>#</th><th>Order</th><th>AWB</th><th>Courier</th><th>Customer</th><th>To</th></tr></thead>
  <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.orderNumber}</td><td style="font-family:monospace">${r.awb}</td><td>${r.courier}</td><td>${r.customer || ''}</td><td>${[r.city, r.pincode].filter(Boolean).join(' · ')}</td></tr>`).join('')}</tbody></table>
  <div class="sig"><div>Handed over by (signature)</div><div>Received by courier (signature + name)</div></div>
  <div class="footer"><strong>This is a mock manifest for development use only.</strong> Real manifests are PDF-rendered by Shiprocket and signed at pickup.</div>
</div></body></html>`);
}

module.exports = { manifestPage };
