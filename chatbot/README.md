# Throttlein Assistant (`chatbot/`)

A floating AI assistant on the **seller dashboard** and the **superadmin panel** that
helps manage products: find and review listings, check stock and pricing, and make
changes by asking — "set RH-100 to ₹1,299", "put all my jackets in draft", "which
products are low on stock?". Powered by Groq (`qwen/qwen3.8-27b`) with tool calling.

It is a separate service in this folder with its own `package.json`, process and `.env`.

## How it is wired

```
dashboard (seller / admin)  ──widget.js──▶  chatbot (this service, :5100)
                                               │  Groq: model + tool calls
                                               │  MCP server (in-process): product tools
                                               └──user's own JWT──▶  Throttlein API /api/*
```

- **No database access.** The service never connects to MongoDB. Every fact it learns
  and every change it makes goes through the public API, called with the signed-in
  user's own JWT — the same routes and the same ownership rules as the dashboards.
- **Identity from the API.** Each request's bearer token is checked with
  `GET /api/auth/me`; only `seller` and `superadmin` are admitted (staff and customers
  get 403, and the widget stays hidden for them).
- **Tools are the whole capability.** The model acts only through an MCP server
  (`src/mcp/server.js`) whose tools (`src/mcp/tools.js`) wrap an allow-list of product
  routes (`src/backend.js`). There is no tool for orders, payouts, customers, other
  sellers, staff, code or anything else — so there is nothing to leak or break even if
  the prompt is subverted.
- **A seller sees only their own products.** Seller tools read `GET /products/mine` and
  write to `PUT /products/:id`, which the API refuses for products they don't own.
  Superadmin tools use the admin product routes; seller contact details are stripped
  from results.
- **Every change is two-step.** A write tool's first call returns a preview (current →
  new) and a signed confirmation bound to the user, the tool and the exact arguments
  (5 minutes). The change runs only when the same call returns with that confirmation
  after the user agrees. The widget shows "Yes, apply it / Cancel" chips.
- **Scope guardrails.** The system prompt limits the assistant to product work and
  tells it to decline coding, general tasks, other sellers' data and anything unethical;
  obvious jailbreak phrases are answered with a canned refusal without calling the
  model; seller-written text (descriptions) reaches the model marked
  `{untrusted: true}`; messages, history and tool results are size-bounded; 20
  messages/minute per user.
- **Logging.** One JSON line per chat and per tool call (user email, tool, outcome,
  whether a change was applied). Message text is never logged.

## Run it

```bash
cd chatbot
cp .env.example .env     # set GROQ_API_KEY, CHATBOT_SECRET, BACKEND_API_URL, ALLOWED_ORIGINS
npm install
npm start                # http://127.0.0.1:5100
npm test                 # offline: fake API + fake Groq
```

Deployed servers run it as the `assistant` container from `docker-compose.yml`, built
and shipped by `.github/workflows/deploy.yml` like the other apps (host port
`CHATBOT_PORT`: 5200 production, 5201 staging; config from `chatbot.env` next to the
API's `.env`). Nginx proxies `assistant.<domain>` to it, and the frontend and admin
builds get `NEXT_PUBLIC_CHATBOT_URL=https://assistant.<domain>`; without it a
production build hides the widget. `ALLOWED_ORIGINS` must list the dashboard origins.
One-time setup: `docs/STAGING.md`, section 8.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /health` | liveness and model name |
| `GET /widget.js` | the floating widget (Shadow DOM, no host CSS conflicts) |
| `GET /session` | bearer → `{ user: {name, role, storeName}, tools, suggestions }` or 401/403 |
| `POST /chat` | `{ messages:[{role, content}], pending? }` → `{ reply, awaitingConfirmation, pending, actions }` |

The browser keeps the conversation (last 20 messages, this tab only) and sends it with
each message; `pending` carries a previewed change between turns.

## Tools

| Tool | Who | Does |
| --- | --- | --- |
| `catalog_summary` | seller | counts by status, low stock, products without images, recent updates |
| `list_my_products` | seller | own products with search, status and stock filters |
| `get_product` | both | full detail of one product (description marked untrusted) |
| `search_products` | superadmin | all sellers' products; seller contact stripped |
| `update_product` | both | name, description, price, MRP, stock, SKU, status, colour, sizes, weight, dimensions, COD, return/exchange days, SEO, category, brand — preview → confirm |
| `set_product_status` | both | active / draft / out_of_stock (superadmin: also rejected, featured) — preview → confirm |
| `bulk_set_status` | seller | several products to active/draft — preview → confirm |
| `delete_product` | both | permanent delete — preview → confirm (the model is told to suggest draft instead) |
| `import_product_from_url` | both | fetch a public product page through the API's extractor (Groq) → draft + up to 6 photos, held server-side for 15 minutes; requires the user's confirmation that they may reuse the content |
| `create_product` | both | create from an import (photos attached) or from given details; needs name, price, SKU, weight, category id; **draft by default** — preview → confirm |
| `list_categories`, `list_brands` | both | ids for category/brand changes |
| `list_orders` | both | the seller's own orders (superadmin: every order) — new/recent, by status, by order number or customer; customer contact masked unless `reveal` |
| `get_order` | both | one order: items, payment, the seller's shipment and courier tracking, return requests. **Read-only** — shipping, cancelling and returns stay in the Orders page |

Adding a product from a web page: the user pastes a URL → the assistant asks whether
they have the right to reuse that page's content and photos → `import_product_from_url`
(the backend's `/products/import-url`, 3/min and 30/day per account) → the draft is
shown, missing fields (SKU, weight, category, price, stock) are settled →
`create_product` previews → on "yes" the product is created as a draft with its photos
for review in the dashboard. Photo bytes never enter the model's context or the
browser's conversation.

### Seller panel tools (sellers only)

| Tool | Does |
| --- | --- |
| `order_logistics` | read: attention counts (to ship, pickup failed, delivery issues, returns waiting), NDR cases, couriers + rates for an order, live tracking |
| `order_action` | confirm, ship (book courier + label, optional courier choice), reschedule pickup, retry push, cancel order, cancel shipment, remove a cancelled order from the list, NDR re-attempt / return (RTO) / fake-attempt dispute |
| `list_return_requests`, `return_action` | returns/exchanges: approve (reverse pickup), decline (reason shown to the customer), verify parcel ok/failed, raise refund, ship replacement |
| `payouts_summary` | read: due, paid to date, this week, in transit, recent weeks with UTRs |
| `list_offers`, `offer_action` | create / update / pause / resume / delete offers; product-scoped offers resolve SKUs to the seller's own products |
| `list_offline_sales`, `offline_sale_action` | record an offline sale (reduces stock) or delete one (restores it) |
| `list_media`, `delete_media` | browse the media library; delete files (files used by a product are refused) |
| `brand_category_requests` | list / create / edit / withdraw requests for a new brand or category |
| `get_store_profile`, `update_store_profile` | store settings: name, store name, phones, address, return/exchange days, COD on/off and charge, who pays delivery, excluded states/pincodes; plus account and KYC status |

Every change is preview → signed confirmation → apply; for cancellations, refunds, RTO
and shipping the preview states the consequence (refund raised, courier charge, stock
restored) and the model is told to repeat it before asking.

Not available through the assistant, on purpose: KYC and bank/payout detail changes and
the password (they redirect money or lock the owner out), media upload, and PDF labels,
invoices and manifests (Orders page). The allow-list test asserts these stay blocked.

### Tool routing

The full seller set is ~27 tools (~5,600 tokens of schemas) — more than Groq's free tier
allows per minute. `src/router.js` picks the areas a conversation touches from the last
three user messages (orders, returns, payouts, offers, offline, media, requests, profile,
catalog, import) plus the area of a pending confirmation, so a call carries ~700–2,800
tokens. If the model still needs another area it calls the local `open_area` tool and the
MCP server is rebuilt with it mid-turn.

## Integration points

- `frontend/components/common/SellerAssistant.tsx`, mounted in
  `frontend/app/dashboard/layout.tsx` — loads the widget with `seller_token`.
- `admin/components/AdminAssistant.tsx`, mounted in `admin/components/AdminShell.tsx` —
  loads the widget for `superadmin` only, with `admin_token`.
- Both read `NEXT_PUBLIC_CHATBOT_URL` (default `http://localhost:5100`).
- After a change is applied the widget dispatches `throttlein-assistant:changed` on
  `window` with `{ actions }`, so a page can refresh its product list.
