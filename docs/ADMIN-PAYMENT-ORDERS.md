# Admin Payment Orders
Implementation: 9 November 2026. Source audit: ADMIN-PAYMENT-ORDERS-AUDIT.md, written before implementation.

## Routes and preservation
Payment Orders is added immediately after Payments in the existing sidebar, permission payments:read.
- /admin/payment-orders — read-only global order monitoring.
- /admin/payment-orders/[id] — actual local MongoDB PaymentOrder _id.
- Optional return query carries list filters/sort/page back to the list. Optional attempt query opens a matching sanitized payment-detail dialog.
- Shop links reuse /admin/shops/[id]. Subscription navigation reuses that shop's existing Subscription records section (#shop-subscription-records), not a new subscription implementation.
- Original Payments dashboard, reconcile actions, tabs, filters and pagination remain. Its order rows gain explicit local order links; shared payment ResourceTable gains Payment Order ID, covering global and shop-specific payment views. Verified refund and webhook tables retain provider IDs and gain resolved local order links.
- Customer ledger Transactions, Opening Balance Summary and all nine Shop Financial Overview cards are untouched.

## APIs
All behind existing /api/v1/admin authentication and frontend /admin/api allowlisted proxy.
- GET /payment-orders: extended existing endpoint; backward-compatible data[] and pagination, additive summary[] grouped by currency.
- GET /payment-orders/:id: projected order, shop, historical pricing/preview outcome and aggregate relationship counts.
- GET /payment-orders/:id/records?kind=attempts|subscriptions|refunds|webhooks|audit|adminAudit&page=1&limit=20: paginated related records.
- GET /payments/:id: projected existing payment transaction, environment checked, resolved parent or null.
- Existing GET /payments, /payment-refunds, /payment-recovery-events add resolvedOrderId through batched lookup.
- Existing POST /payment-orders/:id/reconcile is unchanged. New UI invokes no POST, PATCH or DELETE.
- GET /customer-shops reused for searchable shop selection.

## Identity and association
PaymentTransaction.orderId is the local ObjectId. gatewayOrderId is Cashfree order_id; gatewayPaymentId is cf_payment_id. Display all independently.
Local order links are returned only for stored current-environment parents matching shop/provider references. No dk_ identifier parsing, fabrication, record creation, automatic repair or provider reconciliation is done by these reads. Missing references show “Order reference unavailable”; missing detail returns404.
Legacy transactions without appMode require a validated current-environment parent/recovery context. Conflicting explicit environments are excluded.
Related attempt/refund/subscription reads bind the actual shop and order. Legacy subscription sourcePaymentId is supported only through a matching transaction; explicit conflicting sourcePaymentOrderId is not overridden.
Full-wallet paid orders may legitimately have no gateway order/payment, and their subscription linkage remains visible.

## Summary definitions
Filtered server-side aggregate, not current-page summation:
1. Total Payment Orders — matched order documents once each.
2. Paid Orders — local status paid.
3. Pending Orders — local created/pending.
4. Failed Orders — local failed, not a failed latest attempt.
5. Provider Expired Orders — cached gatewayOrderStatus EXPIRED; may overlap local pending.
6. Orders Requiring Attention — recorded payment/refund reconciliation errors, duplicate/mismatched captures, paid/refunded order missing linked entitlement, or provider PAID while local created/pending/failed.
7. Verified Paid Amount — gross verified capture observations with verifiedAt, captured/refunded/partially_refunded status, matching currency and order amount. Wallet funds excluded; refunds not subtracted. Multiple distinct verified provider captures included once per ID, including additional-order captures flagged for review. Duplicate documents sharing a provider payment ID are excluded from the monetary sum and flagged. This is not net revenue or total subscription value.
No currencies are combined. No zero is fabricated on API failure. With no matching orders the monetary card explicitly says so.

## Table and details
Order table: clickable local ID with copy, Cashfree order ID, shop link/ID/mobile, historical plan/duration, cash payable/currency, local order/provider order/latest-attempt statuses, unique provider-attempt count, gross verified amount, verification/reconciliation/subscription state, Created At, Updated At, checkout expiry and View.
Details: safe order metadata, local and gateway IDs, app/environment policy, historical price/discount/tax/wallet values, preview outcome when stored, current stored subscription state, actual subscription dates/renewal/preserved-time fields, shop, last reconciliation/check/next retry/count/error codes.
Payment attempts: every matching associated record is server-paginated; local/provider statuses and verification remain separate. Click ID or View for the existing transaction's sanitized fields and clickable parent. Missing failure reason is not invented.
Refunds: real verified provider observations, local/provider refund IDs, amount/currency, payment reference, current provider status, verification and entitlement-review flag. No refund initiation.
Webhook/dispute evidence: existing inbox event types/status, provider references, retry count, error code, next retry and actual received/processed timestamps. Unknown dispute events are not interpreted as settled financial status.
Subscription and Admin audit records are separately paginated, with audit:read required. No arbitrary raw metadata, IP/headers or previous/new payloads returned.
Timeline is explicitly a partial view of order anchors plus the current related-record page, sorted by actual timestamps. It does not invent checkout-open, payment-failed/succeeded or refund-completed times from Updated At. Paging exposes further stored evidence; it is not advertised as a complete immutable event stream.

## Search, filters and sorting
- Search exact local order/transaction IDs, provider order/payment IDs and provider reference ID; shop name/mobile uses escaped anchored prefixes. Shop search matches are capped200; broader searches return a refine-search error.
- Searchable shop selector uses existing authorized endpoint, max50 options with loading/empty/retry states, name/mobile/exact shop ID search.
- Local order status; latest provider attempt; cached provider order status; reconciliation pending/error/checked/unverified; stored subscription status or missing; verified refund status.
- Plan code and integer duration; minimum/maximum cash payable in INR.
- Attempts none/multiple/successful/failed/pending; attention required.
- Created At, Updated At, checkout expiry, latest payment initiation date. UTC inclusive day ranges and Today/Yesterday/7/30 days/current/previous month/custom presets.
- Sort created/updated/amount/status/shop name/latest payment initiation/expiry, both directions; _id stable secondary. Existing newest/oldest/name values remain accepted.
- Server pagination default20, frontend20/50/100, numbered pages/ranges/previous/next. Existing bounded API limits below20 remain accepted for compatibility.
- Debounced search, request cancellation through existing query hook, URL-persisted list state, removable filter chips, reset retaining sort/page size, page1 on filter changes. Invalid amount/date ordering blocks automatic requests.

## Status boundaries
Local orders: created,pending,paid,failed,refunded,partially_refunded.
Transactions: captured,pending,failed,refunded,partially_refunded; separate verified/unverified.
Cached provider attempt: SUCCESS,FAILED,PENDING,USER_DROPPED,CANCELLED,VOID,NOT_ATTEMPTED as recognized by existing processing.
Provider order expiry/termination is not a local failed payment. A USER_DROPPED attempt may coexist with ACTIVE order. Refund observations do not imply subscription cancellation. Stored subscription state is not recalculated by opening this page.

## Security and read-only guarantees
payments:read required for all new APIs and server-rendered pages. Current ADMIN/SUPER_ADMIN roles are global; SUPPORT is denied. Repository has no shop-scoped admin assignment model; no new grants or hypothetical scopes were added. All records/joins are scoped to current APP_MODE and actual ownership. Audit categories additionally require audit:read. Existing trusted proxy, origin, session, CSRF and rate limiting remain intact.
Whitelisted fields only: checkout paymentSessionId, raw provider payloads, requestHash, preview state fingerprint, idempotency keys, lease tokens, credentials and authorization headers are excluded. Even historical pricing is explicitly projected.
New services import only models/read utilities, never paymentProvider, verifyPayment, refund handlers or transition workers. Financial records are not changed. Existing authentication may update session activity as before.

## Performance and index review
No browser-side pagination, application N+1 lookup or unbounded related-record response. Aggregate joins produce counts/status sets, related records are independently paginated. Existing unique/order/shop/reference indexes are used; aggregate deadlines10s, bounded preliminary lookups5s. Search performs at most bounded shop/attempt resolution before the order query. Queries with very broad historical filters and deep offsets still need representative explain/latency acceptance.
No indexes were created or changed. Deployment review should evaluate current plans for appMode+createdAt orders, webhook appMode+orderId+createdAt, and admin audit targetType+targetId+createdAt; add only through approved index migration. Do not claim million-record performance from compilation.

## Legacy/unsupported fields
- No structured dispute model/API, dispute amounts/status/reason workflow.
- Refund reasons and payment failure text are not stored.
- No universal purchase/upgrade-type enum. Show historical confirmed preview and renewal links, never infer a purchase classification from today's plan.
- Shop has no native lifecycle status field; owner's login status is not substituted.
- Missing price/snapshot/timestamps/entitlement linkage remain unavailable.
- Corrupt cross-shop/currency/provider references are not silently associated or repaired. Existing unresolved/missing-order review remains in Payments.
- Idempotency internals intentionally not exposed.
- No dedicated existing refund/subscription detail page is fabricated; in-page records and existing shop subscription view are reused.

## Files
Created:
- server/src/admin/services/paymentOrders.js
- server/src/admin/validators/paymentOrders.js
- website/src/app/admin/(console)/payment-orders/page.tsx
- website/src/app/admin/(console)/payment-orders/[id]/page.tsx
- website/src/components/admin/tables/payment-order-management.tsx
- website/src/components/admin/shared/payment-order-link.tsx
- docs/ADMIN-PAYMENT-ORDERS-AUDIT.md
- docs/ADMIN-PAYMENT-ORDERS.md

Modified:
- server/src/admin/routes/readRoutes.js
- server/src/admin/services/readModels.js
- website/src/app/admin/api/[...path]/route.ts
- website/src/app/admin/admin.css
- website/src/components/admin/layout/shell.tsx
- website/src/components/admin/filters/transaction-filters.tsx (export existing ShopSelect only)
- website/src/components/admin/tables/payment-orders.tsx
- website/src/components/admin/tables/resource-table.tsx
- website/src/components/admin/tables/shop-detail.tsx (subscription anchor only)

## Validation and deployment limits
Static validation only: Admin typecheck, production build, syntax checks for four backend files, local import inspection and git diff whitespace check. No automated cases/suites or documentation test cases.
No backend startup, MongoDB queries/index changes, provider requests, production record changes, live payments/refunds, commits or pushes.
Both frontend and backend require a controlled deployment/reload; changing the frontend alone cannot install new backend routes. Runtime database responses, authenticated navigation, permissions against real sessions and financial totals remain unverified. No production-readiness claim.
A separate project also listens on IPv4 127.0.0.1:3000 while Digital-Khata's frontend used IPv6 port3000. Confirm the intended server/origin during deployment; the unrelated process was not changed.
