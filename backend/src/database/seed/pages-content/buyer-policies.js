/** System page copy for buyers: Privacy Policy, Terms of Use, Returns & Refunds, Shipping, Cancellation (markdown). */
const { ENTITY, ADDRESS, GSTIN, CONTACT, JURISDICTION, ENTITY_BLOCK } = require('./legal-entity');

// ── Privacy Policy (DPDP-ready, two-sided) ─────────────────────────
const PRIVACY_POLICY = `THROTTLEIN is an online marketplace for motorcycle helmets, riding gear, parts, and accessories, owned and operated by **${ENTITY}** ("THROTTLEIN", "we", "us", or "our"). This Privacy Policy explains how we collect, use, share, and protect personal data when you use our website and services. It is aligned with India's Digital Personal Data Protection Act, 2023 (DPDP) and the Information Technology Act, 2000 and rules made under it.

By using THROTTLEIN, you consent to the practices described here.

## Who we are

${ENTITY_BLOCK}

For any privacy question or grievance, contact our Grievance Officer at **${CONTACT}** (see "Grievance Officer" below).

## Data we collect — buyers

- **Identity & contact** — name, email, phone number, password.
- **Order & delivery** — shipping/billing address, items purchased, order history.
- **Payment** — handled by our payment partner (Razorpay). We do **not** store your full card number, UPI PIN, or banking credentials.
- **Device & usage** — IP address, device/browser type, pages viewed, and searches, collected via cookies and similar technologies.

## Data we collect — sellers

- **Business details** — legal/trade name, business address, contact person.
- **Tax & compliance** — GSTIN and related tax information.
- **KYC** — identity and business verification documents required to onboard.
- **Settlement** — bank account details used to pay you.

## How we use your data

- Create and manage your account.
- Process orders, payments, shipping, returns, refunds, and seller settlements.
- Hand off delivery details to our logistics partner to fulfil orders.
- Verify seller identity, prevent fraud, and keep the marketplace safe.
- Communicate order updates, support responses, and (with consent) offers.
- Improve our products and services, and comply with legal obligations.

## How we share your data

THROTTLEIN is a marketplace, so some sharing is necessary to fulfil an order:

- **Sellers** receive the buyer information needed to pack and dispatch the order (such as name and delivery address). Sellers are independent third parties responsible for their own use of that data.
- **Logistics partners** (e.g. our shipping aggregator, Shiprocket) receive delivery details to ship and track parcels.
- **Payment partner** processes transactions; card/UPI data is handled by the gateway, not by THROTTLEIN.
- **Service providers** who help us run the platform (hosting, analytics, communications), under confidentiality obligations.
- **Legal/regulatory authorities** when required by law, court order, or to protect our rights and users.

We do **not** sell your personal data.

## Cookies & tracking

We use cookies to keep you signed in, remember your cart, measure traffic, and improve the site. You can control cookies through your browser settings; some features may not work without them.

## Data security

We follow reasonable security practices and procedures to protect personal data, including encrypted connections (HTTPS) and access controls, consistent with Section 43A of the IT Act. No method of transmission over the internet is completely secure, so we cannot guarantee absolute security.

## Data retention

We retain personal data only for as long as necessary to provide our services, comply with legal, tax, and regulatory obligations, resolve disputes, and enforce our agreements — after which it is deleted or anonymised.

## Your rights as a Data Principal

Under the Digital Personal Data Protection Act, 2023, and subject to applicable law, you have the right to:

- **Access** a summary of the personal data we process about you.
- **Correction, completion, and updating** of inaccurate or incomplete data.
- **Erasure** of your personal data when it is no longer needed for the stated purpose.
- **Withdraw consent** at any time (withdrawal does not affect processing already carried out).
- **Nominate** another individual to exercise your rights in the event of death or incapacity.
- **Grievance redressal** through our Grievance Officer (see below).

To exercise any of these rights, email **${CONTACT}**. We may retain certain data where required by law.

## Children's data

THROTTLEIN is not intended for individuals under 18. We do not knowingly collect data from children; where applicable, processing requires verifiable parental consent.

## Cross-border transfers

Where data is stored or processed outside India by our service providers, we take steps to ensure it is protected in line with applicable law.

## Grievance Officer

In accordance with the Information Technology Act, 2000 (and the SPDI Rules, 2011), the IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, and the Digital Personal Data Protection Act, 2023, you may raise any data or privacy concern with our Grievance Officer:

- **Name:** Yuvraj Srivastav
- **Email:** ${CONTACT}
- **Address:** ${ENTITY}, ${ADDRESS}

We will **acknowledge** your complaint within **48 hours** and **resolve** it within **30 days** of receipt, or sooner where the law requires.

## Changes & governing law

We may update this Privacy Policy from time to time; the "Last updated" date above reflects the latest revision. This policy is governed by the laws of India, with jurisdiction in the courts of ${JURISDICTION}.

## Contact us

Questions about this policy? Email **${CONTACT}**.

${ENTITY_BLOCK}`;

// ── Buyer Terms of Use ─────────────────────────────────────────────
const TERMS_OF_USE = `These Terms of Use ("Terms") govern your access to and use of the THROTTLEIN website and services as a buyer. By using THROTTLEIN, you agree to these Terms. If you do not agree, please do not use the platform.

These Terms, together with our policies, are framed in line with the Information Technology Act, 2000, the Consumer Protection Act, 2019, the Consumer Protection (E-Commerce) Rules, 2020, and the IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021.

## 1. About THROTTLEIN

THROTTLEIN is a brand owned and operated by **${ENTITY}** (GSTIN: ${GSTIN}). THROTTLEIN is an online marketplace for motorcycle helmets, riding gear, parts, and accessories.

## 2. Marketplace nature (important)

THROTTLEIN is an **intermediary / marketplace** under the Information Technology Act, 2000 — it is **not the seller** of the products listed. Products are sold by independent third-party sellers, and the contract of sale is directly between you and the relevant seller. THROTTLEIN provides the platform that connects buyers and sellers and facilitates payments and logistics.

## 3. Eligibility & account

- You must be at least 18 years old and able to enter into a binding contract.
- Keep your login credentials confidential; you are responsible for all activity under your account.
- Provide accurate, current, and complete information.

## 4. Pricing & payment

- Prices are set by sellers, listed in Indian Rupees (INR), and inclusive of applicable taxes unless stated otherwise.
- Payments are processed securely through our payment partner; card/UPI data is handled by the gateway.
- Cash on Delivery (COD) may be available on eligible orders at the seller's discretion.

## 5. Orders

Placing an order is an offer to buy. A contract is formed when payment is authorised and the seller accepts the order. We or the seller may cancel an order in cases of stock unavailability, suspected fraud, or pricing errors.

## 6. Shipping, returns & cancellations

Delivery, returns/refunds, and cancellations are governed by our [Shipping & Fulfillment Policy](/shipping-policy), [Returns, Refunds & Cancellations Policy](/return-and-refund-policy), and [Cancellation Policy](/cancellation-policy), which form part of these Terms.

## 7. Buyer obligations

You agree to use the platform lawfully, provide accurate information, and not engage in fraud, abuse, or return abuse (e.g. serial returns).

## 8. Reviews & user content

You may post reviews and content that is honest and lawful. No fake or incentivised reviews, no offensive or infringing content. You grant THROTTLEIN a licence to display content you submit. We may remove content that violates these Terms.

## 9. Prohibited conduct

No scraping, fraud, intellectual-property misuse, attempts to disrupt the platform, or unauthorised access.

## 10. Intermediary disclaimer & limitation of liability

Product quality, authenticity, and fulfilment are the responsibility of the seller. To the maximum extent permitted by law, THROTTLEIN is not liable for indirect or consequential damages, and our aggregate liability is limited to our role in facilitating the transaction.

## 11. Intellectual property

The THROTTLEIN name, logo, and platform content are owned by ${ENTITY} or its licensors and may not be used without permission.

## 12. Grievance redressal

In accordance with the Consumer Protection (E-Commerce) Rules, 2020 and the IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, our Grievance Officer can be reached at:

- **Name:** Yuvraj Srivastav
- **Email:** ${CONTACT}
- **Address:** ${ENTITY}, ${ADDRESS}

We will **acknowledge** any complaint within **48 hours** and **redress** it within **one month** of receipt (and, for intermediary-related grievances, within the timelines prescribed by the 2021 Rules).

## 13. Dispute resolution & governing law

These Terms are governed by the laws of India. Disputes are subject to the exclusive jurisdiction of the courts of ${JURISDICTION}.

## 14. Changes & termination

We may revise these Terms or suspend/terminate access for breach. Continued use after changes constitutes acceptance.

## 15. Contact us

Questions about these Terms? Email **${CONTACT}**.

${ENTITY_BLOCK}`;

// ── Returns, Refunds & Cancellations Policy ────────────────────────
const RETURN_REFUND_POLICY = `This policy explains how returns, exchanges, refunds, and cancellations work on THROTTLEIN, and is provided in line with the Consumer Protection Act, 2019 and the Consumer Protection (E-Commerce) Rules, 2020. THROTTLEIN operates an **exchange-first** model: most returns are resolved by replacement/exchange, with refunds limited to specific cases described below. Because THROTTLEIN is a marketplace, returns are fulfilled by the seller of your item, with THROTTLEIN acting as facilitator and mediator.

## Return window

You may raise a return/exchange request within **5 days** of delivery, unless a longer window is stated on the product page.

## Return eligibility

To be eligible, the item must be returned:

- Authentic and exactly as dispatched by the seller.
- Unused and in original, fully-packed condition with all **tags, manuals, bills, and invoices**.
- Undamaged — items damaged by the buyer after delivery are not eligible.

## Return reasons & who pays return shipping

- **Defective, wrong item, or damaged in transit** — the **seller** bears the return shipping and resolves it via replacement or, where a replacement isn't possible, a refund.
- **Size/fit or change of mind** (where allowed) — resolved by **exchange only**, and the **buyer** bears the return shipping. Change-of-mind returns are not eligible for a cash refund.

## Refunds (when they apply)

Refunds are issued only where an exchange/replacement is not possible — for example, a confirmed defective/wrong item that is out of stock, or an order the seller cannot fulfil. When due:

- The refund is made to the **original payment method** (or to your bank/UPI for COD orders).
- Refunds are processed after the returned item is received and inspected, typically within **5–7 business days**; your bank may take additional time to reflect the credit.

## Return process

1. Go to **My Account → Orders**, open the order, and choose **Return / Replace** with a reason.
2. The seller (with THROTTLEIN's oversight) reviews the request.
3. If approved, a pickup is scheduled via our logistics partner (Shiprocket), or return instructions are shared.
4. The item is inspected against the eligibility conditions above before the exchange/refund is completed.

## Replacements & exchanges

Where available, you can exchange for a different size or an identical replacement. If the item is unavailable, a refund is processed instead (per the refund rules above).

## Cancellations

- **Buyer-side:** you can cancel **before dispatch** at no cost from **My Account → Orders**. Once dispatched, an order cannot be cancelled — use the return/exchange flow instead.
- **Seller-side:** a seller may cancel if the item is out of stock or cannot be fulfilled; prepaid amounts are refunded.

See the [Cancellation Policy](/cancellation-policy) for full details.

## Non-returnable items

For safety, hygiene, and authenticity reasons, the following are generally **not** returnable unless they arrive defective or damaged in transit:

- Helmets and protective gear that have been used or whose seal/tag is removed (safety standards).
- Custom-made or fitted gear.
- Items returned without original tags, bills, or invoices.
- Items damaged or altered by the buyer.

## Abuse & fraud

Fraudulent claims, tampering, or serial/return abuse may lead to rejected returns and account action.

## Dispute resolution

If a buyer and seller disagree on a return, THROTTLEIN will mediate and take a fair decision based on the evidence (photos, tracking, condition on inspection).

## Safety note — helmets & protective gear

Helmets and protective equipment protect lives. Returns of such items are restricted by safety and hygiene standards; used or seal-broken safety gear cannot be resold and is therefore non-returnable except for genuine defects.

## Contact us

Need help with a return? Email **${CONTACT}** with your order number.

${ENTITY_BLOCK}`;

// ── Shipping & Fulfillment Policy ──────────────────────────────────
const SHIPPING_POLICY = `This Shipping & Fulfillment Policy explains how orders on THROTTLEIN are shipped. THROTTLEIN operates a **seller-fulfilled** model: products ship directly from the seller's own location, with logistics handled through our partner, Shiprocket.

## Who ships

Orders are fulfilled by the **seller** of each item (direct-vendor model) and shipped from the seller's warehouse/location.

## How an order moves (Shiprocket flow)

1. Buyer places the order.
2. The seller is notified on their dashboard.
3. The seller books the shipment and generates a label / schedules pickup via Shiprocket.
4. The parcel is handed to the courier and a tracking link is shared with the buyer.

## Who pays for shipping

Shipping cost depends on the seller's setting: it is either **charged to the buyer at checkout** or **borne by the seller**. The amount payable (if any) is shown at checkout before you pay.

## Delivery coverage

We deliver to serviceable PIN codes **across India** (subject to courier serviceability). We do not currently offer international shipping.

## Dispatch & delivery timelines

- **Dispatch:** sellers are expected to dispatch within their stated dispatch SLA (typically up to **10 days**).
- **Delivery:** orders typically arrive within about **10 days** of dispatch, depending on destination. Estimates are indicative, not guaranteed.

## Order tracking

Once the shipment is booked, a tracking link is provided. You can also track from **My Account → Orders**.

## Cash on Delivery (COD)

COD may be offered at the seller's discretion (configurable on the seller dashboard). Where offered, the buyer bears any applicable COD handling charge shown at checkout.

## Transit liability

The **seller bears the risk of loss or damage in transit**. Where a shipment is insured, the **delivery partner/insurer** bears the loss as per their terms.

## Failed delivery / RTO

If a shipment cannot be delivered (incorrect address, repeated unavailability, or refusal) and is returned to origin (RTO), the **seller bears responsibility** for the RTO. We will contact the buyer to arrange re-shipment (charges may apply) or a resolution per our policies.

## Packaging standards

Sellers are responsible for secure, tamper-evident, and appropriately branded packaging so products arrive undamaged.

## Restricted & oversized items

Certain motorcycle-gear items may face shipping restrictions (e.g. batteries, aerosols/lubricants, or bulky exhausts) depending on courier rules. Such items may have longer timelines or limited serviceability.

## Contact us

Questions about shipping? Email **${CONTACT}** with your order number.

${ENTITY_BLOCK}`;

// ── Cancellation Policy ────────────────────────────────────────────
const CANCELLATION_POLICY = `This Cancellation Policy explains when and how an order on THROTTLEIN can be cancelled. It works together with our [Returns, Refunds & Cancellations Policy](/return-and-refund-policy).

## Buyer cancellation — before dispatch

You can cancel an order free of charge **before it is dispatched**:

1. Go to **My Account → Orders** and open the order.
2. Choose **Cancel order** and confirm.

If you've already paid, the amount is refunded to your original payment method.

## Buyer cancellation — after dispatch

Once an order has been dispatched it can no longer be cancelled. You may refuse delivery or raise a return/exchange after delivery, subject to the [Returns, Refunds & Cancellations Policy](/return-and-refund-policy).

## Seller / THROTTLEIN cancellation

An order may be cancelled by the seller or THROTTLEIN if:

- The item is out of stock or cannot be fulfilled.
- There is an obvious pricing or listing error.
- The transaction is suspected to be fraudulent or unauthorised.
- The delivery address is outside the serviceable area.

Prepaid amounts for such cancellations are fully refunded.

## Partial cancellation

For orders containing items from multiple sellers, you may cancel individual items that haven't yet been dispatched while keeping the rest of the order.

## Cash on Delivery (COD)

COD orders can be cancelled before dispatch at no cost. Repeated refusal of COD deliveries may affect your ability to use COD in future.

## Refund timeline

Where a refund is due on cancellation, it is processed to the original payment method, typically within **5–7 business days**; your bank may take additional time to reflect the credit.

## Contact us

Need help cancelling an order? Email **${CONTACT}** with your order number.

${ENTITY_BLOCK}`;

module.exports = { PRIVACY_POLICY, TERMS_OF_USE, RETURN_REFUND_POLICY, SHIPPING_POLICY, CANCELLATION_POLICY };
