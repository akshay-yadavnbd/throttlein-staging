# Seller dashboard redesign

Proceed one section at a time, starting with the seller portal. Preserve business actions, permissions, URLs, and API contracts while improving interaction and information hierarchy.

## Design direction

Use charcoal navigation, a white account bar, a light grey workspace, dark primary actions on light backgrounds, and the Throttlein lime accent for active navigation. Use the store name as the overview page heading. Put tasks ahead of reporting. Label reporting periods explicitly, use real data, and distinguish loading, errors, and empty states. Support mobile layouts and keyboard navigation. On list pages, keep status counts and filtering in the table toolbar; avoid summary cards that duplicate those controls.

## Section sequence

1. **Overview and shared seller navigation — implemented.** Grouped navigation, responsive drawer with keyboard focus handling, sales period selection, revenue/orders chart toggle, shipping tasks, catalogue health, recent-order filters, and retryable load errors.
2. **Orders, delivery issues, and returns lists — implemented; detail pages next.** Visible shipment-stage filters (including cancelled orders), date and text search, direct delivery-issue and return navigation, mobile order cards, and dark pickup-sheet and row actions. Existing fulfilment links, cancellation confirmation and hide actions remain available. Delivery issues now has courier/tracking search, repeated-attempt filtering, readable failure reasons and an action dialog with dark CTAs. Returns has status/type filters, search, pending-first sorting, evidence summaries and review links. All three lists share navigation, mobile layouts and inline loading/error states. Order and return detail pages still need their individual redesigns.
3. **Products.** Catalogue browsing, stock management, adding and editing.
4. **Payouts.** Balances, settlements, transaction history and details.
5. **Offers.** Listing, creation and editing.
6. **Offline sales.** Sales entry, history and invoices.
7. **Media.** Upload, browse, select and organise assets.
8. **Brands and categories.** Catalogue classifications and requests.
9. **Verification.** Submission, review state and correction flows.
10. **Profile.** Store, account, delivery and policy settings.
11. **Admin panel.** Carry the established patterns into admin sections after seller workflows have been reviewed.

## Overview validation

Browser checks with temporary local sample data cover populated, empty, and load-error views, seven-day sales totals, revenue/orders switching, shipment filtering, and mobile menu focus containment and Escape dismissal. Temporary fixtures are removed after review. Live seller data requires signing in normally.

Targeted ESLint and shared theme consistency checks pass. Full frontend TypeScript checking now passes.

## Orders list validation

Temporary read-only sample data was used to verify cancelled orders, search by destination state, pagination, stage changes, filter reset, date filtering, the cancellation dialog without submitting a cancellation, empty-store messaging, and recovery from a failed load using Retry. At 390px, the table changes to order cards and the page stays within the viewport. Targeted ESLint passes. Full frontend TypeScript checking now passes.

## Delivery issues and returns validation

Read-only sample previews verified delivery-attempt and courier search filters, all courier action options and corrected-address fields, return type/product search, unmatched searches, status changes, pagination, empty inboxes and retry after a failed load. No courier actions, cancellations or return decisions were submitted. Both lists switch to cards at 390px without horizontal page overflow. Temporary preview routes and data are removed after validation.

## Stable dashboard navigation

`frontend/app/dashboard/layout.tsx` mounts one persistent `SellerDashboardFrame` for all seller sections. Individual dashboard pages render content only; no page creates another seller shell. The frame keeps authentication, sidebar, account header and mobile navigation mounted when switching sections. Session identity and verification state refresh on route changes without clearing the frame. Standalone offline invoice previews bypass the frame. The viewport scrollbar lane is reserved while the dashboard theme is active to avoid width changes between short and long pages.

A temporary read-only fixture used the real dashboard layout and all ten sidebar destinations, plus browser Back and Forward. A DOM observer recorded zero frame replacements and exactly one main frame. The fixture was removed after testing.

## Seller dropdowns

`SellerSelect` replaces browser-default select menus in the overview, order date filter, delivery attempts, return type, category requests, product category/make/model/GST fields and URL imports. Product list filters use the same component. The control retains keyboard navigation and typeahead, supports empty-string and disabled values, restores focus after selection or Escape, and uses a white popup with a muted selected state and checkmark. Pointer and keyboard selection, nested-dialog focus return and 390px popup positioning were checked with read-only sample data.

### Payouts redesign
- Replaced the legacy stats and inset table with a light financial summary and weekly payout history, matching the seller workspace.
- Upcoming / Paid / All weeks filters retain counts; native accessible disclosure rows reveal item totals, courier charges, gateway fees, refunds and order links.
- Paid weeks expose transfer amount, bank reference and settlement note. In-transit estimates and charge explanations are collapsible.
- Preserved server payout calculations and cached results; first-load failures no longer look like zero earnings. Aborts the initial request on unmount.
- Responsive two-column week cards and charge breakdowns on phones. Dark detail controls and retry actions.
- Browser check reached seller sign-in; authenticated visual verification was unavailable in this browser session.

### Products layout and payout disclosures
- Products now uses one catalogue for all stock levels, with a compact restock shortcut replacing the separate out-of-stock table. Fixed the zero-stock filter, which previously searched an in-stock-only array.
- Added a consistent page header, aligned filters, flat white listing table, mobile cards, dark edit/restock actions and visible retry errors. Existing import/export, full-record editing and bulk actions are preserved.
- Filter events reset pagination; the current page also clamps after catalogue changes.
- Payout disclosures use a 16px SVG chevron with open-state rotation and reduced-motion support.

### Offers list
- Unified search, status filters and offer results in one light workspace. Replaced the separate filter card and inset dashed empty state.
- Added responsive offer rows with a discount tile, validity badge, eligible-product scope, minimum cart, discount cap and schedule. Dark create/edit actions; deletion remains behind a menu and confirmation.
- Added retry on fetch errors, cancelled superseded filter requests, reset pagination on status changes and clamped pages after deletion. Prevents repeated toggle requests while an update is pending and refreshes results after changes.
- No offer mutations were submitted during validation. Authenticated visual verification remains pending.

### Offer create/edit form
- Replaced the dark patterned hero and narrow column with a light header, full-width responsive form and sticky desktop offer summary.
- Grouped details, discount, eligible products and schedule into consistent white sections. Summary reflects current values and provides a dark create/save action; stacks below the form on mobile.
- Choice cards expose selected state to assistive technology. Product search is named and catalogue failures offer retry instead of claiming the store is empty.
- Existing create/update payloads and local date conversion retained. No offers were created or changed during checks. Signed-in visual verification remains pending.

### Offline sales and field focus
- Redesigned the Offline sales header, financial summary, combined history/filter workspace, table, empty states and record/edit dialog in the light seller style.
- Product, variant and supply-type selectors now use SellerSelect. Date filters have explicit labels, and list failures include retry.
- Seller-only focus styling changes the existing input border instead of adding an offset outline. HeroUI field wrappers own their focus border; inner input/textarea elements do not add another one. Checkbox/radio focus indicators are preserved.
- Type checking passed. Existing set-state-in-effect lint violations remain in the offline list and modal effects; other targeted lint checks pass. Signed-in visual verification remains pending. No sales, stock or invoice records were mutated.

### Seller calendar
- Added SellerDatePicker using the installed HeroUI accessible date picker. White rounded popup, dark selected day, month/year navigation, Clear and Today controls.
- Replaced native date calendars in Offline sales From/To filters and record/edit sale date. Values remain date-only YYYY-MM-DD; filters constrain each other to prevent inverted ranges.
- Component lint passed. Signed-in popup visual verification remains pending.

### Product add/edit form styling
- Updated inline and standalone add-product headers, back button, light form surfaces, input borders and section spacing.
- URL import is an optional disclosure instead of the dominant opening panel; its existing workflow remains available.
- Replaced breakpoint-dependent fixed save rail with a consistent sticky bottom action bar. Return/exchange and COD controls remain in Publishing options on all widths.
- Explicit form grid prevents full-span fields from creating unintended columns in simple mode; variants retain a wide-screen side section. Save/draft/edit payload logic unchanged.
- Type checking passed before the final standalone header styling; existing shared ProductForm lint issues remain. Signed-in visual verification pending. No product mutations submitted.


### Media library and offline sale picker
- Media now uses the shared light workspace style, dark upload CTA, integrated tabs/search/folder or image-type filters, and conditional Clear filters.
- Responsive image grid displays complete images with visible actions and accessible selection state. Filtered empty results are distinct from an empty library. Upload, copy, pagination and guarded deletion remain in place.
- Offline sale product search uses one bordered input; product results have clearer spacing and wrapping, and the dialog has a quieter section label.
- Product edit action uses client navigation. TypeScript validation performed; existing set-state-in-effect lint errors remain in these pages. Signed-in visual verification remains pending.


### Brands & categories
- Matched the light dashboard header, white workspace, underlined tabs, search toolbar and dark New request CTA.
- Categories use spaced expandable rows and subtle hierarchy guides; brand tiles use a responsive grid with wrapping names. Counts stay on tabs rather than duplicate summary cards.
- Styled request table and dialog, single-border fields, native radio choices, and existing verification gating. New submissions refresh the requests list and open My requests.
- TypeScript check run; two existing set-state-in-effect lint errors remain in data-loading effects. Signed-in visual verification pending.


### Verification and requests table
- Verification uses the light dashboard header, consistent white bordered sections, dark actions and single-border form controls.
- Submitted tax, pickup and bank details use responsive summary cards, masked account numbers and bordered document links. Existing review states and pickup confirmation remain; submission is disabled during document uploads.
- Replaced the themed requests table frame with a plain white table, pale-grey headings, consistent row spacing, result footer and singular/plural labels. Existing request actions and rejection reasons remain visible.
- Lifted read-only detail components outside render to prevent remounts. Signed-in visual verification pending.


### Profile
- Matched the light dashboard header, compact store identity panel, underlined section tabs and white bordered forms.
- Account details use a responsive two-column layout; policies group returns, delivery charges, cash on delivery and searchable delivery exclusions. Password settings have a dedicated panel.
- Single-border inputs, dark save buttons and toggles, keyboard focus indicators, telephone input types and password autocomplete. Existing save/password APIs and validation retained.
- TypeScript passed. Targeted lint reports two existing set-state-in-effect errors in initialization. Signed-in visual verification remains pending.


### Compact seller actions
- Added SellerButton for consistent 36px actions with 12px text, 7px corners and reduced padding across dashboard pages, forms and dialogs. Primary actions use charcoal; destructive colors and disabled/loading behavior are retained.
- Matched native CTA links, back links, payout details and Clear filters buttons. Existing compact row actions remain compact. Filter tabs, selects, navigation and large clickable cards are not treated as CTAs.


### Remove repeated page introductions
- Removed visible duplicate titles, eyebrow labels and introductory copy from the 11 main seller pages. Persistent header navigation remains the visible page label; screen-reader headings remain in the page.
- Existing page actions are retained in a compact right-aligned row. Create/edit/detail headings and the overview store name remain meaningful context.

### Order detail (seller) — second pass
- **Header** now reads as a summary: eyebrow + order number + status chips (the shared `StatusChip` vocabulary, same as the list), then a facts row — placed time, item count and value, "Ships to <city> <PIN>", payment method · status, courier wording when it adds something. The payment chip left the title row; it was competing with the status.
- **Stage stepper** under the facts: Placed → Confirmed → Shipped → Delivered as four bars (charcoal done, lime current, grey ahead) with the date each stage happened; the current stage names the finer state ("Awaiting pickup") so it agrees with the chip. Hidden for cancelled orders. Stacks 2×2 on phones.
- **Next step** is a lime callout with its own label ("Next step" / "All done" / "Dispatch on hold" in red) instead of a grey footnote; a complete order links straight to payouts.
- **Shipment card:** tracking number gets a Copy button; once delivered the invoice becomes the primary download and the label drops to secondary (the label matters until the parcel leaves, the invoice afterwards).
- **Customer & delivery:** "Deliver to" label, name, address lines, the PIN as a pill, a note that contact details go to the courier, and Copy address.
- **Payment & refunds:** adds "Your items" (subtotal) and "Your earnings" (net after courier & gateway charges, from the order's `earnings` line) above View payouts; payment status uses the shared chip.
- Copy toasts live in `lib/messages.ts` (`orderDetail.trackingCopied`, `addressCopied`, `couldntCopy`). Verified with stubbed delivered and awaiting-pickup orders at desktop and 375px (no horizontal overflow); frontend TypeScript clean.

### Product form — import panel and lint
- **Import from a product link** no longer repeats its heading inside the panel (the `<summary>` is the only title) and no longer draws a second framed box inside the first: the body is a plain white section under the summary. It opens with three short steps (Paste links → Fetch & preview → Edit, then publish), then one full-width **Product links** box styled like the form's other inputs whose help text states the limit and the public-pages caveat up front, the permission checkbox, and an action row with the charcoal **Fetch product details** button beside the fine print (which switches to "Tick the permission box to fetch" until the box is ticked). Preview and bulk-draft buttons use the same primary/bordered styles.
- `ProductForm.tsx` is lint-clean under the React Compiler rules: the listing colour is derived from the colours on offer instead of cleared in an effect; the edit-mode category and bike prefills run where the tree arrives (in the categories request's `.then`) instead of in effects that watch it; the preview-items ref is written in an effect, not during render; `findPath` moved to module scope and the tree memos sit right after the tree state so existing memoization is preserved. A categories response without `tree` now shows the load warning instead of crashing the editor.

### Products — checkbox, export menu, bulk import dialog, error page
- **`SellerCheckbox`** (`components/common/SellerCheckbox.tsx`) wraps HeroUI's Checkbox in the workspace look: an 18px square with a 1px grey border that fills charcoal with a lime tick, 12px label, full-opacity disabled state with a not-allowed cursor. Used for both checkboxes in the URL import panel.
- **Export menu** on the products list uses the same panel, rows and hover as SellerSelect and the account menu (white, 1px border, 10px radius, 12px rows) with a small CSV / XLS badge per option.
- **Bulk import dialog** now shares the dialog chrome of the order and offer dialogs (charcoal title bar copy, lime-tinted icon, grey footer). The body reads top-down: template download as two real buttons with the required columns underneath, then **1 Spreadsheet** (a single dashed drop zone that turns green once a file is chosen) and **2 Product images · optional** (same zone with Pick files / Pick folder / Clear). After a run the pickers are replaced by the results (Rows / Created / Updated / Failed tiles, failed rows, unmatched-image warnings) with **Import another file** and **Done**. The footer states "Pick a spreadsheet to continue" until a file is chosen.
- **Error page inside the workspace:** `app/dashboard/error.tsx` is a segment boundary, so a crash keeps the sidebar and account bar instead of swapping the whole route for the storefront's error screen. It is a white panel with a red warning icon, "This page hit a problem", plain next steps (Try again, Reload the page, Back to overview), an Email support link whose subject and body carry the page URL and the error reference, the reference itself when Next provides one, and a Show details toggle for the message. Verified by rendering a stubbed order without a delivery address.

### Storefront sign-in page
- `components/pages/SigninPage.tsx` is one card on the cream page background, split in two. Left: a black brand panel with the lime emblem (`public/images/home-banner-img.webp`) oversized and cropped by the corner as texture, a "Welcome back" eyebrow, the headline "Gear up. Sign in and ride on.", three reasons to have an account (track every order, faster checkout, wishlist and cart in sync) with lime check circles, and a Seller hub link. On phones the panel shrinks to the eyebrow, headline and one line above the form. Right: the same `FormField` inputs as the other auth forms, a black "Keep me signed in" checkbox with a lime tick, Forgot password, the Sign in button with an arrow, a "New here?" rule and **Create an account** as a bordered button (was a bare underlined word), plus a support email line. Error banners keep their one next step (create account / reset password / seller sign-in) as a link with an arrow. Sign-in logic, remember-me storage and `returnTo` are unchanged. Checked at desktop and 375px, no horizontal overflow.

### Storefront sign-up and forgot-password pages
- **Sign up** (`SignupPage.tsx`) uses the same split card as sign-in: "Join THROTTLEIN" panel with the emblem, four reasons to have an account (authentic gear, easy returns, one account everywhere, secure checkout) and an "Open a seller account" link; the form keeps name, email + phone, password + confirm. The password hint now says what the rule is and whether it is met ("At least 12 characters" → "3 more characters to go" → green tick), replacing a stale "Minimum 6 characters" note under a 12-character rule. Terms and Privacy policy links stay under the button; "Sign in" is a bordered secondary button.
- **Forgot password** (`ForgotPasswordPage.tsx`) is shared by customers and sellers; the seller login now links to it with `?from=seller`. Customers get a minimal logo bar with "Back to the store" instead of the seller marketing header, sellers keep the marketing header and footer, and every "Back to sign in" link points at the sign-in page the person came from. The card has the "Locked out? It happens." panel with the security heads-up, and the sent state shows a lime confirmation box with "try a different email" and a Back to sign in button.
- Checked all three auth pages at desktop and 375px; frontend TypeScript and lint clean.

### Auth inputs, CTAs and sign-up validation
- **Inputs** (`components/common/FormField.tsx`, shared by every auth form and the contact form): 48px, 10px radius, 1px `#d6d6d6` border that darkens on hover and turns black with a soft grey ring on focus; a light `#f6f6f6` tint once filled; an optional leading icon (`MailIcon`, `LockIcon`, `UserIcon`, `PhoneIcon`); an `invalid` state (red border and ring). `FormField` takes `hint` (grey) or `error` (red, with an icon) and renders it under the input so validation reads the same everywhere. The filled state is derived from `value` for controlled inputs instead of synced in an effect.
- **CTAs** on sign-in, sign-up and forgot-password: 52px, 12px radius, 15px text, and the arrow nudges right on hover; the secondary (bordered) button matches.
- **Validation** (`lib/authValidation.ts`): name (2+ characters), email format, phone (optional, but if typed must be a 10-digit Indian mobile starting 6–9, with +91/0 and spaces tolerated and stripped before sending), password (12+ characters, under 72 bytes, mirroring the backend) and confirm match. Sign-up shows each error once the field is left or the form is submitted, focuses the first invalid field on submit, and shows a three-segment strength meter (Weak / Good / Strong, with "N more characters" until the minimum) under the password. Sign-in and forgot-password validate the email format and an empty password the same way. Forms use `noValidate` so the messages are ours, not the browser's bubbles.

### Reset-password page and smaller auth controls
- **Reset password** (`ResetPasswordPage.tsx`, opened from the email link) is the same split card: "Set a new password." panel with three password tips, then New password (with the strength meter) and Confirm password, validated like sign-up. The link serves customers and sellers alike, so the page carries a neutral logo bar and, once the server answers, stores the session for the right property and goes to `/account` for customers or `/dashboard` for sellers (every reset used to store a seller session and go to the seller dashboard). The stale "Minimum 6 characters" copy is gone.
- **Sizes:** inputs are 44px (were 48) with a 16px leading icon; primary and bordered CTAs are 44px with 10px corners and 14px text (were 52px).
- **Phone fields are digits-only** (sign-up and contact): a fixed "+91" prefix (`FormInput`'s `prefix` prop), letters and symbols blocked at the keyboard (`digitsOnlyKeyDown`), pasted "+91 98765 43210" or "09876543210" folded to the 10-digit mobile (`phoneDigits`), and the value capped at 10 digits. No `maxLength`, since Chrome would truncate a pasted number before it could be cleaned. The validator then only has the first-digit rule (6–9) left to report.
- **Quieter validation:** a format error (bad email, short password, mismatched confirm, bad phone) shows once the field is left with something typed in it; "this is required" only appears after a submit attempt, so tabbing past an empty field no longer turns it red.

### Storefront contact page
- `components/pages/ContactPage.tsx` was three bordered boxes (call, email, maps) with the message form commented out, although `/api/contact` still exists (rate-limited, emails the support inbox and a confirmation to the sender). Now: the riding photo (`public/contact/hero-banner.webp`) as a hero with a dark left gradient, eyebrow + "Contact Us" + tagline and two facts (reply within 24 business hours, phone hours); a two-column body with the **message form** on the left (name, email, optional phone, topic chips that are prepended to the message, message, one black Send button, lime success / red error panels) using the shared `FormField` inputs and `lib/authValidation`; the **direct channels** on the right (call, email, visit with Open in Maps, follow us) sticky on large screens; and a cream "Looking for a quick answer?" strip linking FAQs, order tracking and the seller hub. Checked at desktop and 375px.
- **Open in Maps** points at THROTTLEIN's own Google Maps listing by its place URL (`/maps/place/Throttlein/...!1s0x390cef197410e6af:0x86da936ca34a34f8...`). The old address search opened a results list with every business in the plaza; this opens that one pin.

### Seller login page
- `components/pages/SellerLoginPage.tsx` is the same split card as the storefront auth pages, under the seller hub's own header and footer. Left: the warehouse photo with a dark gradient, "Seller portal" eyebrow, "Reach 10,000+ riders monthly.", three things the portal does (orders, revenue, shipping) with lime checks and three stats (2 min to list, 48 h SLA, ₹0 listing fee); on phones a short photo strip. Right: "Seller sign in" with the shared inputs (mail and lock icons, inline validation, quiet until a field is left or submitted), the styled "Keep me signed in" checkbox, a 44px Sign in button with the arrow, a "New here?" rule with **Create a seller account** as a bordered button, and a "Here to shop? Customer sign-in" line. The red error banner names its one next step with an arrow; the amber unverified banner keeps its Resend verification link as a plain button. Login logic (role check, master-key sessions, remember-me) is unchanged. Checked at desktop and 375px.

### Seller register and verify pages
- **Register** (`SellerRegisterPage.tsx`): the same split card as the seller login. Left: the warehouse photo, "Sell on THROTTLEIN" eyebrow, "Sell to riders who care.", three benefits and three stats (2 min to set up, 0% listing fee, ₹0 setup cost). Right: "Step 1 of 2 · Create your seller account" with name, store name (shop icon), email and a required digits-only **+91 mobile** ("Couriers call this number for pickups"), validated with `lib/authValidation`, quiet until a field is left or submitted; one black Send verification link button; Privacy Policy / Seller Terms line; "Already selling with us?" rule with **Sign in** as a bordered button. The success state ("Step 1 of 2 done · Check your inbox") keeps Back to sign in, Resend link and "Use a different address".
- **Verify** (`SellerVerifyPage.tsx`): the split card with the emblem texture, "Seller onboarding" eyebrow, "One last step to your dashboard." and the next three milestones numbered 2–4 (KYC, first product, first order). Right: a lime "Email verified" pill, the email and store name, New password with the shared strength meter and Confirm password (shared inputs, lock icons, same validation as sign-up), one black Set password and continue button. Invalid-link and done states use the same icon-eyebrow-heading pattern with Sign up again / Back to sign in. The `checking → ready → saving → done / invalid` state machine is unchanged.

### Auth pages: no phantom scrollbar
- Sign-in and sign-up sized themselves with `calc(100vh - 76px)`, a guessed navbar height; the real header is 83–97px depending on width, so every screen got ~20px of overflow and a scrollbar even when the card fit. The storefront `Navbar` now publishes its rendered height as `--site-header-h` on `<html>` (ResizeObserver on `#site-header`, cleared when the navbar unmounts), and both pages use `min-height: calc(100dvh - var(--site-header-h, 83px))`. The card centres when there is room and the page scrolls only when the card is genuinely taller than the viewport; the brand panels' minimum heights were trimmed (560 / 600px) so laptop screens fit. Verified at 1440×1000: no scroll, equal space above and below the card.

### Storefront header search
- `components/common/SearchDropdown.tsx`: the flat grey box is now a white 44px field with a 1px border, the same chrome as the header's Login/Signup button; hover darkens the border, focus turns it black with a soft ring. Search icon on the left; on the right a spinner while fetching or a clear button once something is typed. Pressing "/" anywhere on the page focuses the box (the key hint that advertised it was removed per product decision; the shortcut stays). Placeholder reads "Search parts, gear, brands…". The dropdown is a rounded, shadowed panel: Trending as a row of pills with an "↵ to search what you type" hint; results with 44px bordered thumbnails, name and category, an arrow on the highlighted row, and a "See all results for '…'" footer; no matches shows a "Search anyway" button. Listbox / option roles and `aria-expanded` added. The route-change reset is a render-time adjustment and loading / suggestions derive from the last completed fetch, which clears the file's two `set-state-in-effect` lint errors.

### Storefront header: right cluster alignment
- Every control right of the logo is now 44px tall with the same 1px `#e0e0e0` border, 10px radius and hover (`#a8a8ad` border, `#f3f4f2` fill), 12px apart: the search box, a square **cart** button, a square **wishlist** button and the Login/Signup button (or, signed in, the account button with a square avatar). The wishlist heart is a plain outline that fills with the product-card pink gradient on hover or once anything is wishlisted; the old circle-backdrop heart icon copied from the product cards (which read as a disabled grey disc beside a bare bag icon) is deleted. Count badges sit on the button corner with a white ring. Measured at 1440px: all four controls top 16px, height 44px.

### Storefront mobile search
- The phone search was a floating HeroUI modal with a grey input and six hard-coded "Quick links" chips, and no suggestions. `components/common/MobileSearchSheet.tsx` replaces it with a full-screen sheet: a top bar with a back button and the auto-focused search field (same white bordered style as desktop, clear button, spinner), Trending pills while empty, live suggestions as you type with the same rows as desktop, a "See all results" action and a "Search anyway" button when nothing matches. Closes on back, Escape, picking anything or route change, and locks page scroll while open. The desktop `SearchDropdown` now exports the shared pieces (`useSearchSuggest`, `SuggestionRows`, `TrendingPills`, `TRENDING`, hrefs) so both surfaces fetch and render identically; the navbar dropped its modal, `Input`, `Chip`, `QUICK_LINKS` and the old modal state. The desktop input is a proper `combobox`. The shared hook returns one stable empty array for "no suggestions", because callers compare the array to detect a new result set (a fresh `[]` each render had caused a render loop during this work; caught and fixed before hand-off).

### Storefront error page
- `components/common/ErrorPanel.tsx` is the one "Something went wrong" card for the storefront: a white card on the cream page with a red warning tile, "This page hit a problem" eyebrow, the headline, plain reassurance, three actions (Try again with a refresh icon, Back to home bordered, Browse products as a text link), and a footer with Email support (subject and body carry the page URL and error reference), the reference code when Next provides one, and a Show details toggle for the message.
- `app/(storefront)/error.tsx` is new: a page crash now stays inside the storefront layout, so the navbar and footer remain and the customer can still search or open the cart. `app/error.tsx` (root, for crashes inside the layout itself) draws a minimal logo bar with a Browse products link and the same panel, replacing the centred text with the grey circle icon. Verified with a temporary throwing route at desktop and 375px, then removed.

### CTAs and arrows (seller dashboard)
- One arrow everywhere: `components/common/Arrow.tsx` is a 1em stroke icon (`right` for forward links, `left` for back links, `up-right` for new-tab links) that inherits colour and sits on the text baseline. It replaces the text glyphs (←, →, ↗) that rendered at different weights and sizes from page to page and looked heavier than the SVG icons in the buttons beside them: order detail (back pill, both View payouts links), sidebar Back to storefront, overview (metric hints, Manage catalogue, View all orders, row open buttons, empty states), orders list (Review issues, Manage products), payouts (order links), KYC (Manage contact details, View document), delivery issues (Back to orders) and the Prev / Next pagers on Media and Offline sales.
- Order detail's back pill now has the same geometry as the products and offers editors (40px, weight 500, 8px radius; 36px on phones) and the not-found state uses it too. On a delivered order the shipment card lists **Download invoice** first and the label second; the Payment panel's View payouts is a left-aligned text link with the arrow beside the words rather than pushed to the far edge.

## Admin panel

Carries the seller workspace patterns into the super-admin app (`admin/`), one section at a time. Permissions, site switching, the URL guard, badge polling and API contracts are unchanged.

### Phase 1 — shared admin frame (implemented)
- `AdminShell.module.css` ports the seller chrome: charcoal grouped sidebar with lime active item, white account bar with page name, light grey workspace, seller-style account menu with role chip, and a restyled notification bell (same derived feed and read state).
- One persistent frame: the root layout mounts `AdminFrame` once; the 53 pages that still wrap themselves in `<AdminShell>` render content only inside it. Sign-in and password routes bypass the frame. Sidebar, header and polling no longer remount between sections.
- Phones: the admin panel previously kept a fixed 256px sidebar on every width. It now has a dark mobile header (menu, logo, bell) and a drawer with focus trap, Escape, focus return, scroll lock and Sign out; the drawer closes on navigation.
- `app/error.tsx` (Next 16 `retry`) keeps a page render failure inside the workspace instead of blanking the whole panel.
- Workspace rules scoped to `#admin-main`: seller tab treatment (`.admin-tab-row` for custom rows), single-border field focus, reserved scrollbar lane.
- `AdminButton`, `AdminSelect` and `AdminDatePicker` mirror the seller primitives for the section redesigns that follow (HeroUI v2, kept out of the v3-only `components/ui`).
- HeroUI router hookup in `app/providers.tsx` so href menu items navigate reliably.
- Checked on the local dev server with a temporary in-tab session and stubbed API responses: frame identity across seven sections, header titles, nav highlighting and badges, bell and account menus, error panel recovery, 375px header/drawer behaviour. TypeScript passes; lint findings in `AdminShell.tsx` are the three pre-existing set-state-in-effect errors. Signed-in visual verification with live data remains pending.

### Dashboard overview (implemented)
- Same structure as the seller overview: marketplace heading ("Throttlein marketplace", or the content site's name), then the admin's to-do list ahead of reporting.
- To-do list: KYC to review, catalogue requests, refunds to process, failed courier bookings — each permission-gated, loaded independently, tinted when waiting, "Checking…" while loading and "Couldn't check" on its own card if that endpoint fails. Sign-ups in progress is shown as context (waiting on the seller).
- Marketplace snapshot with an explicit reporting period (Last 7 / 30 days via `AdminSelect`, from the overview's daily series): net revenue (featured, all-time in the hint), orders, average order value, live sellers (registered and newly joined in the hint).
- Revenue/orders area chart with a metric toggle and a screen-reader description; recent orders sit under it, balancing the right column (seller pipeline with KYC names and stage links, catalogue health). Recent orders become cards at phone width.
- A failed overview is now an error panel with Retry and no figures; the old page showed zero-filled placeholders under a warning. Empty marketplace, empty period, no KYC and no orders each have their own message.
- Unchanged: `canPlatform` / `canSite` / `showCms` gating, the content-site note, the staff "nothing to summarise" state, content KPIs and activity lists for staff and the seller site, and the compact checkout-failures list (restyled with Orders).
- Checked with sample data on the local dev server at 1440px, the pane width and 375px: section placement, period switching by keyboard (sums verified), chart toggle, overview failure and retry, single-queue failure, empty states, no page overflow. TypeScript and lint pass. Signed-in verification with live data remains pending.

#### Follow-up: row links and checkout failures
- Recent-order row links use a 32px icon button with an SVG arrow and tooltip; the whole row hover highlights it and the button turns charcoal on direct hover. Orders whose account was deleted say so instead of "Customer —".
- `CheckoutFailures` (dashboard panel and Orders → Checkout failures) rebuilt in the workspace panel style: severity-coloured step chips with plain labels and a legend (payment failed or order missing / technical issue / customer stopped), relative time with exact time on hover, payment method and source, readable messages, gateway order and payment ids with copy buttons, icon refresh that keeps rows visible while reloading, distinct loading, empty, filtered-empty and error states, `AdminSelect` step filter and paging on the full page. Switches to cards by the panel's own width (container query), so it stays readable in narrow layouts.

### Orders (implemented)
- **All orders:** one workspace panel (seller orders list layout) with header, count, Placed date preset and Export CSV; status tabs with live counts (new additive `statusCounts` on `GET /api/admin/orders`, computed under every other active filter); search with clear button and payment filter (`AdminSelect`); "Showing x–y of n" and Clear filters. Rows are clickable with the 32px arrow open button; sellers as chips; paid-with (incl. EMI tenure) under the payment chip. Switching filters keeps the previous rows dimmed with "Updating…"; never-seen views show a skeleton; seen views paint from the list cache; failures show a retry panel (inline notice if a refresh fails over loaded rows). Duplicate fetching (separate poll + load) unified; 15 s quiet polling kept.
- **Shipping errors:** same panel; stuck sellers as red chips, readable failure reasons, per-seller "Email seller" with a prefilled subject/body asking them to fix and use Retry push (read-only for admin by design).
- **Checkout failures:** uses the rebuilt `CheckoutFailures` component.
- **Order detail:** seller order detail layout — summary panel (number, status, placed/delivered/cancelled times, item/seller counts, total) with the admin verbs (Process refund, Cancel order); each seller parcel with items, references + copy, problem block with its one fix, and tracking beside the items; side column with customer, delivery address, payment (instrument + Razorpay/refund ids), amount breakdown (incl. COD fee) and customer note; returns & exchanges history. Not-found and load failure are now distinct (previously every failure said "Order not found"), with retry.
- Lists switch to cards by panel width (container query). Checked with sample data at 1440px and 375px: tab counts, status/search/payment filters and their interaction, clear filters, paging, row click, detail layout and stacking, problem action, not-found vs server error and retry, shipping-error email links, no page overflow. Admin TypeScript/lint and backend tests pass. Signed-in verification with live data pending.

#### Follow-up: order timeline
- `OrderTrackerVertical` (admin) restyled: compact dots (charcoal tick = done, lime = current, red = problem, hollow = to come), muted connecting line kept continuous through a small "Return / Exchange / Refund" phase label (replacing purple), no nested box, steps marked with `aria-current="step"`.
- Timeline logic fixed: a cancelled order keeps its real history (Placed, Confirmed if it happened) and no longer lists Shipped/Delivered it will never reach; a cancellation refund (`kind: 'cancellation'`) shows "Refund raised → Refunded" instead of the six-step parcel-return sequence ("Return accepted, Picked up, In transit back…") it used to show.
- Detail page: "Process refund" states what's waiting (e.g. "Cancellation refund · ₹12 · waiting in the Refund queue"); history titled "Returns, exchanges & refunds" with plain kind labels; payment and reference ids at normal size in monospace.

### Sellers and KYC (implemented)
- **Shared list styles** moved from `app/orders/orders.module.css` to `components/WorkspaceList.module.css` (orders now import it too). On phone-width panels the search takes the full row and the result count drops beneath it.
- **All sellers:** workspace panel with stage tabs and live counts (from `/admin/sellers/queues`, `?stage=` deep link), search, table → cards by panel width. One onboarding track per row (email verified → KYC submitted → live, Suspended off-track) with a plain label ("KYC waiting for you", "KYC sent back"…) and reminder/submitted dates under it. Row menu keeps remind, sign in as seller and delete (deletion-impact check, master-key password); the reminder cooldown confirm uses the app dialog instead of `window.confirm`. 32px arrow opens the seller.
- **KYC reviews:** oldest first, each entry tagged "New seller" or "Change request" (`kyc.isRevision`), "#n in queue", and "Waiting Nd" (amber) after two days; the header shows the oldest wait. `KycReviewCard` unchanged inside each entry; 15 s polling and list cache kept.
- **Seller detail:** order-detail layout. A compact identity header now shows on **every** tab (previously Profile only): avatar, store name, "Account …" and KYC chips (or "Change request to review"), owner/email/joined, Email seller. Underlined tabs Profile / KYC & payouts / Products (count); the default tab and labels follow pending change requests exactly as before. Profile: contact fields with copy buttons, account actions as described rows (Edit, Approve or Suspend, Delete), still hidden behind a locked note until KYC is approved, and a six-figure business overview. Products: workspace table with thumbnail, category, brand, status/featured, stock (0 in red), price/MRP; cards with the status on the right on phones. Edit and approve/suspend/delete confirm modals restyled; same endpoints. Not-found vs load failure distinguished, with retry.
- No public per-seller storefront page exists, so the header links to email rather than "View store".

#### Follow-up: seller detail states and the KYC review card
- **Header:** one stage chip on the onboarding track (Email not verified, KYC not started, KYC sent back, KYC waiting for you, Live, Suspended), plus "Change request" when one is pending. This replaces the "Account pending" and "KYC not started" pair. A seller who isn't live gets a strip under the header showing the three steps (email verified → KYC submitted → live) and who moves next. The action depends on the stage:
  - stalled sellers: **Send reminder**, with the last reminder date (same 24-hour cooldown confirm as the list)
  - KYC waiting: **Review KYC**
  - change request: **Review changes**
  `GET /api/admin/sellers/:id` now also returns `onboardingStage` (additive), so the button follows the remind endpoint's rule.
- **KYC tab with nothing submitted:** instead of an empty dashed box, it lists what the seller still owes (tax identity, bank account, pickup address) with the reminder action. If their email isn't verified, it says they can't sign in yet. The tab reads "KYC & payouts (review)" only when the next move is the admin's (it used to say "(action needed)" even when the seller had to act).
- **`KycReviewCard` restyled** (used here and in the KYC queue) with its own `KycReviewCard.module.css`:
  - tax / bank / pickup as three bordered spec sheets that stack by card width
  - copy buttons and "View file" / red "Missing" document pills
  - the pickup verification panel in the workspace palette, with a charcoal tick for each fact
  - Reject (red outline) and Approve (charcoal) in the decision row
  - the last rejection note moved to the top of the card
  - approve, reject/revoke and edit-KYC modals restyled
  Logic, endpoints and the change-request (`isRevision`) behaviour are unchanged; the buttons now say "Approve changes" for a change request.
- Shared modal styles live in `components/AdminModal.module.css`; the seller detail modals use them too.
- Checked with sample data at 1440, 1280 and 375px: new, unverified, KYC waiting, sent back, live (pickup panel) and change-request sellers; approve and reject modals; KYC queue entries. No page overflow. Admin TypeScript/lint pass; backend controller loads.
- Checked with sample data at 1440, 1280 and 375px: list stages and cards, KYC queue tags and wrapping, detail tabs, locked vs unlocked actions, suspend modal, products table/cards and paging, no page overflow. Admin TypeScript/lint pass. Signed-in verification with live data pending.

### Refunds (implemented)
- **Queue:** one workspace panel. The header gives the money still owed ("₹11,896 to pay back across 4 refunds"), the oldest wait, and how many are stuck needing a provider check.
- **Tabs and loading:** To process, Processing, Failed, Refunded, All, with counts. Every refund state loads once and the tabs filter on the page, so switching is instant and counts always match the rows.
- **Search:** order, customer, seller or reference.
- **Table columns:**
  - refund: order link, plus kind and seller
  - customer
  - pay back via: Razorpay or bank transfer; for COD, "UPI on file", "Bank account on file" or a red "No payout details"
  - raised: amber "Waiting Nd" after two days, red "Needs provider check" when a Razorpay result is uncertain, "Refunded <date>" once done
  - status and amount
  The table turns into cards on narrow panels.
- **Process dialog** (shared modal styles):
  - the money state comes first: refunded with copyable reference, waiting for Razorpay, Razorpay's answer lost (stays locked, check the provider), or last attempt failed
  - then why the refund exists: seller verified or flagged the parcel with their note, or the cancellation / exchange reason
  - what's being refunded, and where it goes (Razorpay payment id, or UPI / bank details with copy buttons; a clear warning when the customer gave none)
  - a required transaction reference for manual transfers, and an optional internal note
  - "Open order" in the footer
  The confirm step before any money action is unchanged; the transfer-or-Razorpay decision now follows `refundMethod`, as the backend does.
- **Deep link:** the order page's "Process refund" now goes to `/refunds?q=<order>`, which filters to that order and opens its refund if exactly one needs action.
- **Backend (additive):** `GET /api/admin/refund-requests` rows now include `seller {name, slug}`, `reason` and `refundNotes`.
- Checked with sample data at 1280px and 375px: every status, COD with and without payout details, uncertain processing, the deep link, cards and dialog on phone, no table overflow. Admin TypeScript/lint pass; backend controller loads.

### Settlements (implemented)
- **One workspace panel, three views** (tabs with counts): By week, On the way, Paid. The header copy changes per view; the week picker (‹ week › with "in progress" when it's the current week) sits in the header on By week.
- **By week:** a summary strip first — money still to pay and how many sellers, paid-of-total with the amount transferred, charges still to confirm (amber), sellers without bank details (red, "ask them to complete KYC"). Then one row per seller: bank on file or a red "No bank details", "N charges to confirm", parcels, item total, the three deductions in grey, net to pay in bold, status (Due / In progress / Paid with date and UTR), **Mark paid** when it's actually possible (not paid, week complete, net > 0) and an expand arrow. Opening a row shows every parcel: order link, delivered time, items, delivery, gateway, refunds, net, and **Set delivery charge** (amber when missing) / **Edit charge**.
- **On the way:** the same shape for parcels with a label that aren't delivered yet — expected payout once delivered, charges to confirm, parcel status chips; charges can be fixed before the parcel lands in a week.
- **Paid:** settlement history with the week, parcels, net, amount paid ("differs from net" when rounded), UTR, when and by whom.
- **Dialogs** (shared modal styles): Record payment lists parcels, item total, deductions, net due and the bank account (red when missing), warns when charges are still missing (a paid week can't be corrected later), then amount, UTR (required — a warning toast if empty) and note. Delivery charge explains what it's for and names the courier.
- Narrow panels switch to cards; expanding a card lists its parcels. Loading is derived (skeleton on first load, dimmed rows when switching weeks), each view has its own retry panel.
- Backend and endpoints unchanged. Toast wording in `M.settlements`.
- Checked with sample data at 1440px and 375px: summary strip, expand/collapse, both dialogs, transit and paid views, no overflow. Admin TypeScript/lint pass.

### Customers (implemented)
- **All customers:** workspace panel with the count, a debounced search (name, email, phone), and a table — avatar + name with city or account state under it, contact, orders, lifetime spend, joined, and the 32px arrow. Rows click through; cards on narrow panels; server-side paging at 15 with the stale "Updating…" treatment and a retry panel.
- **Customer carts:** same panel. One row per non-empty cart: customer (email, phone, cart reference), what's in it (first three items with size/colour, quantity × price and an amber "Out of stock or unavailable"; "+n more" expands), estimated value with units, and last updated with "Idle Nd" in amber after 24 hours. Search, an "Idle for 24 hours or more" filter (`AdminSelect`), **Export this page** (CSV, one line per item) and quiet 30 s polling. The old Refresh button and submit-to-search form are gone.
- **Customer detail:** the seller-detail layout (its styles are imported). Identity header on every tab: avatar, name, an account chip only when not approved, email, phone, customer since, orders and spend, **Email customer**. Tabs Profile / Orders (count); a buyer with orders opens on Orders (`?tab=` deep link kept).
  - Profile: contact with copy buttons; an Account card with **Delete…**; a six-figure shopping activity strip; saved addresses as cards with Default marked.
  - Orders: a workspace list — order number (links to the full order page), placed/delivered dates, items, payment, status, total; a row opens to its items (thumbnail, brand, category, size, "sold by" seller link, quantity × price), where it was delivered and the timeline. Cards list items on narrow panels.
  - Delete dialog in the shared modal style, stating that past orders stay with the sellers and will show "Deleted account".
- Backend and endpoints unchanged. Toast wording in `M.customers`.
- Checked with sample data at 1440px and 375px: list, carts (expand items), detail profile and orders (expanded row), delete dialog, no overflow. Admin TypeScript/lint pass.

### Catalogue (implemented)
Four tabs under one sidebar entry, all in the workspace layout. The `/products` admin page is not in the sidebar and was left alone.
- **Brands:** panel with tabs All / Featured / Regular (counts), search, **Add brand** in the header; table of logo, name and `/brands/<slug>`, products using it, order, status with a Featured chip; row menu Delete (confirm says how many products use it), arrow or row click to edit; cards on narrow panels.
- **Categories and Shop by Bike** (`CategoryTable`): same panel; the tree is shown as rows with children indented (└) under their parent; subcategory/model counts, order, status; row menu Delete (warns how many sit underneath). Shop by Bike lists makes with their models and is titled "Makes & models".
- **Add / edit forms** (`components/AdminForm.module.css`, shared by brands and categories): shown in place of the list with a back link and an identity header (logo/icon, name, status, URL, counts). Titled sections — details (with the parent picker for categories), logo/icon, search engines (categories keep the live Google preview and counters), top of the page, below the products — beside a **sticky rail** with the Active (and Featured) toggles, Save, Cancel, "Open on the storefront" for a saved category, and a warning when the slug changes. One form serves both add and edit.
- **Brand & category requests:** the KYC-queue look — tabs Pending / Approved / Rejected / All with counts (all states load once), the oldest wait in the header, one entry per request with the seller, type tag, waiting badge after two days, the seller's note and the rejection reason. Approve opens a pre-filled create dialog with a Brand | Category segmented control (and a note when you flip the type); Reject needs a reason of 5+ characters the seller sees. Both dialogs in the shared modal style.
- **Customer carts, revisited:** per-item subtotals removed from the "In the cart" column (the estimated value already says it), the long cart reference shortened to "Cart …BFB8" (full value on hover), an open-customer arrow per row, and the list header now keeps its button beside the title instead of wrapping under the description (`WorkspaceList` change, applies to every list).
- Backend unchanged. Checked with sample data at 1440 and 375px: brands list and edit form, categories tree, Shop by Bike, requests with the approve dialog, carts; no overflow. Admin TypeScript/lint pass.

### Content — stage 1: the lists (implemented)
Pages, Blogs, Testimonials and Media are the four Content entries. This pass covers every list screen; the editors behind them are stage 2.
- **Pages:** one workspace list for the home page, built-in static routes (manifest + auto-discovered), dynamic landing pages and prose pages — tabs All / Static / Dynamic / Prose with counts, search, **Create page** in the header. Rows show the type chip, URL, a publish switch for dynamic/prose pages, Live/Draft, "Search text set" or "Default search text" for static routes, and the updated date; Delete in the row menu, arrow or row click to edit.
- **Blogs:** posts list with status tabs (counts over every post), search, **Write a post**; rows show the cover, title, slug and reading time, category, status, views and the last real edit (not the view-count bump). Authors, Categories and Tags moved from side-form-plus-list layouts to the same panel: Authors as a table (avatar, role, bio with credential chips, posts incl. the other site, Active/Hidden); Categories with an add/edit dialog in the shared modal style (parent picker, order, active); Tags as chips with post counts and an inline "add a tag" box in the header.
- **Testimonials:** tabs All / Published / Drafts, search, **Add testimonial**; rows show the person, a one-line quote, position with up/down arrows, a publish switch; the create/edit dialog is in the shared modal style (the form itself is unchanged).
- **Media:** the library in one panel — count and **Upload images** in the header; search, folder filter (`AdminSelect`) and "Select all on this page" in the toolbar; a thumbnail grid with select + delete per tile; the toolbar's right side becomes the bulk action bar ("3 selected · Clear · Delete selected"). Confirms say the file is removed from storage.
- **Inputs:** `AdminInput` and `AdminTextarea` now share the workspace field look (40px, 1px border, label above) — textareas no longer float their label inside, so every form reads the same.
- **Rich text editor chrome** (the circled corner on the brand form): the fullscreen control is now a labelled, bordered button beside the Visual/HTML switch instead of a bare arrow glyph; the editor border matches the inputs. The brand form's placeholder avatar shows a tag icon until a name is typed.
- Backend unchanged. Checked with sample data at 1440 and 375px: all seven list screens and the media selection bar; no overflow. Admin TypeScript/lint pass (the editor file's two pre-existing lint errors are untouched).

### Content — stage 2: the editors (implemented)
Every content editor now uses one layout — the add/edit form family the brand and category forms introduced: a back link, an **identity header** (icon or image, title with status chips, URL and dates), one white panel of titled sections, and a **rail** on the right with the publish toggle, settings and Save / Cancel. Field logic and API calls are unchanged.
- **Shared kit:** `components/EditorShell.tsx` (`EditorPage`, `BackLink`, `EditorHeader`, `EditorSkeleton`, `Field`, `Counter`, `IconButton`, `AddButton`, `RowTools`, `AccordionRow` + icons) and new classes in `components/AdminForm.module.css` — rail groups, repeater rows with move/remove tools and a dashed Add button, accordion rows, chips, the category checklist, counters, a compact in-panel table, notes and the sticky action bar for forms taller than a screen. `SeoFields.tsx` keeps its exports but renders on the same pieces; `MultiPick` wears the input look and workspace chips.
- **Blog post** (`BlogForm`): sections Post (title, slug with /blog/ prefix, excerpt, body), Key takeaways, References (rows with title + link, reorder, drop blanks), FAQ (collapsible numbered rows, heading field) and Search engines (counters, share image). Rail: Publish (native status select, publish-at, feature toggle), Featured image, Author, Category (search, tree checklist — picking a child includes its parents, inline "New category"), Tags (chips, Enter to add, suggestions). The rail is intentionally not sticky (too tall); a **sticky bottom bar** carries Cancel / Create post / Save changes.
- **Blog author** (`BlogAuthorForm`): Identity (name, slug, role, bio with counter, avatar), Credentials (chips with a cap), rail with a live **byline preview**, Active toggle, display order, Save.
- **Pages:** New page, Dynamic page and Prose page share the structure — Page (title, slug, template as a native select), Products filter (`MultiPick`), seller-category sections inline, Top of the page / Below the grid, Search engines with counters and share image; rail Publish with the toggle, Save, **Open live page** (site-aware) and Cancel, plus a slug-changed warning. The prose editor's Write / Preview is the segmented control; the preview is restyled. Static-route meta pages show the SERP preview last and explain when a route has no on-page content. `SellerCategoryFields` renders as titled sub-sections inside the page panel; its slide/step/photo repeaters and FAQ use the shared rows.
- **Home page:** sections (hero banners, promo blocks, seller callout, SEO block) as collapsible rows that mount their editor in place, with Expand / Collapse all; Search engines with counters, share image and the SERP preview; the rail's one Save still drives every open section plus the page record. Hero banners and promo blocks are compact tables (preview, order arrows, active switch, Edit, delete) with their forms in the shared modal; seller callout and SEO block are inline forms. The standalone pages for each section wrap the same component in a panel under an identity header.
- **FAQs:** identity header with counts and **New section**; sections as collapsible rows (title, order, visibility, nested question rows with rich-text answers, Save section / Discard), then the shared **Search appearance** panel. **Seller home** (seller site): search appearance, guide-section heading, FAQ and the guides table, each its own panel; **Seller guide** editor mirrors the blog post (Guide + Search engines, rail with Active, publish date, order, hero image). `StaticPageMetaPanel` is now the one search-appearance panel (FAQs' own copy removed) and takes `supportsContent` to hide the on-page fields for routes that don't render them.
- **Redirects:** now a workspace list — All / Active / Off tabs, search, table/cards, row menu — with the create/edit form in the shared modal (native type select, active switch, note).
- **Testimonial** and **promo block** forms use the same sections and inputs, with the action bar pinned to the modal's foot.
- **Alignment pass on the brand form** (after review): helper text under `AdminInput` / `AdminTextarea` is now flush with the field edge everywhere (HeroUI padded it 4px); every field in a two-column row carries a one-line hint so neighbouring cells stay level; Title/Intro at the top of the brand page are full width; the social preview image is an upload tile (via the brands upload endpoint) instead of a URL box; the header avatar is a rounded square so square logos aren't clipped.
- Two lint errors fixed in passing (New page's template fallback and auto-slug are now derived, not set in effects). Checked with sample data at 1440 and 375px: blog post and author, new/dynamic page, home with all sections open, FAQs, seller home, redirects and the promo-block modal; no overflow. Admin TypeScript and lint pass (the two pre-existing errors in `lib/api.ts` and `lib/useOrderPolling.ts` are untouched).

### Settings — Staff, Security, Notifications, Cache inspector (implemented)
- **Staff** is now a workspace list: All / Active / Suspended tabs with counts, search by name or email, a table of person (initials avatar, name, email), role (Admin / Editor with the granted modules on one line, or "No access yet"), status, added date, and a row menu (Resend invite email, Suspend / Reactivate, Delete) with an arrow to edit; cards on narrow panels.
- **Invite / edit** in the shared modal: name + email (or a reset-password field when editing), an **Admin | Editor** segmented control, and for Editors a module checklist (one row per module, Pages and Blogs with a checkbox per property). A note warns when an Editor has nothing ticked.
- **Security** (master key): identity header with an Active / Not set chip; one panel with the status facts (set on, set by, last used, times changed, last action — in the detail-page field grid) and the set / change form (admin password, new key with a live strength line and Show/Hide, confirm with an inline mismatch error, Change key + Remove key…, and the reason the button is off in words); the rail explains how the key behaves.
- **Notifications**: recipients on the left — one row per address with its label, Paused chip, added/last-sent line, the event chips as toggles, a row menu (Send a test email, Pause / Resume) and a remove button — then the read-only "Always notified" panel; the add-an-address form lives in the rail (email, label, event checklist with descriptions, Add recipient).
- **Cache inspector**: header with the Redis DB chip, Refresh and Delete prefix…; a KPI strip (keys, groups, cached size, average TTL); Quick visuals (four small donuts + group bars); Largest keys, Expiring soonest and Groups tables (a group name filters by that prefix); Advice; Keys by group as collapsible rows. All inspect parameters sit in the rail (prefix, top N, oversize threshold, key details / auto refresh / hide dominant toggles, By keys | By size). Loading is derived from the parameter key, which also cleared this page's two lint errors. The delete-prefix confirm is in the shared modal.
- **Review fixes:** the Testimonial and Promo-block forms now portal their Cancel / Save into the modal's real footer (outside the scrolling body) instead of a sticky bar that overlapped the last section; image tiles in an upload row set their own width so the helper text beside them no longer wraps in a 160px column (home page share image, testimonial photo); the staff row menu gained an explicit **Edit access** item and the module checklist in the invite / edit modal is two columns so it fits a laptop screen; redirect type chips are "301 / 302" + Permanent / Temporary on one line and `StatusChip` never wraps.
- **Brand requests can be deleted** (per row, to clear the queue): a trash button on every entry with a confirm that says what happens — pending: the seller simply never gets an answer (reject with a reason if they should be told); approved: the created brand / category stays; rejected: the seller keeps the rejection they saw. Backend: `DELETE /api/admin/brand-category-requests/:id` (brand-requests permission).
- **Testimonial form, rearranged** to read like the card: photo tile on the left with Name / Business name / Order beside it, then the quote (a shorter editor), and the Published switch moved into the modal footer next to Save — three sections became two, the Placement section is gone, and the whole form fits a laptop screen without scrolling.
- **Notification bell** now opens with a header (title, "N unread", **Mark all as read**) above the Needs attention section, a tidier panel (1px border, 12px radius, compact rows, dimmed read items with the red unread dot) and a proper "You're all caught up" empty state. Mark all as read clears every listed item's key in local storage, the same mechanism as clicking an item. Second pass on UX: only activity from the **last 7 days** is listed (older rows used to pile up as a wall of 30–40-day-old unread items), capped at 12, and grouped **Today / Yesterday / Earlier this week** so it reads top-down in time; order rows clip the product name and show the amount with a short age (`₹4,599 · 3h ago`); read rows reveal a chevron on hover; a footer offers **Orders / Sellers / Requests** quick links. The time helpers (`withinDays`, `dayBucket`) live at module scope so the component body stays pure for the `react-hooks/purity` rule. The sidebar **site switcher** menu uses the shared dropdown look too.
- **Confirm dialogs** (`confirmDialog()` → `components/ConfirmProvider.tsx`) now use the shared modal look instead of HeroUI's stock blurred alert: a red trash icon and "This can't be undone" eyebrow for destructive asks (neutral question icon and "Please confirm" otherwise), the question as the title, the consequences as the sub line, and a Cancel / solid-red confirm footer. `AdminButton` gained a `color="danger"` style for it.
- **One dropdown everywhere:** every native `<select>` in the panel is now `AdminSelect` (the white panel / lime selected row menu the seller dashboard uses), including `MultiPick`'s suggestion list.
- **Lint is clean across the admin app** (`npx eslint .` → 0 problems). The remaining `set-state-in-effect` / `refs` errors were cleared without changing behaviour: list loaders derive "loading" from a request key, prop-driven resets happen as state adjustments during render, storage reads on mount are deferred a tick, the assistant's panel element is held in state for its tooltip portal, and the products page's Search reads its text from a ref so switching scope doesn't refetch on every keystroke.
- **Toggles admin-wide:** every `Switch` in the panel is now `AdminSwitch` (`components/AdminSwitch.tsx` + module CSS) — a 34×20 charcoal track with a plain white thumb, no glow — so the toggles match the 1px inputs beside them. The brand form's rail was also rearranged: Logo, then Visibility (Active, Featured, Order); the main panel keeps details, search engines and page content.

### Delete (archive) orders
- **Product decisions:** any order can be deleted, and deleting **archives** it (hidden, restorable) rather than removing it from the database.
- **Where:**
  - Orders list: a row menu (⋯) with "Delete order…", and a **Deleted** tab with a count. In that tab the menu shows "Restore order", and each row shows who deleted it and when.
  - Order page: "Delete order…" at the end of the action row. A deleted order still opens, with a banner (who, when, reason) and **Restore order**.
- **Dialog:** says what happens. When the order is paid or still live, it warns that deleting doesn't refund the customer or stop a booked parcel (cancel first). Optional reason, kept in the audit log.
- **Hidden from (`Order.NOT_ARCHIVED`):**
  - admin: order list, counts and CSV, shipping errors, dashboard stats and recent orders, customer and seller pages
  - seller: order list, attention counts and returns list
  - customer: order history
  - assistant (MCP): order tools
- **Still visible (by design, so money owed is never hidden):** payment webhooks, the refund queue, settlements/payouts, tracking sync, NDR and today's manifest. Direct links to an order still open.
- **Backend:** `Order.archivedAt / archivedBy / archiveReason`; `POST /api/admin/orders/:idOrNumber/archive {reason}` and `…/restore` (orders permission), both audit-logged (`order.archive` / `order.restore`) with a snapshot; `GET /api/admin/orders?archived=true` plus `archivedCount`. Test: `npm run test:order-archive`.

### Messages and toasts (admin-wide)
- **Rule:** the admin never shows a raw API response. `admin/lib/notify.tsx` decides the wording:
  - `apiMessage(e)` returns the server's text only when it's a sentence written for people (a 4xx guard rail such as "This order is already deleted."). For 500s, crashes, validation dumps, "Not found - /api/…", raw ids and stack traces it returns `''`, so the page's own fallback shows.
  - It has fixed wording for: server unreachable, timeout, no permission (403), file too large (413) and too many attempts (429).
  - "Duplicate slug: …" becomes "That URL is already in use."
- **Toasts have two lines:** what didn't happen (title) and why, in plain words.
  - Errors: `notifyError(e, 'Couldn’t delete the brand')`.
  - Success: `notifySuccess(title, detail?)`.
  - Our own warnings: `notifyWarning(title, detail?)`.
  - The toaster is restyled to the workspace panel look (`app/providers.tsx`).
- **Sweep:**
  - All 145 raw `e?.response?.data?.message || …` reads in 60 admin files now go through the helpers.
  - Vague fallbacks became titles ("Delete failed" → "Couldn’t delete", "Failed to load brands" → "Couldn’t load brands").
  - Success toasts that echoed the server now use our own wording: refunds report sent / submitted / rejected / lost per the response state, and the seller-delete cleanup warnings no longer show raw Shiprocket or S3 errors.
- **For new code:** never read `response.data.message` directly; use `apiMessage`, `notifyError` or `notifySuccess`.

#### Message catalog (admin and seller dashboard)
- **One file per app holds every toast message:** `admin/lib/messages.ts` (257 entries, 30 sections) and `frontend/lib/messages.ts` (217 entries, 33 sections — seller dashboard and storefront). Grouped by section (`orders`, `refunds`, `kyc`, `productForm`, …), each entry is a title string, a `{ title, detail }` pair for a two-line toast, or a function taking the dynamic parts, e.g. `orderDeleted: (orderNumber) => ({ title: \`Order ${orderNumber} deleted\`, detail: 'Restore it any time from the Deleted tab.' })`.
- **Call sites reference the catalog:** `notifyError(e, M.orders.couldntDeleteTheOrder)`, `notifySuccess(M.kyc.codeSentToItExpiresIn10(data.sentTo))`. Changing wording means editing `messages.ts` only. Keys are derived from the text, so a renamed message keeps its key until someone renames it deliberately.
- **Seller dashboard got the same sweep as the admin:** `frontend/lib/notify.tsx` (identical to the admin's), every raw `response.data.message` read (104 in 35 files) converted, the old `errorMessage()` in `lib/api.ts` now delegates to it, and the toaster restyled in `app/providers.tsx`. Dev-only hints ("Is the backend running on port 5000?") were replaced with user wording.
- **Deliberately still inline:** confirm-dialog titles and bodies, inline error panels and form validation text under fields — only toasts moved. One toast builds its text from cart delivery checks (`CartPage` `deliveryError`) and stays computed.
- **Server text that is still shown**, only when it reads as a sentence (`serverText()`): the media "still in use on product X" reason, the parcel-verification note, Razorpay's payment-failure description and the courier's pickup-booking reason.

### Next sections
1. ~~Dashboard overview.~~ 2. ~~Orders~~ (incl. checkout failures, failed pushes, COD remittance). 3. ~~Sellers and KYC.~~ 4. ~~Refunds and settlements.~~ 5. ~~Customers and carts.~~ 6. ~~Catalogue (brands, categories, requests, shop by bike).~~ 7. ~~Content (pages, blogs, testimonials, media) — lists and editors.~~ 8. ~~Settings: Staff, security, notifications, cache.~~ Every section is done; what remains is review feedback.
