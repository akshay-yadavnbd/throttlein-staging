/** System page copy for sellers: Seller Terms, Seller FAQ, Pricing & Fees, Onboarding handbook (markdown). */
const { ENTITY, CONTACT, JURISDICTION, ENTITY_BLOCK } = require('./legal-entity');

// ── Seller Terms & Conditions / Seller Agreement ───────────────────
const SELLER_TERMS = `These Seller Terms & Conditions ("Seller Agreement") govern your participation as a seller on THROTTLEIN, operated by **${ENTITY}**. By registering or listing products as a seller, you accept this Agreement. It works together with the [Pricing & Fees Schedule](/pricing-and-fees), [Shipping & Fulfillment Policy](/shipping-policy), and [Returns, Refunds & Cancellations Policy](/return-and-refund-policy).

## 1. Eligibility & onboarding

To sell on THROTTLEIN you must provide a valid **GSTIN**, a **bank account** for settlements, and complete **KYC** (business and identity verification). You must be authorised to sell the products you list and comply with all applicable laws.

## 2. Fees & commission (current terms)

THROTTLEIN's current early-seller terms are:

- **Registration fee: NIL** (free).
- **Listing fee: NIL** (free).
- **Marketplace commission: NIL.**

These are **current terms, not permanent** — free until our next policy release. THROTTLEIN may introduce or revise fees with prior notice. See the [Pricing & Fees Schedule](/pricing-and-fees).

## 3. Payment gateway charges

The one cost you bear to transact is the **payment gateway charge of 2.5% + GST** per transaction. It is **charged to the seller** and **deducted at settlement**.

## 4. Tax collected at source (TCS) under GST

As an e-commerce operator, THROTTLEIN is required to collect **TCS at 1%** under **Section 52 of the CGST Act, 2017** on the net value of taxable supplies made through the platform, and to deposit it with the government. This is reflected in your settlement and your GST returns (e.g. GSTR-2X / auto-population). You are responsible for your own GST registration, compliance, and tax invoicing to buyers. *(Please confirm the exact TCS treatment with your CA.)*

## 5. Settlements

Settlements run on a **T+7 day** cycle and are **paid out weekly** to your registered bank account, after deduction of payment gateway charges, applicable TCS, and any returns/refunds/chargebacks.

## 6. Shipping & fulfilment

THROTTLEIN is **seller-fulfilled**. You ship from your own location via Shiprocket. You may choose to **charge shipping to the buyer at checkout** or **bear it yourself**. You must dispatch within the stated SLA, package goods securely, and meet the [Shipping & Fulfillment Policy](/shipping-policy). You bear transit loss unless the shipment is insured, and you bear RTO costs.

## 7. Product authenticity & prohibited items

You must sell only **authentic, genuine products** and **must not** list counterfeit, replica, unsafe, illegal, or otherwise prohibited items. Safety gear (e.g. helmets) must meet applicable standards (such as BIS/ISI certification where required). Listings must be accurate (titles, images, specifications, pricing, and stock) and must carry the disclosures required by the **Legal Metrology (Packaged Commodities) Rules, 2011** (e.g. MRP, net quantity, manufacturer/importer details, country of origin) and the **Consumer Protection (E-Commerce) Rules, 2020** (correct seller and product information). You must not post unfair or misleading information about any goods or services.

## 8. Seller obligations

- Maintain product **authenticity** and quality.
- Keep listings **accurate** and inventory up to date.
- **Dispatch on time** and fulfil orders reliably.
- Handle returns/exchanges as per platform policy.
- Provide reasonable customer support and respond promptly.

## 9. Returns, refunds & cancellations

You will honour the platform's [Returns, Refunds & Cancellations Policy](/return-and-refund-policy). For defective, wrong, or transit-damaged items, you bear return shipping and resolve via replacement or refund.

## 10. Suspension & termination

THROTTLEIN may suspend or terminate a seller account for, among other things: **excessive customer complaints or reports**, selling counterfeit/unauthentic or prohibited products, poor product quality, repeated late dispatch or fulfilment failures, fraud, or breach of this Agreement.

## 11. Liability & indemnity

You are **solely liable** for the authenticity, quality, safety, and legality of the products you sell, and for any loss arising from selling unauthentic or poor-quality products. You agree to indemnify and hold THROTTLEIN harmless from claims, losses, penalties, or expenses arising from your products, listings, or breach of this Agreement.

## 12. Confidentiality & intellectual property

Buyer data shared with you for fulfilment must be used only to fulfil orders and protected accordingly. You must respect THROTTLEIN's and third parties' intellectual property and only use brand assets you are authorised to use.

## 13. Changes, governing law & disputes

THROTTLEIN may amend this Agreement with notice; continued selling constitutes acceptance. This Agreement is governed by the laws of India, with jurisdiction in the courts of ${JURISDICTION}.

## 14. Contact

Seller support and grievances: **${CONTACT}**.

${ENTITY_BLOCK}`;

// ── Seller FAQ ─────────────────────────────────────────────────────
const SELLER_FAQ = `Everything you need to know about selling on THROTTLEIN, in plain language. For the full legal version, see the [Seller Terms & Conditions](/seller-terms) and the [Pricing & Fees Schedule](/pricing-and-fees).

## Getting started

**What is THROTTLEIN?** An online marketplace for motorcycle helmets, riding gear, parts, and accessories, connecting sellers with riders across India.

**Who can sell?** Brands, retailers, distributors, and online/Instagram sellers of genuine motorcycle gear.

**How long does signup take?** About **2 minutes** to register, and you can be **live in ~24 hours** after verification. Short on time? **We'll set up your account for you, free.**

## Eligibility & documents

You'll need a **GSTIN**, a **bank account** for settlements, and **KYC** documents (business + identity) for verification.

## Costs

- **Free to register, free to list, no commission** — current early-seller terms.
- The only cost you bear is the standard **payment gateway charge (2.5% + GST)**, deducted at settlement.
- As an e-commerce operator we also collect **1% TCS under GST**, reflected in your settlement.

See the full [Pricing & Fees Schedule](/pricing-and-fees).

## Listing products

Upload products individually or via **bulk upload**, with images and specifications. Listings go live after a quick review. You can edit listings anytime from your dashboard.

## Orders & shipping

THROTTLEIN is **seller-fulfilled** — you ship from your own location via **Shiprocket**. You can **charge shipping to the buyer at checkout** or **bear it yourself**. You're responsible for secure packaging and timely dispatch. See the [Shipping & Fulfillment Policy](/shipping-policy).

## Payments & settlements

You're paid on a **T+7 day** cycle, **weekly**, to your registered bank account. Deductions (gateway charge, TCS, any returns) are shown in your settlement.

## Returns & refunds

THROTTLEIN is **exchange-first**. For defective/wrong/transit-damaged items, the **seller** bears return shipping and resolves via replacement or refund; for change-of-mind, it's an **exchange** and the **buyer** bears return shipping. See the [Returns, Refunds & Cancellations Policy](/return-and-refund-policy).

## Authenticity & competition

Multiple sellers may list the same product. Verified sellers and genuine reviews mean **quality wins**, and founding/early sellers get placement advantages. Selling **authentic** products is mandatory.

## Support

Reach us at **${CONTACT}** for seller support and grievances; we aim to respond promptly.

## Managing your account

You can pause listings, set your store inactive, or leave the platform from your dashboard at any time.

${ENTITY_BLOCK}`;

// ── Pricing & Fees Schedule (one-pager) ────────────────────────────
const PRICING_AND_FEES = `This one-page schedule sets out what it costs to sell on THROTTLEIN. These are **current terms as of the last-updated date above** and may be revised with notice. For the full legal version, see the [Seller Terms & Conditions](/seller-terms).

## What THROTTLEIN charges

| Item | Current charge |
| --- | --- |
| Registration fee | **NIL** (free, until next policy update) |
| Listing fee | **NIL** (free, until next policy update) |
| Marketplace commission | **NIL** (current terms — not "forever", not "ending") |

## What you pay to transact

| Item | Detail |
| --- | --- |
| Payment gateway charge | **2.5% + GST** per transaction — borne by the seller, **deducted at settlement** |
| TCS under GST | **1%** collected at source by THROTTLEIN as an e-commerce operator and deposited with the government |
| Shipping | Seller-fulfilled via Shiprocket — **charged to the buyer at checkout** or **borne by the seller** (your choice) |

## Settlements

- **Cycle:** T+7 days.
- **Payout:** weekly to your registered bank account.
- **Deductions shown:** payment gateway charge, applicable TCS, and any returns/refunds.

## Taxes & invoicing

You are responsible for your own GST compliance and for issuing tax invoices to buyers. THROTTLEIN collects and deposits **1% TCS** on eligible supplies. *(Confirm exact TCS/GST treatment with your CA.)*

## What is NOT charged

THROTTLEIN does not charge you to be on the platform — **no registration fee, no listing fee, and no commission**. You manage your own shipping and bear only the standard payment gateway charge; THROTTLEIN does not add a platform fee on top.

## Effective date

These terms are current as of the **last-updated date shown above** and are clearly revisable. Any change to fees or commission will be communicated before it takes effect.

## Contact

Questions on pricing? Email **${CONTACT}**.

${ENTITY_BLOCK}`;

// ── Seller Onboarding Handbook / Checklist ─────────────────────────
const SELLER_ONBOARDING = `Welcome to THROTTLEIN! This handbook walks you from signup to your first sale. Most sellers go from **signup to live in about 24 hours**. Prefer a hand? **We can set your account up for you, free** — just reach out.

## Before you start — checklist

Have these ready:

- **GSTIN**
- **Bank account** details (for settlements)
- **Business / KYC documents**
- **Product photos** (clear, well-lit)
- **Product information** (titles, specs, pricing, stock)

## Step 1 — Register

Create your account at **/seller/register** — it takes about 2 minutes. (Or ask us to set it up for you.)

## Step 2 — Verify (KYC)

Submit your business and identity documents and GSTIN. We verify and activate your account, usually within ~24 hours.

## Step 3 — Set up your store

Add your store profile: brand info, logo, and a short store description so riders know who you are.

## Step 4 — List your products

Add products individually or via **bulk upload**. Use clear images and accurate specifications, pricing, and inventory. Listings go live after a quick review.

## Step 5 — Configure shipping

Connect Shiprocket, set your **pickup address**, and choose your dispatch settings. Decide whether to **charge shipping to the buyer** or **bear it yourself**. See the [Shipping & Fulfillment Policy](/shipping-policy).

## Step 6 — Go live

Once your listings are approved, your store is live. Watch for your first order notification on the dashboard.

## Step 7 — Manage orders

From your dashboard you can accept orders, print labels, schedule pickups, and mark orders dispatched. Buyers get tracking automatically.

## Step 8 — Get paid

Settlements run on a **T+7 day** cycle, paid **weekly** to your bank account, with deductions itemised. See the [Pricing & Fees Schedule](/pricing-and-fees).

## Best practices

- Write clear, honest listings with great photos.
- Price competitively for the rider audience.
- Dispatch fast and respond quickly.
- Earn genuine reviews — quality wins on THROTTLEIN.

## Founding-seller perks

Early sellers get priority placement and locked-in early-seller terms (free registration, listing, and zero commission — current terms).

## Support & grievances

Need help? Email **${CONTACT}**. For the rules, see the [Seller Terms & Conditions](/seller-terms) and [Seller FAQ](/seller-faq).

${ENTITY_BLOCK}`;

module.exports = { SELLER_TERMS, SELLER_FAQ, PRICING_AND_FEES, SELLER_ONBOARDING };
