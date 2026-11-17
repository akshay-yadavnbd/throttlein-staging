# Seller product import from URL

In **Add product → Single product**, paste a public HTTPS product URL, confirm
reuse rights, and select **Fetch product details**. Review the preview, then
select **Fill empty fields & add photos**. This creates no database record and
does not publish anything. Edit the normal product fields, choose category/brand,
set stock and pricing, then use the existing save/publish action.

## Server setup

Create a key in the [Groq console](https://console.groq.com/keys) and put it in
the ignored `backend/.env` file (or the deployment's secret manager). Any key that
has been pasted into chat or a ticket should be revoked and replaced.

```dotenv
GROQ_API_KEY=your-secret-key
GROQ_PRODUCT_IMPORT_MODEL=qwen/qwen3.8-27b
```

Restart the backend after setting it. Never put this secret in frontend settings,
`NEXT_PUBLIC_*`, source code, Git, or logs. Use Redis in production for shared rate
limits across API instances.

The feature uses Groq's OpenAI-compatible chat completions endpoint with
[strict Structured Outputs](https://console.groq.com/docs/structured-outputs)
(constrained decoding against our JSON schema). Only a few Groq models support
strict mode; `qwen/qwen3.8-27b` is one, but it is a **preview** model that Groq may
retire at short notice. If imports start failing with "model access" errors, check
the [models page](https://console.groq.com/docs/models) and point
`GROQ_PRODUCT_IMPORT_MODEL` at another strict-capable model (for example
`openai/gpt-oss-20b`). Requests set `reasoning_format: hidden` because Qwen's
default raw reasoning output is rejected alongside JSON schema mode.

Only fetched product evidence is sent to Groq, not seller credentials, account
details, or orders. No model tools, streaming, or model-generated URLs are used.

## Extraction and limitations

- Imports supported title, description/specifications, SKU, brand/category names,
  INR price/MRP, colour, sizes, explicit weight/dimensions and SEO text.
- The full product description is copied directly from a recognized source
  description container (or an unambiguous Product JSON-LD description), not
  summarized by AI. Text, headings and bullet content are preserved as editable
  text; scripts and embedded media are removed. If no complete source can be
  identified, the description is left blank with a warning. Descriptions above
  100,000 characters fail explicitly rather than being silently truncated.
- The preview expands to show the full source text. To replace a previous partial
  import, select **Replace my existing description** before applying the preview.
  Other existing non-empty form fields are preserved. Category and brand are selected
  only on an unambiguous exact match with existing active choices.
- Inventory and return/COD policies are never copied. Review variant inventory,
  packaging dimensions, prices, claims and image rights before publication.
- Up to six page-sourced JPEG/PNG/WebP/GIF photos, at most 1 MB each. Photos are
  signature-checked and staged as files in the browser; normal upload/storage is
  used only when the seller saves. Photos remain removable and reorderable.
- Public HTTPS only. No credentials, cookies, custom ports, private/link-local
  networks, or IPv6-only hosts. DNS is pinned per connection and redirects are
  revalidated. HTML is capped at 2 MB; fetches and AI calls have timeouts.
- Some sites block server fetches, require login, compress despite the request,
  or render all product data with JavaScript. They need manual entry; the feature
  does not bypass those restrictions. Missing photos do not discard extracted text.
- Rate limits: three attempts/minute and thirty/day per seller account. Failed
  attempts also consume the allowance. Rate limits are not a provider billing cap.

## Verification

Run `npm run test:product-import --prefix backend` and the frontend TypeScript
check. Tests use fake web/AI responses, including private-network targets,
redirects, DNS pinning, size/type limits, missing keys, AI errors, image failures,
and preservation of seller edits. A server-side key and a seller-approved public
URL are needed for a live smoke test before production rollout.
