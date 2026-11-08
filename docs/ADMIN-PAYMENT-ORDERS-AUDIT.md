# Admin Payment Orders — source audit
Date: 9 November 2026. Completed before implementation. Code inspection only: no database connection, provider calls, backend startup or automated tests.

## Architecture and verified relationships
Mobile subscriptionController delegates checkout/status/verification to subscriptionService. Cashfree server adapter authenticates with server-held x-client-id/x-client-secret/version. app.js installs raw-body parsing before JSON for payment webhooks; controller verifies HMAC over timestamp + exact bytes. paymentWebhookInbox durably stores references, then re-fetches provider state. Reconciliation starts on backend startup and every five minutes (20 candidates, bounded max 50), independently of checkout availability; lease claims and retries preserve unresolved orders. New read-only views must not invoke any of these write services.

Models use Mongoose default collections paymentorders, paymenttransactions, paymentorderrecoveries, shopsubscriptions, paymentrefunds, paymentwebhookevents and subscriptionauditlogs (no explicit alternate collection name in schemas). Base timestamps are createdAt/updatedAt, versionKey false, autoIndex false.

### Exact PaymentOrder fields
Required: _id (Mongo generated), shopId ObjectId, userId ObjectId, appMode string, planId ObjectId, planCode string, durationMonths number, amountMinor number >=0, currency string, immutable pricingSnapshot Mixed, idempotencyKey string, requestHash string.
Other fields: totalAmountMinor; walletAppliedMinor (default0), walletReservationStatus none/reserved/captured/released (default none); gatewayOrderId (Cashfree order_id), gatewayReferenceId (cf_order_id), paymentSessionId (SECRET checkout credential, exclude); confirmedPreview Mixed immutable; providerRequestId; status created/pending/paid/failed/refunded/partially_refunded (default created); scheduledStartAt; checkoutActive(defaultfalse); checkoutExpiresAt; verifiedAt; paymentReconciliationAttempts(default0), paymentReconciliationNextAt, paymentReconciliationLastCode, paymentReconciliationCheckedAt, paymentReconciliationAttemptedAt, paymentReconciliationLeaseToken (exclude); refundReconciliationCheckedAt, refundReconciliationLastCode; gatewayOrderStatus, latestPaymentId, latestPaymentStatus, latestPaymentTime; timestamps.
There is no separate local human-readable order identifier: _id is the local ID. Normal Cashfree ID is dk_<local _id>, but display only stored IDs. amountMinor is cash payable; totalAmountMinor includes wallet contribution. Snapshot contains historical plan, basePriceMinor, discountPercent/discountAmountMinor, taxableAmountMinor, taxPercent/taxRateBps/taxAmountMinor, finalAmountMinor, months/durationMonths, currency, pricingVersion, and optional walletAppliedMinor/cashPayableMinor. Never reprice from current plans.
Indexes: unique(shopId,idempotencyKey); unique partial(shopId,checkoutActive=true); (shopId,createdAt desc,_id desc); unique sparse gatewayOrderId; partial(status,paymentReconciliationNextAt,createdAt) where gatewayOrderId exists.

### Exact PaymentTransaction fields
Required: shopId ObjectId; **orderId ObjectId** (local PaymentOrder _id); provider enum razorpay/cashfree; gatewayPaymentId string; gatewayOrderId string; amountMinor; currency; status captured/failed/refunded/partially_refunded/pending; verificationStatus verified/unverified.
Other: appMode(default environment), method, reviewStatus none/duplicate_order_capture(defaultnone), reviewReason additional_successful_payment_for_paid_order, refundedAmountMinor(default0), refundReferences string array, gatewayCreatedAt, gatewayStatus, verifiedAt, createdAt/updatedAt.
Indexes: unique gatewayPaymentId (not unique per order); (orderId,status); (shopId,createdAt desc,_id desc). No foreign-key enforcement: deleted orders and legacy records can leave dangling references. Required schema does not prove historical population or database consistency.

### Other records
ShopSubscription: sourcePaymentOrderId immutable ObjectId and sourcePaymentId ObjectId both sparse unique; shopId, planId, planCode, immutable plan/pricing snapshots; active/paused/scheduled/expired/cancelled, startsAt/expiresAt, durationMonths, amountPaidMinor, remainingMilliseconds, pauseReason, segments, scheduledStartAt, renewalOf, activatedAt and timestamps. Legacy records may only have sourcePaymentId.
PaymentRefund: required appMode,shopId,orderId,gatewayOrderId,gatewayPaymentId,gatewayRefundId,refundId,amountMinor,currency,gatewayStatus; verifiedAt and entitlementReviewRequired(defaulttrue). Unique(appMode,gatewayRefundId), (orderId,gatewayPaymentId). No reason or dispute fields.
PaymentWebhookEvent: unique eventId, eventType, appMode, provider-string orderId/paymentId/refundId, attempts,nextAttemptAt,lastErrorCode,processedAt,status(received/processed/failed), timestamps. Index(appMode,status,nextAttemptAt). It does not retain raw payloads.
SubscriptionAuditLog: shopId, previousPlan/newPlan, eventType, referenceId, actorType(shopkeeper/system/gateway), actorId,occurredAt,metadata,timestamps. Index(shopId,occurredAt desc,_id desc), unique sparse(referenceId,eventType).
PaymentOrderRecovery: same local _id, shopId,appMode,idempotencyKey, immutable server snapshot,reconciliationNextAt/reconciliationLastCode,timestamps; unique(shopId,appMode,idempotencyKey).

## Actual writes and status mapping
subscriptionService.createSubscriptionOrder creates local order before Cashfree; prepareCashfreeOrder retains trusted recovery evidence and saves provider identifiers. Checkout itself creates no fabricated attempt.
normalizeCashfreePayment maps SUCCESS -> captured; FAILED/USER_DROPPED/CANCELLED/VOID -> failed; other supported observations -> pending; raw gatewayStatus remains distinct.
recordObservedAttempt verifies matching order/amount/currency, checks existing shop/order binding, upserts actual provider attempts, protects terminal/captured state.
reconcilePayment verifies PAID order and SUCCESS attempt with exact amount/currency/ownership; transactionally records capture, subscription schedule/activation, order state and audit. Additional successful payment for an already fulfilled order is preserved and flagged duplicate_order_capture, not fulfilled again.
processPaymentWebhook re-fetches authenticated provider data; success and failure writes share the above paths/guards. Webhook uniqueness, captured-payment uniqueness and subscription source uniqueness provide idempotency.
verifyPayment/inspectCashfreeOrder and the worker iterate provider attempts. ACTIVE order may coexist with failed/dropped latest attempt; not all local orders turn failed. Provider expiry is distinct from local order enum.
recoverMissingOrder uses trusted PaymentOrderRecovery snapshot, with wallet-review guards; without trusted terms it requires review. The new UI must never call recovery.
Full-wallet purchases transactionally create paid orders and subscriptions without a Cashfree order or transaction.
paymentRefunds verifies authenticated provider refunds (SUCCESS/PENDING/CANCELLED/ONHOLD/FAILED), stores each provider refund once, and monotonically updates refunded amounts/references without fabricating capture, issuing refunds or revoking entitlements. Refunded/partially_refunded schema values are supported historical states; current refund polling preserves capture status.
Unknown/dispute webhook types remain failed with PAYMENT_LIFECYCLE_REVIEW_REQUIRED. No structured dispute lifecycle exists.
No runtime claims are made about installed indexes, current worker health, database relationships or actual provider status.

## Existing Admin inventory and preservation checklist
Sidebar: Dashboard, Shops, Customers, Transactions (customer ledgers), Subscriptions, Refer & Earn, Payments, Administrators, Reports, Audit logs, Settings. Preserve order/labels; add Payment Orders next to Payments.
PaymentOrders component (existing payment dashboard) has order-attempt tab with pagination/reconcile actions, missing-order snapshots, verification ResourceTable slot, latest20 refunds and webhook recovery. Global and shop-specific instances reuse it. Preserve every column, tab, refresh, dialog and operational POST.
ResourceTable payments shows provider status/review, plan/duration/historical pricing, gateway payment/order IDs, shop, amounts/refunds, local status, verification, dates and subscription outcome. Add local order link; do not replace gateway IDs.
Customer ledger Transactions and Opening Balance Summary are unrelated and must not gain payment-order columns.

Existing APIs: GET /api/v1/admin/payment-orders (limited generic filter parser), /payments, /payment-refunds, /payment-recovery-events, /payment-recovery-snapshots, /payment-health, /subscriptions, /shops/:id; POST /payment-orders/:id/reconcile (reauth/reconcile permission). Mobile /payments/verify, /payments/:orderId/status, /payments/attempts/:idempotencyKey/status remain untouched. Frontend /admin/api proxy requires explicit allowlist updates for details routes.

## Authorization and privacy
Trusted server proxy key + origin, production HTTPS, versioned active admin session, permissions, CSRF on writes, rate limiter300/minute, audited operational actions. ADMIN/SUPER_ADMIN have global payments:read; SUPPORT has shops:read only. There is no shop-scoped admin role or assignment model; do not invent scope grants. New reads enforce payments:read and current APP_MODE. Related records must match shop, order and provider ID; legacy missing appMode is accepted only when a valid current-environment parent proves association.
Exclude checkout session IDs, lease tokens, request hashes, raw provider payloads, tokens and secrets. Historical snapshot serialization must whitelist fields.

## Findings (confirmed vs potential)
- Medium CONFIRMED: /payments projection omits local orderId; no order details route/sidebar. No reliable clickable association exists.
- Medium CONFIRMED: existing paymentDetailsJoin checks parent environment but does not check parent shop/gateway binding. Corrupt references could display unrelated purchase metadata. Tighten read joins; no financial backfill.
- Medium CONFIRMED: existing paymentOrders uses generic page helper but ignores search/status/plan parameters in its match pipeline and only projects limited order fields. Extend this same endpoint compatibly.
- Medium CONFIRMED gap: no structured dispute model, amount, reason, status or detail route. Display retained webhook evidence and unavailable policy data, not invented dispute records.
- Low CONFIRMED: current generic pagination caps50; new page needs100 while existing consumers remain valid.
- High POTENTIAL financial risk, not observed data corruption: orphan references, cross-shop bindings, missing installed uniqueness indexes, legacy environment fields and duplicate captures require operational review. Database was not inspected. Schema alone cannot certify exactly-once behavior.
- Medium POTENTIAL performance risk: cross-shop historical summary/search and operational joins may be expensive at scale. Use selective matches, projected joins, deadlines, bounded pagination; recommend explain/index review before large deployment.
- Informational: wallet-only paid orders legitimately lack Cashfree IDs/attempts; orders with no provider attempt are not proof of error.
- Informational: subscription stored status is cached lifecycle state; viewing must not run transition services. Success alone does not prove activation.
No critical processing defect was established in this source-only audit. Earlier production audit findings are historical; current durable inbox/refund/index-verification code supersedes portions of that report.

## Implementation plan
1. Extend GET payment-orders with backward-compatible data/pagination plus filtered summary; allowlisted filters/sorts, 20/50/100.
2. Add GET order detail, paginated related records, and sanitized payment detail. Preserve existing reconcile POST unchanged.
3. Add read-only sidebar/list/details and reusable local-order link; update existing payment/refund/webhook tables through safe batched relationship resolution.
4. Whitelist historical pricing; combine stored subscription, webhook, refund and audit evidence without provider requests. Timeline labels timestamps accurately, never infer failure/activation times.
5. Static validation only; no backend startup or runtime database acceptance.
6. Document remaining unsupported fields and runtime acceptance.

## Approval boundaries
No approval needed for these additive reads/UI. Database backfills, index migrations, production queries, refund/dispute policy and unrelated payment-processing changes require separate approval and are excluded.


## Implementation review addendum
The audit above preceded code changes. Implementation addresses missing local-order links/routes, ineffective order filters, explicit read-join ownership checks and independent statuses. No payment writes were changed.
- Existing Shop subscription listing did not consume a shopId URL query on /admin/subscriptions. New navigation instead uses the actual existing shop section, with an additive anchor.
- AdminAudit payment_order target records are also available through a separately permission-gated related-record category; only action/result/reference/timestamps are exposed.
- New capture totals group by genuine provider payment ID. Duplicate database documents for one ID are flagged and excluded from the amount rather than counted twice. Independently captured provider IDs remain distinct financial observations, including additional captures flagged by the processing service.
- Existing generic payment table label "Final paid" is retained with its existing amounts/status columns; it can contain non-success attempts. The new module labels cash payable and verified captures separately. This pre-existing wording remains a low-severity presentation limitation outside order-link insertion.
- No installed indexes or historical rows were inspected. Potential orphan/reference/index risks remain unverified, not repaired.
