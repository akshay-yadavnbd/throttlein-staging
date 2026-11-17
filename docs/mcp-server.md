# Throttlein AI connector (MCP server)

The API exposes a [Model Context Protocol](https://modelcontextprotocol.io) server at
`https://api.throttlein.com/mcp` so claude.ai, Claude Code and Claude Desktop can answer
operational questions ("which shipments failed to push", "show me TIN-2026-000123", "who is
waiting on KYC") directly from production data — **as the signed-in staff member, never more**.

It combines the two connectors we already run with: Nwatch's per-user sign-in and
"who am I" profile, and Fllat's operating model — a superadmin-controlled kill switch that
fails closed, allow-list views with a canary test, untrusted-text wrapping, a tamper-evident
audit trail, result envelopes with byte budgets, and hardened OAuth (approval periods,
refresh-reuse detection, allowed apps).

Code: `backend/src/mcp/` — `config.js` (env + derived keys), `settings.js` (superadmin
settings, ceilings), `scopes.js` (admin permission → scope), `oauth.js` (authorization
server + sign-in page), `runtime.js` (per-call pipeline), `tools.js` (the tool table),
`redact.js` (views), `output.js` (hygiene, envelope, cursors), `audit.js`, `limits.js`,
`manage.js` (admin API). Models: `McpSettings`, `McpAuditLog`, `McpOAuth`. Admin routes:
`backend/src/routes/adminMcpRoutes.js`. Tests: `npm run test:mcp --prefix backend`.

## Principles

1. **Never exceed the person.** Effective access = the staff member's live role and admin
   permissions ∩ what they granted at sign-in ∩ what the superadmin settings allow, re-derived
   on every call. Removing a permission, suspending the account or changing its password
   ends the connection immediately.
2. **Off until a superadmin turns it on.** No settings document → mode `off`. Nobody but
   superadmins may connect until added to the allow-list. Env is the ceiling, the setting is
   the level.
3. **Read-only.** Every tool is `readOnlyHint`; no write tools exist. A future write needs an
   `<area>:write` scope, its own switch and its own audit.
4. **Secrets never leave.** Views are allow-lists; a forbidden-key guard drops anything
   secret-shaped that slips through; a canary test seeds marker secrets in every sensitive
   field and runs every tool.
5. **Fail closed.** A tool result is withheld if its audit row cannot be written. A settings
   read failure means "off".
6. **Free text is data.** Reasons, notes, courier messages and addresses are sanitised,
   scrubbed of emails/phones/card/UPI/PAN/IFSC values and wrapped as `{untrusted: true, text}`.

## Server setup

Three variables in the backend `.env`:

```dotenv
MCP_ISSUER_URL=https://api.throttlein.com
MCP_MASTER_KEY=<64 hex chars: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
MCP_MAX_MODE=read
```

`MCP_ISSUER_URL` is the public origin AI apps use to reach the API (OAuth metadata and token
audience are built from it; required in production). `MCP_MASTER_KEY` is the one secret:
HKDF derives separate keys for token hashing, audit MACs, cursors and the sign-in form;
rotating it ends every connection. If either is missing or invalid the API still starts, logs
`[mcp] disabled: …`, and every MCP and `/api/admin/mcp` route answers 503.

Optional ceilings (settings can lower, never raise): `MCP_RATE_PER_MIN` (60/connection),
`MCP_USER_RATE_PER_MIN` (120/person), `MCP_DAILY_RECORDS` (5000), `MCP_MAX_CONCURRENT` (4),
`MCP_MAX_RESPONSE_BYTES` (65536), `MCP_MAX_PAGE_SIZE` (50), `MCP_TOOL_TIMEOUT_MS` (15000),
`MCP_OAUTH_ACCESS_SECONDS` (3600), `MCP_OAUTH_MAX_DAYS` (30).

Restart after changing any of them (`pm2 restart throttlein-api --update-env`).

### Nginx / Cloudflare

The OAuth endpoints live at the API root — `/.well-known/oauth-authorization-server`,
`/.well-known/oauth-protected-resource/mcp`, `/authorize`, `/token`, `/register`, `/revoke` —
and the MCP server at `/mcp`. None are under `/api`, so the Nginx server block must proxy
the whole origin (a `location /` catch-all does). Responses are plain JSON, no SSE. Check:

```bash
curl -s https://api.throttlein.com/.well-known/oauth-authorization-server
```

## Switching it on (superadmin)

Everything a superadmin changes goes through `/api/admin/mcp` with the normal admin JWT
(an MCP token is not a JWT, so an AI connection can never manage the connector):

| Endpoint | Who | What |
| --- | --- | --- |
| `GET /api/admin/mcp/me` | any staff | whether they may connect, the scopes and tools they would get, how to connect, their connections |
| `GET /api/admin/mcp/me/activity` | any staff | their own audit rows |
| `DELETE /api/admin/mcp/me/connections/:id` | the owner | end one of their connections |
| `GET /api/admin/mcp/settings` | superadmin | effective + stored settings, ceilings, staff with their scopes, tools, apps |
| `PATCH /api/admin/mcp/settings` | superadmin | one change: `{action, value, …, password?}` |
| `GET /api/admin/mcp/connections` | superadmin | every connection with owner, app, scopes, status |
| `POST /api/admin/mcp/connections/:id/revoke` | superadmin | end one connection |
| `POST /api/admin/mcp/revoke-all` | superadmin | `{confirm: "ALL", password}` ends every connection; `{user}` ends one person's |
| `GET /api/admin/mcp/activity` | superadmin | the audit trail (filters: user, tool, event, outcome, before) |
| `GET /api/admin/mcp/activity/verify` | superadmin | recompute MACs and check the sequence for gaps |

Settings actions: `mode` (off/read), `allow` (`user`, value true/false; removing a person
ends their connections), `allowContactReveal`, `allowOAuth`, `enableTool` (`tool`, value
false disables), `limits` (`{tokenPerMinute, userPerMinute, dailyRecords, concurrent,
responseBytes, pageSize}`), `allowApp` (`app`: `claude` | `local`), `addRedirectOrigin`
(`origin`, https), `approvalDays` (1..ceiling, default 7).

**A change that widens access needs the superadmin's own password** (switching on, allowing
a person, contact reveal, re-enabling a tool, raising a limit, allowing an app, lengthening
approvals); narrowing changes do not. Missing → `400 {code: "PASSWORD_REQUIRED"}`, wrong →
`422`, five wrong → locked 15 minutes. Changes take effect within 15 seconds and are recorded.

Minimum to go live:

```bash
# as a superadmin, with your admin JWT
curl -X PATCH https://api.throttlein.com/api/admin/mcp/settings -H "Authorization: Bearer $JWT" -H "content-type: application/json" \
  -d '{"action":"mode","value":"read","password":"<your password>"}'
curl -X PATCH https://api.throttlein.com/api/admin/mcp/settings -H "Authorization: Bearer $JWT" -H "content-type: application/json" \
  -d '{"action":"allow","user":"<staff user id>","value":true,"password":"<your password>"}'
```

(An admin-panel page for this is the natural next step; the API is complete.)

## Connecting

- **claude.ai**: Settings → Connectors → Add custom connector → `https://api.throttlein.com/mcp`.
  Claude registers itself, opens the Throttlein sign-in page; sign in with your admin email
  and password. The approval lasts 7 days (configurable), then you sign in again.
- **Claude Code / Claude Desktop**: `claude mcp add --transport http throttlein https://api.throttlein.com/mcp --scope user`,
  then `/mcp` → Authenticate. Tools appear as `mcp__throttlein__tin_*`.
- Only `superadmin` and `staff` accounts can sign in, and staff only if allowed. Only apps
  whose redirect address is allowed can register: presets **Claude** (`claude.ai`,
  `claude.com`) and **local apps** (`localhost`, `127.0.0.1` for Claude Code / Cursor), plus
  custom https origins.

## Scopes and tools

| Scope | Admin permission | Tools |
| --- | --- | --- |
| `profile:read` | any staff | `tin_access_whoami`, `tin_access_explain`, `tin_reference_dictionary`, `tin_ops_health`, `tin_ops_overview` |
| `orders:read` | `orders` | `tin_orders_search`, `tin_orders_get`, `tin_shipments_failed`, `tin_checkout_failures` |
| `refunds:read` | `refunds` | `tin_refunds_list` |
| `sellers:read` | `sellers` | `tin_sellers_list`, `tin_sellers_get`, `tin_products_search` |
| `kyc:read` | `kyc` | `tin_kyc_pending` |
| `settlements:read` | `settlements` | `tin_settlements_list` |
| `contact:read` | `customers` | lets a call pass `reveal: true` to unmask email/phone (also needs the superadmin switch; every reveal is recorded) |
| `ops:admin` | superadmin | `tin_ops_activity`, `tin_ops_audit_verify` |

Superadmins hold every scope. A tool whose scope the connection lacks, or that a superadmin
disabled, is not listed at all. `tin_access_whoami` — call it first — returns who is
connected, IST date/time, scopes, callable tools, limits and what is off-limits;
`tin_access_explain` explains any error code.

Every result is `{items, meta: {count, truncated, bytes, nextCursor?}}` (also as
`structuredContent`). Continue with `meta.nextCursor`; cursors are signed and bound to the
tool, the person and the filters. Results over the byte budget are trimmed from the end and
the cursor moved back so nothing is skipped. Errors are `{error: {code, message}}` with the
codes listed by `tin_access_explain`.

## What is masked or never returned

- Customer and seller email/phone → `b***@example.com`, `***9999` unless revealed.
- Bank account numbers → last 4; UPI ids and PAN → partially masked; customer refund bank
  fields likewise. Never: Razorpay signatures, idempotency keys, fulfillment locks, stock
  reservations, password/OTP hashes, KYC file paths (documents are `true/false`).
- Free text (addresses, return reasons, refund notes, courier errors, checkout messages,
  seller addresses) → `{untrusted: true, text}` with emails, phones, card numbers, UPI ids,
  IFSC, PAN and long digit runs scrubbed, and control/bidi characters removed.

## How a call runs

rate limit (per connection and per person) → daily record quota → concurrency slot →
tool with timeout → envelope: forbidden-key guard, byte budget, cursor → quota spend →
**audit row** (seq from the shared Counter, HMAC over the canonical row, arguments as a keyed
MAC plus a summary of values the tool declared safe) → result. If the audit row cannot be
written the result is withheld with `AUDIT_UNAVAILABLE`.

## How OAuth works

Standard MCP authorization: OAuth 2.1 with PKCE S256, RFC 8414/9728 metadata, RFC 7591
dynamic registration (public clients only — no client secrets exist), RFC 7009 revocation,
RFC 8707 resource binding when the client sends one. `/authorize` renders a server-side
sign-in page (the request travels as a signed, 10-minute JWT); `/mcp/oauth/login` checks the
password with the admin login's rules (locked after repeated failures) and issues a
single-use code (10 minutes) bound to client, redirect, PKCE and person. Access tokens last
1 hour, refresh tokens rotate on every use; presenting an old refresh token ends the whole
connection (theft detection, 10 s grace for a genuine retry); a replayed code revokes what
it issued. Every token is capped by the approval period. Tokens are opaque (`tin_oat_…`,
`tin_ort_…`) and stored only as keyed HMACs with TTL indexes.

## Not yet

- Admin-panel pages for the settings API (API complete; UI pending).
- Write tools (`<area>:write`), tenant/seller sign-in, Nwatch-style report tools.
