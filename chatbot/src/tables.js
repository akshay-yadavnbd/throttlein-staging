/**
 * Lists the widget shows as a real, paginated table instead of rows the model
 * types out. The model's reply is token-limited (a 50-row markdown table does
 * not fit), so when a list tool runs, the chat reply carries a small
 * descriptor { tool, args, total } and the widget pages through the full
 * result via GET-like POST /table — no model involved, same JWT, same tools,
 * read-only and allow-listed here.
 */
'use strict';
const z = require('zod/v4');
const { toolsFor, ToolError } = require('./mcp/tools');

const text = (v) => (v && typeof v === 'object' && 'text' in v ? v.text : v);
const date = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

const PRODUCT_COLUMNS = [
  { key: 'name', label: 'Product', kind: 'name' },
  { key: 'sku', label: 'SKU', kind: 'code' },
  { key: 'stock', label: 'Stock', kind: 'num' },
  { key: 'price', label: 'Price', kind: 'money' },
  { key: 'status', label: 'Status', kind: 'status' },
];
// `ref` is not a column: it is what the dashboard links the row to (product slug or id, order number).
const productRow = (p) => ({ ref: p.slug || p.id || null, name: text(p.name), sku: p.sku, stock: p.stock, price: p.price, status: p.status });

const TABLES = {
  list_my_products: { link: 'product', columns: PRODUCT_COLUMNS, rows: (r) => r.products, row: productRow },
  search_products: {
    link: 'product',
    columns: [...PRODUCT_COLUMNS, { key: 'seller', label: 'Seller', kind: 'text' }],
    rows: (r) => r.products,
    row: (p) => ({ ...productRow(p), seller: p.seller?.store || null }),
  },
  top_selling_products: {
    link: 'product',
    columns: [
      { key: 'rank', label: 'Rank', kind: 'num' },
      { key: 'name', label: 'Product', kind: 'name' },
      { key: 'sku', label: 'SKU', kind: 'code' },
      { key: 'unitsSold', label: 'Units sold', kind: 'num' },
      { key: 'revenue', label: 'Revenue', kind: 'money' },
      { key: 'orders', label: 'Orders', kind: 'num' },
      { key: 'currentStock', label: 'Stock', kind: 'num' },
      { key: 'status', label: 'Status', kind: 'status' },
    ],
    rows: (r) => r.products,
    row: (p) => ({ ref: p.slug || p.id || null, rank: p.rank, name: text(p.name), sku: p.sku, unitsSold: p.unitsSold, revenue: p.revenue, orders: p.orders, currentStock: p.currentStock, status: p.status }),
  },
  list_orders: {
    link: 'order',
    columns: [
      { key: 'orderNumber', label: 'Order', kind: 'code' },
      { key: 'placedAt', label: 'Date', kind: 'text' },
      { key: 'customer', label: 'Customer', kind: 'text' },
      { key: 'items', label: 'Items', kind: 'num' },
      { key: 'amount', label: 'Amount', kind: 'money' },
      { key: 'status', label: 'Status', kind: 'status' },
    ],
    rows: (r) => r.orders,
    row: (o) => ({ ref: o.orderNumber || null, orderNumber: o.orderNumber, placedAt: date(o.placedAt), customer: text(o.customer?.name) || null, items: (o.items || []).reduce((n, it) => n + (Number(it.quantity) || 1), 0), amount: o.amount, status: o.overallStatus || o.status }),
  },
};

/** Arguments that define the list (filters), minus paging and anything sensitive. */
function listArgs(args) {
  const { limit, offset, page, reveal, ...rest } = args || {};
  return rest;
}

const PAGE_SIZES = [10, 25, 50];

async function runTable({ tool, args, page, pageSize }, ctx) {
  const spec = TABLES[tool];
  const def = toolsFor(ctx.user.role).find((t) => t.name === tool);
  if (!spec || !def || def.write) throw new ToolError('INVALID_ARGUMENT', 'That list cannot be shown as a table.');
  const size = PAGE_SIZES.includes(Number(pageSize)) ? Number(pageSize) : 10;
  const p = Math.max(1, Math.min(10000, parseInt(page, 10) || 1));
  const input = z.object(def.input || {}).strip().parse({ ...listArgs(args), limit: size, offset: (p - 1) * size });
  const result = await def.run(input, ctx);
  const rows = (spec.rows(result) || []).map(spec.row);
  return { tool, link: spec.link || null, columns: spec.columns, rows, total: Number(result.total) || rows.length, page: p, pageSize: size };
}

module.exports = { TABLES, runTable, listArgs, PAGE_SIZES };
