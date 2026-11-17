# Item 12: drop the tolerant envelope readers

`12-drop-tolerant-readers.patch` removes the legacy-body fallback that let the storefront and
admin read both the old bodies and the `{ data, meta }` envelope while frontend and backend
deployed in either order.

**Apply only once production serves the envelope.** Check it with:

    curl -s https://api.throttlein.com/api/categories

It should answer `{"data":{"tree":…}}`. Today it still answers `{"success":true,"tree":…}`.

Ship the patch as its own deploy, after the backend deploy is live.

## What it changes (34 files, frontend + admin)

- `lib/api.ts` (both apps): `dataOf` reads only `{ data, meta? }`. It still folds paging
  meta back into `page / limit / total / pages`, which the list pages read.
  `envelopeOrLegacy` is renamed `envelopeData` at every call site.
- `frontend/proxy.ts`: the redirects fetch reads `body.data` directly.

Both apps type-check clean with the patch applied. It adds no ESLint errors: the touched
frontend files have 37 errors both before and after the patch.

## Apply

    git apply docs/patches/12-drop-tolerant-readers.patch
    cd frontend && npx tsc --noEmit -p .
    cd ../admin && npx tsc --noEmit -p .

Then delete this note and the patch. Also update the comments in
`backend/test/catalogEnvelope.test.js` and `adminEnvelope.test.js` that still say the web
apps "also accept the older bare bodies".
