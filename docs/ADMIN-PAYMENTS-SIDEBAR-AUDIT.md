# Payments navigation audit

9 November 2026. Source inspection before implementation; no database, provider, worker, browser or automated-test execution.

## Existing inventory and preservation baseline
The Next App Router console uses AdminShell and a shared server-authenticated, allowlisted API proxy. Flat sidebar order: Dashboard, Shops, Customers, Transactions (customer ledger), Subscriptions, Refer & Earn, Payments, Payment Orders, Administrators, Reports & analytics, Audit logs, Settings. Desktop collapse and Radix mobile drawer share navigation; all destinations must remain accessible.

Routes already implemented: /admin/payments, /admin/payment-orders, /admin/payment-orders/[id]. The payment dashboard is ResourcePage(payments) -> PaymentOrders in components/admin/tables/payment-orders.tsx (historical component name). It retains five summaries, reconciliation health, five tabs (attempts, missing-order recovery, verification/reconciliation, refunds, webhook recovery), latest-20 tables, pagination, refresh, permission-gated Verify with gateway and diagnostic errors. Its verification slot includes SubscriptionSummary and ResourceTable payments. Shop Details reuses the same controls with shop scope. No standalone webhook, recovery, refund or payment-transaction page exists.

The complete Payment Orders module already provides seven aggregate cards, advanced filters, searchable shops, 20/50/100 pagination, stable sorting, historical pricing/wallet data, order detail, payment detail dialog, subscription/refund/webhook evidence, permission-gated audits and shop navigation. Reuse it unchanged. Customer ledger Transactions, Opening Balance Summary, ShopFinancialOverview's nine cards, customer/subscription tables and all unrelated routes remain unchanged.

## APIs and architecture
Existing authenticated /api/v1/admin GET endpoints: payments, payments/:id, payment-orders, payment-orders/:id, payment-orders/:id/records, payment-recovery-events, payment-recovery-snapshots, payment-refunds, payment-health, subscriptions and shops. Browser accesses /admin/api through the explicit proxy allowlist. readRoutes.js delegates to readModels.js and paymentOrders.js. Existing POST payment-orders/:id/reconcile additionally requires payments:reconcile, recent authentication, rate limiting and audit. Preserve it; new monitoring must never invoke it automatically.

The old recovery/refund/event endpoints provide limited latest-record browsing; their generic filter parser accepts search/status, but these services do not implement those matches. Recovery snapshots intentionally select records with a diagnostic code, not all recovery evidence. New detailed monitoring requires validated filters without changing those existing response semantics.

## Models, collections and relationships
Mongoose default pluralization (no alternate collection option): PaymentOrder/paymentorders, PaymentTransaction/paymenttransactions, PaymentWebhookEvent/paymentwebhookevents, PaymentOrderRecovery/paymentorderrecoveries, PaymentRefund/paymentrefunds, ShopSubscription/shopsubscriptions and SubscriptionAuditLog/subscriptionauditlogs. Timestamps use createdAt/updatedAt; autoIndex is false. Installed database indexes were not inspected.

PaymentTransaction.orderId is a local ObjectId; gatewayOrderId is a provider string and gatewayPaymentId identifies an actual provider attempt. One order can have many attempts. Unique gatewayPaymentId and subscription source indexes protect independent identities. Order gatewayOrderId has a unique sparse index; checkout reservation and idempotency indexes remain untouched. Wallet-only paid orders legitimately have no Cashfree attempt.

Webhook orderId is a provider string, NOT a local ObjectId. eventId is the raw-body hash deduplication identity, not a provider event identifier. Status is received/processed/failed. attempts counts recorded failures/retries; there is no duplicate-delivery count or separate provider event timestamp. Raw bodies/signatures are not available for safe display.

Recovery _id is the original local order ID. Records hold immutable server-authored purchase snapshots and next reconciliation/code. They are persistent evidence, not jobs: no explicit status, attempt count or completion timestamp exists. Parent existence can be reported as a derived relationship, never as successful payment/recovery completion. Snapshot must not be serialized wholesale.

Refunds link local order, shop, gateway order/payment/refund and merchant refund IDs. Actual provider statuses include SUCCESS/PENDING/CANCELLED/ONHOLD/FAILED. verifiedAt means provider checked, not refund completed. No stored reason/failure narrative or structured dispute model exists. Unknown lifecycle/dispute webhook evidence may be retained for review; it is not a dispute ledger.

Subscriptions bind sourcePaymentOrderId or historical sourcePaymentId with shop checks. Captured payment alone is not proof of entitlement activation. Existing order detail exposes actual linked records without running transitions.

## Processing and authorization
Cashfree raw-body HMAC verification, durable webhook inbox, authenticated provider re-verification, attempt persistence and transactional fulfillment already exist. The reconciliation scheduler starts independently of mobile activity and runs every five minutes, with bounded batches and retries. Missing-order reconstruction uses trusted recovery evidence; refund polling verifies provider state and does not initiate refunds. No processing change is needed for navigation.

Existing session/proxy/origin checks and payments:read gate global read access for ADMIN/SUPER_ADMIN; SUPPORT lacks it. Only SUPER_ADMIN has payments:reconcile. There is no shop-assignment authorization model. All new reads must enforce current APP_MODE, validate query/ID input, whitelist fields and bind related records by actual order/shop/provider references. Legacy attempts without appMode require parent evidence. Never return paymentSessionId, lease tokens, request hashes, snapshots, raw payloads or credentials.

## Findings
- Medium, confirmed: four dedicated payment monitoring destinations are absent; most capabilities are nested in dashboard tabs.
- Medium, confirmed: existing event/refund/recovery reads lack complete filtering and sorting; preserve old contracts and add a shared read-only monitoring endpoint with bounded pagination.
- Medium, confirmed: no structured dispute lifecycle. Display unavailable explicitly; do not invent records or initiation controls.
- Low, confirmed: recovery evidence cannot support job/completion metrics; webhook retry failures cannot be labeled delivery count.
- Potential, unverified: historical dangling references, incorrectly installed indexes and expensive cross-collection queries. No actual database defect established. Use projections, validated exact identifier/prefix searches, stable pagination and deadlines; operational explain/index review requires separate approval.

## Plan and compatibility boundaries
Add an expandable Payments group at the existing Payments location, preserving both existing URLs and all unrelated navigation. Add four server-permission-gated pages using a shared monitoring table/detail component and read-only filtered API. Reuse existing order links, table/feedback/modal styles, query cancellation and payment health. Preserve original dashboard tabs/actions and original endpoints unchanged. No new financial metrics will combine currencies, wallet funds or pending observations. No schemas, indexes, credentials, processing services or production records will change.

Runtime delivery, database relationships, worker health and responsive authenticated browser behavior remain unverified. Static validation cannot establish production readiness.
