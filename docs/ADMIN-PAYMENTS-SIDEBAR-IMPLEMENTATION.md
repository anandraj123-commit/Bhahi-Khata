# Payments sidebar implementation

9 November 2026. Audit: [ADMIN-PAYMENTS-SIDEBAR-AUDIT.md](ADMIN-PAYMENTS-SIDEBAR-AUDIT.md). Audit was written before implementation. This is an additive read-only monitoring feature, not payment-processing work.

## Navigation
Original destinations: Dashboard, Shops, Customers, Transactions, Subscriptions, Refer & Earn, Payments, Payment Orders, Administrators, Reports & analytics, Audit logs, Settings.

Final organization preserves that order, grouping the two payment destinations in their original area:
- Payments (expandable native button, keyboard accessible)
  1. Payment Dashboard — /admin/payments (original URL)
  2. Payment Orders — /admin/payment-orders (original URL and detail URLs)
  3. Payment Transactions — /admin/payment-transactions
  4. Webhook Events — /admin/webhook-events
  5. Payment Recoveries — /admin/payment-recoveries
  6. Refunds & Disputes — /admin/refunds-disputes

All unrelated destinations remain unchanged. Group and child active states recognize nested routes; collapsed desktop navigation retains titled icon links. The existing mobile drawer reuses this navigation. Payments children require payments:read. Original Payments sidebar label is now Payment Dashboard under the Payments group; no duplicate destination or redirect was introduced.

## Reused functionality and preservation review
Source diff confirms:
- Payment Dashboard retains every existing summary, health section, tab, table, pagination, refresh, reconciliation action, permission gate and verification slot. Only monitoring shortcut links were added.
- Shop-scoped PaymentOrders behavior is unchanged; shortcuts only appear globally.
- Payment Orders listing/detail/API remain intact. The existing payment-detail dialog is exported for reuse; order-context callers still enforce matching parentId. Global callers use the existing environment-authorized payments/:id API, including orphan handling.
- Existing customer-ledger Transactions, Opening Balance Summary, shop financial overview, subscription management, customer screens and unrelated routes are untouched.
- Existing reconciliation POST, webhook processing, provider verification, subscription fulfillment and workers are untouched.
- Old read endpoints remain available with identical behavior. No schema/index/data change was made.
This is source-level preservation, not authenticated browser acceptance.

## New pages and API
Four server-rendered route wrappers requireAdmin(payments:read), then render the shared PaymentMonitoring client component. It reuses the searchable ShopSelect, query hook/AbortSignal, PaymentNotice, PaymentOrderLink, modal, badges, buttons, table typography and existing PaymentAttemptModal.

New GET /api/v1/admin/payment-monitoring/:kind, where kind is attempts, webhooks, recoveries or refunds. Frontend allowlisted proxy /admin/api/payment-monitoring/:kind enforces GET. Existing trusted proxy/origin/session/role/rate-limit middleware applies. Response retains familiar data[]/pagination and adds environment. No write or provider service is imported.

Filters: exact local record/order IDs and appropriate provider identifiers; exact diagnostic code for recoveries; searchable authorized shop selector; actual kind-specific status; exact event type for webhooks; created/updated UTC date range; created/updated sort ascending/descending. Dates are validated and inclusive end dates implemented with next-day exclusive boundaries. Exact identifiers avoid unrestricted regex financial-record searches. Shop selection reuses existing bounded server search by name/mobile/ID. Search is intentionally not a free-text payload search.

Server pagination defaults20, accepts20/50/100, page bounded1–1000, stable _id tie-break. UI includes total, range, page numbers, previous/next, refresh and reset. URL carries filters/sort/page for browser navigation. All parameters are debounced before fetching; old query responses cannot overwrite a different query key. Invalid date order blocks requests. Error feedback distinguishes unavailable endpoints, connection failures, access/session problems and other failures; failed requests are never represented as successful empty records.

## Fields and relationships
- Attempts: local transaction/order references, resolved local order link, gateway order/payment IDs, shop, provider, amount/currency/method, local/provider/verification statuses, verified time, review status/reason, recorded refunded amount, provider timestamp, created/updated. View reuses full existing payment detail (including refund references). Existing dashboard pricing/subscription columns and filters remain accessible there; parent order supplies full historical purchase and subscription evidence.
- Webhooks: record ID, deduplication hash, event type, provider order/payment/refund references, safe local order/payment links, shop when resolvable, processing status, retry failures, next retry, diagnostic code, processed/created/updated. Hash is not labeled a provider event ID. Created At is inbox receipt time; provider event time and duplicate-delivery counters are not stored.
- Recoveries: original local order/recovery ID, validated parent link, shop, derived parent-present/missing relationship, stored review code, scheduled check and timestamps. All actual evidence records can be browsed, unlike the unchanged old latest20 flagged-review endpoint. No job status, attempts or completion timestamp is invented. Parent present does not mean payment succeeded. Raw snapshots and idempotency keys are excluded.
- Refunds: merchant/provider refund IDs, safe parent/payment links, provider references, shop, amount/currency, actual provider status, verifiedAt, entitlement review flag, created/updated. No refund initiation, invented reason or failure text. The dispute section explicitly states structured monitoring is unavailable and links retained failed webhook evidence.

PaymentTransaction.orderId and PaymentRefund.orderId are local ObjectIds; PaymentWebhookEvent.orderId is a provider string; recovery._id is the original local order ID. Parent joins require current APP_MODE and shop/provider consistency. Webhook references must be nonempty strings; missing references cannot resolve to wallet orders. Associated transaction links require exactly one matching provider payment, order, shop and environment; ambiguous associations show unavailable. Legacy attempts lacking appMode require valid parent evidence; unresolved cross-environment provenance is excluded rather than guessed.

## Financial definitions
No new combined monetary aggregate or financial formula was introduced. Existing dashboard and Payment Orders financial definitions remain unchanged. Attempt amount is an observation, not necessarily captured funds; refunded amount is stored cumulative evidence. Verified refund means provider checked, not necessarily completed. Only provider SUCCESS indicates completed refund. Currency formatting uses each row's stored currency, with unavailable on missing/invalid values. Wallet contributions are not relabeled as gateway collections. Existing order summaries keep currency-separated verified gross capture amounts and their documented uniqueness safeguards.

New dashboard shortcuts expose attention orders, all attempts, failed webhooks, missing-parent evidence and refunds. No new net-collections or trend chart is claimed: existing dashboard/report metrics remain, but this change does not add a separately audited cross-currency net settlement calculation.

## Security and database impact
New reads require payments:read (existing ADMIN/SUPER_ADMIN global scope). SUPPORT cannot see or request these pages. No shop-assignment model currently exists; no new permission grants were introduced. Queries use actual Mongoose collection.name mappings, whitelist projections, validated fields/statuses/dates/IDs, maximum100 rows and 10-second aggregation deadlines. Related shops/attempts join only after page limiting where possible; no per-row application queries. Parent joins before counting are necessary for environment provenance and relationship filters. Exact counts and relationship filters can still be expensive on large datasets: controlled explain/index review remains required before scale deployment; no indexes were created or altered.

No secrets, raw provider payloads, purchase snapshots, session credentials or lease tokens are returned. Refresh/view performs GET only. No backend process or worker was started/restarted. No Cashfree calls, database connections or production records were accessed during development.

## Static validation and limitations
Final command outcomes are recorded below after execution. No automated tests were created, modified or run.

Remaining unverified: authenticated browser/mobile layout, real API/database responses, installed indexes, legacy data coverage, query performance, actual worker operation and provider outcomes. Backend must load the new route/service through the project's controlled deployment process; the old running backend can return404 until updated. Frontend and backend must be released together. No runtime API or production-readiness claim is made.

Structured disputes, recovery job/completion history, webhook duplicate counts/provider timestamps and refund reasons cannot be displayed because the existing models do not store them. Implementing those lifecycles requires separate policy and processing work. No such workflow was added.

### Executed validation
- `npm --prefix website run typecheck` with Node22.23.4: PASS (Next route type generation and TypeScript). An initial ShopSelect callback type mismatch was corrected; final run passed.
- `npm --prefix website run build -- --webpack`: PASS; build output includes all six payment destinations and existing routes.
- `node --check server/src/admin/services/paymentMonitoring.js`: PASS.
- `node --check server/src/admin/validators/paymentMonitoring.js`: PASS.
- `node --check server/src/admin/routes/readRoutes.js`: PASS.
- `git diff --check`: PASS.
- Static route/proxy/permission and preservation diff review completed. No automated suites ran.

The identified Digital-Khata Next.js process was stopped before rebuilding to avoid mixed manifests. Only that frontend was restarted after validation; the unrelated port3000 process and backend were left untouched. Frontend startup is not authenticated browser/API acceptance.

### Files
Frontend: components/admin/layout/shell.tsx; components/admin/tables/payment-monitoring.tsx (new); components/admin/tables/payment-orders.tsx (shortcuts only); components/admin/tables/payment-order-management.tsx (reuse existing dialog); app/admin/admin.css; app/admin/api/[...path]/route.ts; four new app/admin/(console)/{payment-transactions,webhook-events,payment-recoveries,refunds-disputes}/page.tsx files.
Backend: server/src/admin/routes/readRoutes.js; new server/src/admin/validators/paymentMonitoring.js and services/paymentMonitoring.js.
Documentation: this implementation record and ADMIN-PAYMENTS-SIDEBAR-AUDIT.md.
