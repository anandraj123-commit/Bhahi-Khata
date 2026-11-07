# Cashfree Sandbox reconciliation audit

> Historical engineering record: automated testing infrastructure was removed on 8 November 2026 at the owner’s request. Prior results are historical; do not create or run tests until explicitly requested.

Audit date: 31 October 2026. Scope: existing backend, mobile payment flow, MongoDB payment/subscription models, Admin Panel, and current development/testing Sandbox configuration.

This was an audit, not an implementation change. Only this report was added. Existing uncommitted implementation changes were preserved. No application code, environment configuration, MongoDB records, or provider orders were changed by the auditor. No payment was initiated, webhook replayed, production database accessed, or commit/push performed. The already-running backend remained running and could perform its normal writes independently.

Evidence is distinguished below as **inspection**, **automated tests**, or **read-only runtime observation**. Historical test results in `SUBSCRIPTION-SYSTEM.md` are not counted as tests executed in this audit. Native-device acceptance was not performed.

## A. Executive summary

**Overall: PARTIAL; not ready for unconditional production acceptance.** Sandbox authentication and direct order/payment retrieval work. The development backend shows background reconciliation activity. Genuine pending attempts are persisted, and fulfilment requires independently verified provider success. However, reconciliation deliberately stops after an attempt/age cutoff, does not recover missing orders autonomously, and is disabled when checkout is disabled. Historical payment completeness and recovery indexing also have defects.

The reported empty `paymenttransaction` collection has a concrete explanation in the currently observed testing database: Cashfree returns an **empty payments list** for its pending order. There is no provider payment attempt to insert. In development, the pending order has a genuine Cashfree PENDING attempt and a corresponding local pending transaction. These are different orders in different databases.

Public webhook reachability is established through the current ngrok tunnel. Delivery/processing is mixed: captured traffic includes five HTTP 200 responses, eleven provider-error HTTP 502 responses, one tunnel-error HTTP 502 response, and one unsigned HTTP 400 response. The payment IDs from the twelve HTTP 502 captures currently return `404 payment_not_found` from Cashfree. Their cause is not established; a signed sample payload must not be treated as proof that Cashfree can retrieve a successful payment.

## B. Worker verification

**Inspection:** `server/src/index.js` starts `startPaymentReconciliationWorker` after successful database/application startup. `server/src/paymentReconciliation.js` schedules `*/5 * * * *`: every five minutes, with process-local `noOverlap: true`. It does not run immediately at startup. It operates without the mobile application, but returns without scheduling when `checkoutEnabled` is false.

`reconcilePendingCashfreePayments` in `server/src/services/subscriptionService.js:1298` selects `PaymentOrder` documents with:

- Current `appMode` and status `created` or `pending`.
- A string `gatewayOrderId`.
- Creation within the preceding seven days.
- Fewer than the configured maximum verification attempts, or an absent counter.
- A missing/null/due `paymentReconciliationNextAt`.

Candidates sort by next verification time, creation time, and ID. The worker requests at most **20 orders per run**; the service accepts a bounded maximum of 50. There is no one-order-per-shop restriction and no `checkoutActive` filter. Therefore an older eligible pending order remains selectable after a newer purchase succeeds. It does **not** process every unresolved payment: exhausted, old, missing-reference, deleted, and terminal-status orders are excluded. It does not scan recovery snapshots or orphan transactions.

Each candidate is atomically claimed by comparing its counter/due state, incrementing the counter and advancing its next-check time before provider access. The persisted state survives restarts; a crash after claiming still consumes an attempt. There is no immediate restart catch-up beyond the next scheduled tick.

**Runtime observation:** at 17:36:35 UTC the development pending order had two attempts, with its last document update at 17:30 UTC. At the second observation beginning 17:45:52 UTC it had three attempts, an update at 17:40 UTC, and next check at 17:55 UTC. No verification endpoint or worker was invoked by the auditor. This is evidence of background activity beyond a startup log; it does not prove every cron tick executed. The testing order remained at zero attempts, last updated on 28 October. Automatic reconciliation in that environment is not established.

Performance/retry policy:

| Property | Actual implementation |
| --- | --- |
| Interval | Five-minute cron, no immediate first pass |
| Batch | 20, processed sequentially |
| Provider timeout | 15 seconds per request; order/payment-list requests parallel within an inspection |
| Backoff | 1, 5, 15, 60, 240, 720, 1,440, 2,880 minutes |
| Attempt ceiling | Default 8; configurable within validation bounds |
| Age ceiling | Seven days from order creation |
| Retryable outcomes | Provider errors and still-pending results both consume the same budget |
| Last-check evidence | Counter, next-check time, last error code; no dedicated last attempted/successfully checked timestamp on pending orders |
| Concurrency | Conditional Mongo claim plus transactional fulfilment and unique indexes; cron overlap prevention is process-local |

At attempt eight the order can retain a future next-check timestamp even though it is no longer eligible. With sustained timeouts a batch can approach/exceed five minutes. The due timestamp doubles as a claim lease; a sufficiently slow operation can be claimed again by another process after that time. Fulfilment idempotency remains necessary. Cutoffs can miss late success when webhooks are absent; there is no durable exhausted-work review queue.

## C. Cashfree API and environment verification

`server/src/providers/cashfree.js` selects `https://sandbox.cashfree.com/pg` for Sandbox and `https://api.cashfree.com/pg` for production. Development and testing explicitly configure Sandbox and API version **2026-01-01**. Credentials/webhook secrets are present; authenticated read-only Sandbox requests returned HTTP 200. Production credential fields in the inspected local production file are empty and checkout is disabled. No production API request was made.

Startup uses `.env.development`, `.env.testing`, or `.env.production` with `startupGuard.js`; environment/database checks remain in place. No mandatory main `.env` was introduced. The configured API version and Sandbox URL match Cashfree's [current API overview](https://www.cashfree.com/docs/api-reference/payments/latest/overview).

| Operation | Endpoint | Authentication |
| --- | --- | --- |
| Create order | `POST /orders` | Server client ID/secret, version, stable idempotency key |
| Inspect order | `GET /orders/{order_id}` | Server client ID/secret and version |
| Inspect all attempts | `GET /orders/{order_id}/payments` | Same server credentials |
| Verify webhook payment | `GET /orders/{order_id}/payments/{cf_payment_id}` | Same server credentials |

Mobile `src/cashfreeCheckout.ts` receives the checkout session/order/environment and invokes backend verification. No provider-secret delivery to mobile was found in the inspected payment flow. A mobile callback is not sufficient to activate a subscription.

The provider adapter redacts errors aggressively: non-2xx errors generally become `CASHFREE_REQUEST_FAILED`/HTTP 502, with 429 mapped to 503. It does not retain a sanitized provider code/status for diagnosis. Transport failures become `PAYMENT_PROVIDER_UNAVAILABLE`/503.

Cashfree documents attempt statuses `SUCCESS`, `NOT_ATTEMPTED`, `FAILED`, `USER_DROPPED`, `VOID`, `CANCELLED`, and `PENDING` in [Get Payments for an Order](https://www.cashfree.com/docs/api-reference/payments/latest/payments/get-payments-for-an-order). Order statuses and payment-attempt statuses are separate domains.

| Provider result | Existing behavior |
| --- | --- |
| Attempt SUCCESS + order PAID | Verified transactional fulfilment, transaction `captured`, order `paid` |
| FAILED / USER_DROPPED / CANCELLED attempt | Transaction `failed`; latest failed attempt can be returned as failed while the order stays ACTIVE/pending |
| PENDING attempt | Genuine transaction stored as `pending`; no entitlement activation |
| NOT_ATTEMPTED / VOID | Both fall through to `pending`; VOID has no explicit terminal treatment |
| ACTIVE order with no attempts | Pending order, no fabricated transaction |
| PAID without retrievable SUCCESS | Unresolved; no activation |
| EXPIRED / TERMINATED | Reservation/order finalization only when no SUCCESS and no normalized pending attempt exists |

`normalizeCashfreePayment` returns the raw gateway status, but observed-attempt persistence stores only its normalized status. This loses the distinction between failed, dropped, and cancelled attempts in transaction history. The provider expiry returned by creation is not used as the authoritative persisted checkout expiry; the service maintains its own local expiry. Provider inspection prevents local expiry alone from proving non-payment.

## D. Webhook verification

Endpoint: `POST /api/v1/payments/webhook`. `server/src/app.js:54` installs a raw JSON body parser before normal JSON parsing. `handle_post_payment_webhook` in `server/src/controllers/subscriptionController.js:122` verifies HMAC-SHA256 over timestamp plus raw body using constant-time comparison. Supported events are SUCCESS, FAILED and USER_DROPPED. The backend re-fetches the order and the specific payment using server credentials, and validates identity, amount and currency before processing.

`processPaymentWebhook` uses a unique event identifier and a MongoDB transaction. Payment/order/subscription uniqueness provides additional protection when different events refer to the same purchase. Delayed success is safe only when the provider currently verifies it. Failures do not activate subscriptions. Timestamp syntax is checked, but timestamp freshness is not; financial idempotency protects against duplicate activation, while stale signed replays can still consume verification work.

**Runtime evidence:** the configured public ngrok origin's health endpoint and localhost health endpoint both returned 200. The tunnel reported an upstream of `http://localhost:4000`. Thus Sandbox can reach this running backend through the tunnel. Orders include the configured `notify_url`; dashboard event subscriptions/account settings were not inspected. A tunnel being reachable now does not guarantee availability after restart or expiry.

Captured requests: 18 webhook POSTs; 17 signed SUCCESS payloads validated against the configured secret, and one unsigned request was rejected. Five signed requests received 200; eleven received the backend's provider-request-failed response; one received a tunnel error. Read-only provider checks for the twelve failed deliveries returned `404 payment_not_found` for those payment IDs. Whether these came from a provider test-event generator, unavailable records, or another mismatch is **NOT VERIFIED**. No replay was attempted. HTTP 200 alone is not proof of subscription activation, since ignored events also return success.

Development and testing currently configure the same public webhook URL, and captured signatures validate against both configured secrets. A single process uses one `appMode`/database; it does not route incoming events across both databases. This is an environment-delivery risk, not evidence of production credential use. Separate environment callbacks/processes are needed for simultaneous testing.

## E. MongoDB and transaction observation

Read-only native MongoDB queries inspected development and testing, without importing startup code that creates indexes/migrates records. Initial observation: 17:36:35 UTC.

| Collection/status | Development | Testing |
| --- | --- | --- |
| `paymentorders` | 7: five paid, one failed, one pending | 1 pending |
| `paymenttransactions` | 7: five captured, one failed, one pending | 0 |
| `paymentorderrecoveries` | 3 | 0 |
| `shopsubscriptions` | 5 | 0 |
| `paymentwebhookevents` | 5 | 0 |
| Orphan transactions in observed data | 0 | 0 |

Both pending orders were ACTIVE at Cashfree; fetched order references, amount and currency matched locally stored values. Development returned one PENDING attempt with a genuine `cf_payment_id`, matching the presence of a local pending transaction. Testing returned `[]`. **An order is not a transaction: creating a checkout session does not establish an actual payment attempt.** The current testing observation therefore does not justify creating a transaction.

`recordObservedAttempt` (`subscriptionService.js:1165`) validates provider identity/amount/currency and upserts real pending/failed attempts by unique `gatewayPaymentId`. Repeated reads do not intentionally create duplicates. Captured transactions cannot be downgraded. Success is persisted only by transactional fulfilment. Concurrent non-success writes have a narrower race: the update predicate excludes captured status but does not recheck failed status, so a stale pending observation can overwrite a concurrently written failure.

Orders are created before checkout, retain a stable `dk_<local-order-id>` provider reference, and are not deleted by retry. Independent orders per shop are supported. The active checkout uniqueness restriction is retired for older unresolved orders only after the applicable retry/risk-acknowledgement logic; history is retained.

Unique payment/order/subscription indexes were present in the observed databases. **Recovery index defect:** `PaymentOrderRecovery.schema` declares a unique shop/environment/idempotency-key index, but `ensureIndexes` (`server/src/models.js:576`) omits that model. Database `autoIndex` is false. Development's recovery collection had only its intrinsic `_id` index; testing had no recovery collection. Schema declaration alone does not deploy the additional index.

Counts do not constitute a full forensic certification of every historical amount or balance. No production consistency audit was performed.

## F. Subscription and mobile verification

The inspected flow is: authenticate shop → validate server-priced, confirmed preview → persist order/recovery terms → create Cashfree order → retain mobile reference → native checkout → backend fetches order and attempts → verify PAID plus matching SUCCESS → transactional payment/order/entitlement scheduling → return server snapshot → mobile cache refresh.

`reconcilePayment`/`activateVerifiedPayment` use MongoDB transactions and unique source-payment/source-order identifiers. A single order is fulfilled once. Separate verified orders are valid separate purchases. A second successful capture against the same order is retained for review rather than creating another entitlement when that capture is actually observed. No activation based solely on client callbacks or signed webhook contents was found.

The existing timeline implements immediate higher-tier activation, preservation/resumption of lower-tier time, same-tier queues and lower-tier scheduling. Existing pure scheduling tests ran successfully in the backend test bundle. Full database/concurrent lifecycle acceptance was not rerun under this audit's no-record-write restriction.

`App.tsx` retains payment references in SecureStore, refreshes them on subscription refresh/reopening, and provides **Check Payment Status** and **Retry Payment**. The latest failed attempt can display **Payment Failed** even while its order remains active. A new independent purchase requires duplicate-charge acknowledgement when an earlier payment is unresolved. Both references remain available; successful independent purchases should each fulfil their own order.

Payment success and local storage failure are separately represented by the payment-attempt helpers; the executed security suite covers local read/write/cache failures. A cache failure does not revoke a backend entitlement. Native SecureStore/SQLite fault injection was not performed.

Limitations found in inspection:

- SecureStore reference keys use a phone-derived account key, without environment namespace. A retained attempt from another shop/environment can hit the `different-shop` early return and block checkout. Preserve it under its original scope while allowing an independently acknowledged purchase in the current scope.
- Retained references form an unbounded JSON array; refresh verifies them sequentially, including historical paid references. This can become slow and encounter secure-storage size limits.
- Refresh swallows some verification failures; the single latest-message field can reflect the last visited reference rather than clearly showing every unresolved purchase.
- Backend `requiresReview` for a missing legacy order is not surfaced as a dedicated recovery workflow.

Admin payment reads join orders, transactions and subscriptions. Refetch can expose updated history; real browser/native acceptance was not performed. `paymentDetailsJoin` in `server/src/admin/services/readModels.js:112` filters on the joined order's environment, so a transaction whose order is missing is excluded from this view. There is no complete orphan-payment review surface.

## G. Confirmed issues

1. **Incomplete autonomous reconciliation:** age/attempt cutoffs permanently exclude unresolved orders; checkout disablement also disables verification.
2. **Recovery blind spots:** the worker ignores deleted orders/recovery snapshots and created orders without saved provider IDs. A crash between provider creation and local update can leave a recoverable order outside the worker query.
3. **Undeployed recovery uniqueness index:** confirmed in code and observed development indexes.
4. **Incomplete status representation:** VOID becomes pending; raw failed/dropped/cancelled distinctions are not persisted. Concurrent pending/failed updates can regress failure status.
5. **Incomplete historical capture:** polling fulfils only the first SUCCESS in the list; subsequent paid-order status calls bypass provider inspection. A second capture with a missed webhook can remain undiscovered. A failed webhook arriving after the order is paid is marked processed without inserting that failed attempt.
6. **Missing legacy-order observability:** a webhook with no order/recovery snapshot is acknowledged as ignored, without a durable orphan-review item. Legacy recovery cannot infer missing purchase terms and correctly refuses automatic fulfilment, but its review path is incomplete.
7. **Weak operational diagnostics:** no explicit last-check timestamps on pending orders; provider error details collapse to one generic code; exhausted orders can still show a future next-check time.
8. **Environment/mobile scope defects:** shared development/testing callback URL and phone-only local reference keys can send checks/events to the wrong environment or block checkout after a context switch.
9. **Recovery snapshot includes mutable wallet state:** restoring a deleted order copies its original reservation state rather than reconstructing current reservation/capture/release state from financial records. This is a confirmed unsafe recovery design; monetary impact was not exercised.

## H. Missing functionality and scenario coverage

The following are not established by executed tests or current observations:

- Exact same-`cf_payment_id` PENDING → SUCCESS transition after application closure, detected by the worker, persisted and visible in Admin.
- Exact sequence A PENDING → B SUCCESS → A SUCCESS, including concurrent duplicate webhooks and one entitlement per independent purchase.
- Autonomous recovery of deleted/no-provider-reference orders, exhausted work escalation, and orphan-payment administrative review.
- Reliable verification with checkout disabled; explicit VOID handling; complete additional-capture reconciliation after an order is paid.
- Restart/lease-expiry fault injection, actual multi-process worker acceptance, and native offline/storage/radio acceptance.

Existing lifecycle tests cover adjacent scenarios: transient verification recovery, duplicate webhook processing, fulfilment races, independent successful purchases, failed-active-order retry, pending acknowledgement, and deleted-order recovery. These tests were inspected, not rerun. Their presence does not prove the two exact sequences above.

Cashfree's [Sandbox documentation](https://www.cashfree.com/docs/payments/online/resources/sandbox-environment) documents success/failure simulation, but does not establish an automatic time-based transition from a simulated PENDING attempt to SUCCESS. The observed development attempt remained PENDING across both reads. Such an automatic transition must not be assumed. A mocked sequence is required for deterministic acceptance; none was added because code/test additions were prohibited.

## I. Security and financial risks

No inspected path permits subscription activation from an unverified mobile callback. Server-side amount/currency/order checks, authenticated ownership, signed preview, environment checks, stable order idempotency, transactional entitlement creation and unique source identifiers provide substantial protection.

The main risk is **missed paid fulfilment**, not evidence that Cashfree failed: polling cutoffs, absent recovery work and missed webhooks can strand a legitimate purchase. Independent retries can genuinely result in two charges; acknowledgement and fulfilment of both separate purchases are essential. Additional captures on one order require review and must remain discoverable even without webhook delivery.

Wallet-assisted recovery needs particular review. The immutable recovery snapshot may still say `reserved` after the original order released its wallet reservation. Restoring that state can cause a second reservation action to fail or affect other aggregate reserved funds. Conversely, ordinary late-success processing captures wallet funds only when the order says `reserved`; a previously released reservation requires explicit settlement policy. These are code-path risks, not demonstrated losses, and require isolated regression tests before enabling such recovery broadly.

Replay freshness is absent, but repeated provider verification and transaction/idempotency controls limit financial replay impact. Preserve legitimate delayed-event handling while adding bounded replay/operational controls; do not reject delayed verified payments merely because delivery is late.

## J. Recommended fixes — not implemented

| Priority | File/function | Proposed change |
| --- | --- | --- |
| High | `server/src/paymentReconciliation.js:startPaymentReconciliationWorker` | Separate verification enablement from new-checkout enablement; add explicit startup catch-up and worker health metrics. |
| High | `server/src/services/subscriptionService.js:reconcilePendingCashfreePayments` | Retain long-lived unresolved work with slower backoff, exhausted/manual-review state and alerts; do not silently abandon it after eight polls/seven days. |
| High | Same service, `recoverMissingOrder` and order creation | Reconcile trusted recovery snapshots and deterministic provider references after partial creation/deletion; never guess purchase terms. Reconstruct financial state from authoritative ledger evidence. |
| High | `server/src/models.js:ensureIndexes` | Include `PaymentOrderRecovery`; preflight duplicate keys before non-destructive index deployment. |
| High | `inspectCashfreeOrder`, `recordObservedAttempt`, `processPaymentWebhook` | Persist every genuine attempt, including failures after paid and extra captures; retain raw provider status and use concurrency-safe monotonic updates. Explicitly handle VOID/NOT_ATTEMPTED. |
| High | `server/src/admin/services/readModels.js:paymentDetailsJoin` and admin payment view | Surface trusted orphan/review records without losing environment/ownership isolation. |
| Medium | `server/src/providers/cashfree.js:cashfreeRequest` | Retain sanitized provider HTTP/error code and request correlation; keep secrets/provider payloads out of logs. |
| Medium | PaymentOrder schema and reconciliation service | Add last attempted/last successful check timestamps, next action and exhaustion reason; use a dedicated claim lease. |
| Medium | `App.tsx:refreshSubscriptionInfo`, `purchaseSubscription`, `retainSubscriptionReference` | Scope storage by environment and shop; migrate without deleting unresolved references; expose review/network/local-sync states per purchase and bound/paginate historical refresh. |
| Medium | Development/testing webhook deployment | Use distinct callbacks/processes; verify dashboard registration and retrievable provider IDs end to end. Do not introduce admin database switching. |
| Medium | retired automated validation | Add the exact pending-to-success and A/B delayed-success sequences plus cutoff, missing-order, extra-capture, stale-wallet-snapshot and concurrent-status regressions in a disposable database. |

## K. Executed tests and constraints

| Executed command | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| From `server`: retired automated validation | 42 | 0 | 0 |
| From root: retired automated validation | 28 | 0 | 0 |
| **Final executed-suite total** | **70** | **0** | **0** |

Initial restricted-sandbox attempts had environmental socket-permission failures: the backend bundle had 40 passes/2 failures and the security suite 27 passes/1 failure. Authorized reruns of the same suites outside that restriction produced the results above. These were not application assertion failures hidden or disabled.

**Not executed:** the full retired automated validation command and MongoDB-backed lifecycle/admin/backend integration suites. Their setup inserts/deletes synthetic MongoDB fixtures. The audit expressly prohibits MongoDB record changes; approval to use a disposable local test database was requested but had not been received at report preparation. No tests were edited, disabled or reported as passing without execution. The provider/pricing portion of payment tests and the pure scheduling suite did run in the 42-test bundle.

No new mocked transition test was added under the no-code-change restriction. No new Sandbox payment, webhook replay, Android-device test, or real-money transaction was performed. **Native-device tests performed: 0.** Read-only Sandbox GETs are runtime API evidence, not checkout acceptance.

`git diff --check` passed. SHA-256 comparisons against the audit-start baseline found **0 changed files among 681 application/source/configuration files checked**. This report is the only repository file written by the audit.

## L. Final assessment

| Component | Assessment | Basis |
| --- | --- | --- |
| Sandbox URL/authentication/version | PASS | Inspection and authenticated Sandbox reads |
| Production/Sandbox separation | PARTIAL | Server guards intact; shared dev/testing callback and local-key scoping remain concerns |
| Automatic development reconciliation | PARTIAL | Background counter advancement observed; incomplete coverage/cutoffs |
| Automatic testing-environment reconciliation | NOT VERIFIED | Existing pending order remains at zero worker attempts |
| Order versus attempt distinction | PARTIAL | Correct ACTIVE/failed behavior; VOID/raw-status/history defects |
| Pending transaction persistence | PASS for observed cases | Genuine development attempt persisted; testing has no provider attempt |
| Webhook authentication | PASS | Raw-body HMAC inspection, security tests and captured signature verification |
| Webhook delivery/processing acceptance | PARTIAL | Public reachability and mixed captured outcomes; failing IDs not retrievable |
| Verified-success-only activation/idempotency | PARTIAL | Sound inspected controls and pure tests; full Mongo lifecycle rerun outstanding |
| Recovery/index deployment | FAIL | Worker recovery gaps and missing declared recovery index |
| Complete payment history | FAIL | Late failures/extra captures/orphan visibility can be omitted |
| Admin updated-history acceptance | NOT VERIFIED | Read path inspected; no end-to-end UI transition test |
| App-closed pending-to-success acceptance | NOT VERIFIED | No new payment or exact mocked lifecycle execution |
| Multiple pending late-success acceptance | NOT VERIFIED | Exact A/B sequence not executed |
| Production readiness | PARTIAL — acceptance incomplete | Resolve high-priority findings and run isolated/native acceptance before release |

This report records findings before fixes. Application changes, database repairs/index deployment, payment reconciliation triggers and production rollout require a subsequent implementation task.
