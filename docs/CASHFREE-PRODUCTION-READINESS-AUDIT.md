# Cashfree production-readiness audit

> Historical engineering record: automated testing infrastructure was removed on 8 November 2026 at the owner’s request. Prior results are historical; do not create or run tests until explicitly requested.

Date: 1 November 2026 (Asia/Kolkata).

## Executive summary

**Assessment: PARTIAL — not approved for production release.** The previous USER_DROPPED and retry fixes remain implemented. The normal purchase path has substantial security protections: backend-priced purchases, authenticated shop ownership, signed purchase previews, raw-body webhook authentication, independent provider verification, transactional scheduling and unique payment/source identifiers.

This audit confirmed a new **HIGH** reliability defect with a mock-only diagnostic: `processPaymentWebhook` can acknowledge a success event as a duplicate after an unrelated duplicate-key exception merely because a **pending** transaction exists. It does not require a captured transaction or a committed webhook event in that branch.

Other release blockers are incomplete payment-integrity recovery, missing refund/dispute lifecycle handling and policy, incomplete administrative visibility, conditional index initialization in verification-only mode, and missing database-failure/native acceptance evidence. No CRITICAL exploitable payment-authentication bypass was demonstrated. This is not a guarantee that none exists.

**Current execution results: 308 automated tests passed, zero failed on final runs; mobile and Admin TypeScript checks passed.** One separate mock-only diagnostic reproduced the duplicate-key defect. MongoDB integration and Admin browser suites were not executed: explicit approval for a fresh disposable localhost database was requested and had not been received at report preparation. The earlier 115 passing tests are historical evidence, not newly executed results.

## Scope and restrictions

Reviewed all five requested reports:

- `docs/CASHFREE-SANDBOX-RECONCILIATION-AUDIT.md`
- `docs/CASHFREE-USER-DROPPED-FIX.md`
- `docs/SUBSCRIPTION-PAYMENT-RETRY.md`
- `docs/SUBSCRIPTION-SYSTEM.md`
- `docs/SUBSCRIPTION-SYSTEM.md`

Inspected the current payment provider, routes/controllers, reconciliation worker, models, scheduling/customer entitlement services, mobile checkout/reference/cache flow, Admin permissions/read models/UI and existing tests.

Only this report was added to the repository. Application code, tests, environment files and business rules were not modified. No MongoDB connection or write was made by this audit, no payment or webhook replay was initiated, and no production service was contacted. A temporary `/tmp` diagnostic imported application code with mocked provider/model/session methods and verified that Mongoose remained disconnected. Existing running services were not restarted or invoked for reconciliation.

Evidence labels used below:

- **Inspection:** behavior established from current code.
- **Executed tests:** tests actually run in this audit.
- **Diagnostic:** the explicitly described mocked fault reproduction.
- **Historical:** earlier reports/results, not repeated acceptance.
- **NOT VERIFIED:** insufficient runtime evidence or approval-dependent tests not run.

## 1. Previous fixes remain implemented

| Previous fix | Current verification |
| --- | --- |
| Genuine pending/failed attempt persistence | `recordObservedAttempt` still validates reference/amount/currency and persists real provider IDs. |
| USER_DROPPED distinction | `gatewayStatus`, `latestPaymentStatus` and mobile `paymentStatusMessage` remain present; ACTIVE orders are not permanently failed merely because an attempt was dropped. |
| Five-minute ongoing reconciliation | `startPaymentReconciliationWorker` schedules `*/5 * * * *`, runs at startup and prevents local overlap. |
| Removal of permanent age/attempt exclusions | Current query has no seven-day/eight-attempt cutoff. Error delays are bounded at 1/5/15 minutes. |
| Checkout disablement does not stop verification | Worker checks credential availability, not `checkoutEnabled`; verification provider access explicitly permits disabled checkout. |
| Existing pending attempts on paid orders | Worker joins pending transactions and continues monitoring those orders. |
| Missing-order recovery | Trusted recovery snapshots are scanned; missing wallet-assisted/unowned-shop recovery fails closed for review. |
| Recovery index declaration/deployment code | `PaymentOrderRecovery` is included in `ensureIndexes`; verification-only startup has a separate caveat below. |
| Independent purchases and warning | Backend and mobile retain references and require acknowledgement when prior payments remain unresolved. |
| Cache failure does not revoke paid status | Payment helpers separate verified payment success from local synchronization failure; current security tests pass. |
| Duplicate entitlement protection | Source-order/source-payment unique indexes, transactional fulfillment and shop serialization remain present. |

The original affected Sandbox order was already traced and reconciled in the preceding fix. Its provider GETs and development database reads were deliberately not repeated here.

## 2. Payment verification security

| Control | Assessment | Evidence and limits |
| --- | --- | --- |
| Server API authentication | PASS | `server/src/providers/cashfree.js` sends client ID, secret and API version server-side. Mobile receives session/order/environment, not those secrets. |
| Server environment isolation | PASS for inspected guards | `config/env.js` enforces APP_MODE, NODE_ENV, exact database name/URI path and Sandbox/production pairing; environment tests pass. |
| Deployment environment acceptance | NOT VERIFIED | Local production configuration has checkout disabled, no Cashfree credentials and no live approval. No live endpoint/database/secret deployment was tested. |
| Raw-body webhook signature | PASS | `app.js` installs `express.raw` before normal JSON parsing; controller uses timestamp + exact bytes, HMAC and constant-time comparison. Provider tests pass. |
| Ownership | PASS by inspection | JWT authentication resolves the owner/shop; status/verify queries include shop and app mode. Legacy missing-order lookup additionally checks provider customer ownership. |
| Amount/currency/order/payment identity | PASS by inspection and provider tests | Verification requires provider PAID plus matching SUCCESS, exact minor-unit amount/currency and expected references. The specific-payment adapter validates requested payment ID. |
| Plan/duration | PASS by inspection | Strict purchase schema, server plan/pricing lookup, accepted pricing version and HMAC preview bind purchase terms; fulfillment uses the stored purchase snapshot. |
| Duplicate event protection | PARTIAL | Unique event/payment/source identifiers and transactions exist; the duplicate-key recovery branch has finding H-01. |
| Replay protection | PARTIAL | Financial idempotency and provider re-verification protect against ordinary duplicates. Timestamp syntax is checked, but age/future skew is not. |
| Unauthorized status modification | PASS by inspection | No mobile or Admin “mark paid” endpoint was found. Admin reconciliation also verifies with Cashfree. Database-administrator access is outside these API controls. |
| Exactly-once fulfillment | PARTIAL | Normal flow has appropriate transaction/uniqueness controls and historical integration evidence; current failure-injection/multi-process acceptance is incomplete. |

The backend does **not** activate Cashfree-funded subscriptions merely because the mobile callback reports success. Full-wallet purchases use a separate transactional wallet path and are not represented as Cashfree success.

Local development and testing still share a webhook URL. This is a delivery-routing concern for simultaneous Sandbox environments, not proof of Live credentials being used in Sandbox. Mobile local reference keys also lack an environment namespace; see M-03.

## 3. Reconciliation reliability

Current implementation: `server/src/paymentReconciliation.js:startPaymentReconciliationWorker` and `server/src/services/subscriptionService.js:reconcilePendingCashfreePayments`.

- Starts after successful backend/database initialization and executes immediately, then on five-minute cron ticks. It does not depend on the mobile application.
- Worker batch size is 20; the service caps caller-supplied batch size at 50. Missing-order recovery has a separate bounded snapshot scan.
- Selects created/pending orders plus paid orders with a locally recorded pending transaction, within the current app mode. There is no one-order-per-shop restriction.
- Fetches both provider order and attempt list. SUCCESS requires PAID; FAILED/USER_DROPPED/CANCELLED/VOID normalize to unsuccessful attempts; pending results retain unresolved work.
- Successful checks schedule the next five-minute boundary. Provider errors use 1/5/15-minute delays; actual execution depends on cron and backlog.
- Atomic claims compare order state, timestamp and attempt count. Persisted next-check state permits restart recovery. A fifteen-minute staleness path recovers old long backoffs.
- Provider requests time out after 15 seconds. Order and attempt-list GETs run in parallel per inspection; orders are processed sequentially.
- Error codes, attempted/checked timestamps and completion/warning logs exist. There is no alert escalation, dead-letter dashboard or backlog SLO.
- MongoDB failure can interrupt the claim or error-record write and abort that run. The outer worker catches/logs the error and a later tick retries. This is code-path recovery, not tested connection-loss acceptance in this audit.

### Remaining limits

1. **Completed-order integrity blind spot:** a paid order with missing transactions, or an entirely unseen extra capture and no locally pending transaction, is excluded from provider polling. Manual paid-status verification also short-circuits (H-02).
2. **Terminal failed orders:** orders finalized failed after verified provider expiry are not part of ongoing polling. Contradictory later success depends on a webhook/manual verification; the financial policy for this case needs explicit treatment.
3. **No shared provider budget:** each backend instance and status endpoint can initiate provider calls. Status GETs lack an order-level cooldown/single-flight mechanism. Provider 429 is reduced to a generic retryable error, without honoring a provider-specific retry interval.
4. **Broad scans:** the candidate aggregation sorts/joins eligible created/pending/paid rows before applying its final limit. The transaction compound index helps, but many old paid orders without pending attempts can still be examined. Snapshot orphan recovery also scans/joins history. Production query plans/load are NOT VERIFIED.
5. **Lease behavior:** `updatedAt` and next-check timestamps act as a lease, without a dedicated ownership token/heartbeat. A sufficiently delayed worker can overlap another worker and later overwrite scheduling metadata. Transactional fulfillment still needs to enforce financial idempotency.

## 4. Database consistency and requested fault scenarios

Normal verified fulfillment places transaction capture, order finalization, subscription creation/scheduling and audit writes in one MongoDB transaction. `getScheduleForPurchase` writes the shop's entitlement revision to serialize purchases and customer entitlement changes. Unique `gatewayPaymentId`, subscription source-payment/source-order and event identifiers provide additional protection. Financial recovery must preserve these constraints.

The intended transaction behavior does not substitute for database-failure testing:

| Requested scenario | Evidence now | Assessment |
| --- | --- | --- |
| Provider succeeds, transaction insertion fails | Transaction should abort; unresolved order remains retryable. No insertion-failure regression found. | NOT VERIFIED |
| Provider succeeds, subscription activation fails | Same transaction should roll back payment/order changes. Permanent scheduling/snapshot errors have no operator resolution path. | PARTIAL |
| Connection drops during fulfillment/commit | Driver transaction API is used; no real connection-loss/unknown-commit test found or executed. | NOT VERIFIED |
| Webhook and worker process same payment | Existing `mobile verification, webhook, and reconciliation races activate one subscription` test; passed historically, not rerun here. | PARTIAL |
| Two backend instances reconcile same payment | Conditional claims inspected; no two-process crash/lease test found. | NOT VERIFIED |
| Duplicate events | Existing concurrent/duplicate service tests and unique indexes; H-01 demonstrates an incorrect error classification. | PARTIAL |
| FAILED event after SUCCESS | Captured status is protected and provider is re-fetched. Exact fresh-event-after-success regression is missing. Existing failure-before-success test is not equivalent. | PARTIAL |
| Older pending purchase succeeds after newer purchase | Separate successful purchases are supported, but existing retry test settles first order before second. Exact A-pending/B-success/A-success test is missing. | NOT VERIFIED |
| Backend killed during fulfillment | Existing restart test recreates a worker in one process with synthetic timestamps; it does not terminate a process during commit. | NOT VERIFIED |
| Missing order recovered from trusted evidence | Implemented and covered by historical lifecycle tests; legacy missing terms and wallet recovery remain review cases. | PARTIAL |

### Mock-only diagnostic: confirmed incorrect duplicate acknowledgement

An isolated temporary script called the actual `processPaymentWebhook` with mocked models/provider/session. Cashfree responses were mocked as PAID/SUCCESS; the existing transaction was `pending`; no webhook event was committed. `withTransaction` then raised a synthetic `11000` duplicate-key error.

Observed result:

```json
{"result":{"duplicate":true},"existingTransactionStatus":"pending","transactionCalls":1,"mockedProviderCalls":2,"databaseConnected":false}
```

This proves the catch branch can report duplicate success without verifying that a previous fulfillment committed. It does **not** prove a real MongoDB failover produced that sequence. The controller would acknowledge the returned result with HTTP 200. The current polling fallback may eventually retry the pending order, but it does not justify this acknowledgement or cure a persistent unique-index conflict.

## 5. Subscription scheduling and customer limits

The existing business policy is preserved:

- Canonical tier order is Free < Pro < Business, independent of historical numeric tier changes.
- Same-tier purchases queue; Business does not interrupt active Business.
- Higher-tier purchase pauses current lower-tier time at exact millisecond precision.
- Future sequence is deterministic by tier, paused-before-unstarted at that tier, purchase time and stable identifier.
- Lower-tier purchases wait; preserved Pro time precedes newly queued Pro time after the higher-tier sequence.
- Date-based entitlement evaluation uses UTC half-open intervals and remains effective if the reporting transition worker is delayed.
- Calendar-month durations clamp month ends; rescheduled existing periods preserve milliseconds.

**Ten scheduling tests passed in this audit.** No scheduling rule was changed. This does not certify all concurrent database purchase sequences.

Customer selection/creation/financial operations serialize against shop state. Admin-configured limits and paid purchase snapshots remain authoritative. Archive status is separate from deletion; selection does not rewrite balances or ledger entries. Archived customers retain reads/history and collection of existing outstanding debt; new credit is restricted. Offline snapshots use existing secure bindings and bounded grace, and server reconciliation rejects unauthorized queued operations rather than trusting client timestamps.

Current pure mobile/offline tests passed. Database-backed capacity and financial-history tests await approval; physical multi-device/offline acceptance was not performed.

## 6. Refunds, chargebacks, disputes and duplicate charges

| Lifecycle area | Actual implementation | Assessment |
| --- | --- | --- |
| Full/partial refund fields | Transaction schema has refunded statuses, amount and reference fields; reports subtract recorded refunds. | PARTIAL |
| Cashfree refund submission | No provider refund method or approved operator action found. | NOT IMPLEMENTED / FAIL against lifecycle requirement |
| Refund webhook ingestion | Controller only accepts payment SUCCESS/FAILED/USER_DROPPED events; refund events are ignored. | FAIL |
| Refund reconciliation | No provider refund polling/recovery worker found. | FAIL |
| Disputes/chargebacks | No dispute model, provider adapter, webhook flow, monitoring or resolution workflow found. | FAIL |
| Refund-related entitlement adjustment | No approved full/partial/prorated/paused/queued-entitlement adjustment policy found. | NOT VERIFIED / policy missing |
| Extra captures for one order | Observed extra captures are stored as `duplicate_order_capture`, without a second entitlement. Admin projections do not expose the review reason. | PARTIAL |
| Independent successful purchases | Each order is a separate purchase, including acknowledged retries. This is not automatically a refundable duplicate. | PARTIAL, historical integration evidence |

Customer ledger advance refunds are a different feature and do **not** implement subscription-payment refunds. Admin fixtures containing refunded transactions do **not** demonstrate provider refund processing.

Approve a policy for refunds, disputes, wallet contributions, tax/receipts, paused time and queued subscriptions before implementation. Do not automatically issue money or revoke access solely to fill these gaps.

## 7. Mobile checkout audit

`src/cashfreeCheckout.ts` validates the callback order ID and removes its callback on completion. SDK errors/cancellation do not themselves establish final payment status; the app rechecks with the backend. References are stored before checkout and retained in a journal for later recovery. Network/timeouts keep unresolved work. Server-paid status remains successful even when local cache persistence fails.

Current security tests cover stale attempts, storage/cache failures, retry/reference preservation and USER_DROPPED wording. Native cancellation, OS termination, restored/reinstalled storage and actual Cashfree UI remain NOT VERIFIED.

Remaining findings:

- Phone-only SecureStore keys can collide across environments or replaced shops. A `different-shop` result returns before offering an independent purchase.
- The reference journal is unbounded and sequentially rechecks historical entries. Large histories can increase latency and storage failure risk.
- Refresh catches some verification errors and displays one latest message; it is not a complete per-purchase review queue.
- Old refresh completion can delete the pending key without comparing it to a newer checkout reference. The retained journal reduces loss risk but does not make this a clean atomic update.
- The mobile history endpoint selects one preferred transaction per order; it does not expose all attempts or raw USER_DROPPED history.
- Production Android disables cleartext traffic, but `src/api.ts` falls back to an emulator HTTP URL when the backend URL is absent. Missing release configuration therefore fails at runtime rather than build validation. Hosted release environment binding is NOT VERIFIED.

## 8. Admin Panel audit

Admin controls retain trusted proxy/origin checks, production HTTPS enforcement, expiring/versioned sessions, CSRF verification, role permissions, recent authentication, rate limits and audit calls. Reconciliation is permission-gated and uses server verification; no “mark Cashfree paid” bypass was found.

| Required view/action | Current result |
| --- | --- |
| Payment orders | Present, environment-scoped and paginated. |
| Payment attempts | Transaction list present, but missing-order transactions are filtered out by the joined order environment requirement. |
| Raw Cashfree order/attempt statuses | **Missing from projections/UI**, despite newly persisted fields. |
| Reconciliation count/next/error | Present. Last attempted/checked timestamps are not projected/displayed. |
| Failed webhook events | No failed-event inbox/view; transaction rollback/provider failures do not persist a durable failed delivery record. |
| Missing orders/transactions | No complete integrity/orphan review workflow. Admin reconciliation requires the order to exist. |
| Activation/history/paused/queued rows | Existing subscription/read views support these states; current browser acceptance not run. |
| Refunds | Stored amount/status reporting only; no provider-backed workflow. |
| Disputes/chargebacks | No records/view found. |
| Manual payment reconciliation | Authenticated, authorized, reauthenticated and audited, but paid-order fast path does not repair missing financial evidence. |

Admin unit tests passed; browser and Mongo-backed permission/action tests were not rerun without disposable-database approval. App-level audit insertion is not proof of an externally immutable/WORM audit store.

## 9. Findings ranked by severity

### CRITICAL

**None demonstrated.** No inspected API route grants Cashfree-funded entitlement solely from a client success flag. Remaining untested scenarios prevent blanket security certification.

### HIGH

| ID | Finding and exact affected code | Recommended fix after approval |
| --- | --- | --- |
| H-01 | `server/src/services/subscriptionService.js:processPaymentWebhook`, `catch (11000)`: any existing transaction can cause duplicate acknowledgement, even pending. Confirmed by mock diagnostic. | Only acknowledge an independently committed matching outcome; verify captured transaction, order and entitlement/event invariants. Classify unique-index conflicts and retry/escalate other conflicts. |
| H-02 | `verifyPayment`, `getPaymentOrderStatus`, `reconcilePayment`, `reconcilePendingCashfreePayments`: paid-order fast paths and the pending-only transaction join miss deleted financial records/unseen captures; a captured transaction with missing entitlement can short-circuit recovery. | Add an integrity reconciliation path that verifies provider evidence and repairs only from trusted terms; explicitly check payment/order/entitlement consistency before declaring completion. |
| H-03 | `server/src/controllers/subscriptionController.js:handle_post_payment_webhook`, `server/src/providers/cashfree.js`, `server/src/models.js`: refund/dispute fields are not a refund/dispute lifecycle. | Approve financial/entitlement policy, then implement authenticated ingestion, reconciliation, audit and operator resolution. Never infer automatic revocation/refund policy. |
| H-04 | `server/src/admin/services/readModels.js:payments/paymentOrders/paymentDetailsJoin`, `website/src/components/admin/tables/payment-orders.tsx`, `server/src/models.js:PaymentWebhookEvent`: operator views omit raw states, review flags, orphan records and failed webhook deliveries; no unresolved-payment alerts. | Add durable delivery outcomes, alerts/backlog monitoring and permissioned financial review views; retain redacted evidence and safe retry controls. |
| H-05 | `server/src/services/subscriptionService.js:releaseWalletReservation/reconcilePayment`: a reservation already marked released is not recaptured if provider success is later verified, although the full entitlement amount includes its wallet contribution. Conditional late-status/legacy-state risk; not reproduced against MongoDB. | Require a consistent settled wallet contribution or explicit financial-review state before fulfillment. Test released-reservation late success and approved policy. Existing missing-wallet-order recovery correctly fails closed. |
| H-06 | `server/src/index.js`: `ensureIndexes` runs at normal startup only when checkout is enabled; `config/database.js` disables auto-indexing, while the worker now runs with verification credentials even when checkout is disabled. | Verify/create required payment/entitlement/event indexes independently of new-checkout enablement. Fail safely on missing/duplicate constraints before verification starts. No claim is made that production indexes are currently missing. |
| H-07 | retired automated validation, Admin integration/browser suites and native acceptance: database outage/commit interruption/two-process and exact delayed A/B purchase coverage is incomplete. | Run the approved disposable-database suites and add focused fault-injection/multi-process regressions in a later implementation task; complete device acceptance before release. |

### MEDIUM

| ID | Finding and exact affected code | Recommended fix after approval |
| --- | --- | --- |
| M-01 | `reconcilePendingCashfreePayments`, `providers/cashfree.js:cashfreeRequest`, `routes/paymentRoutes.js`: no shared provider request budget, cooldown or jitter; broad history joins; provider error details collapse to one code. | Measure query plans/backlog, add per-order single-flight/provider budgets, sanitized error/request identifiers and adaptive throttling. |
| M-02 | `controllers/subscriptionController.js:handle_post_payment_webhook`, `routes/index.js`, `middleware/rateLimits.js`: no timestamp freshness policy; generic per-IP API limiter also handles webhooks. | Add a provider-compatible replay/delivery policy and dedicated webhook ingress controls; retain delayed-payment recovery and do not blindly discard delayed legitimate events. |
| M-03 | `App.tsx:purchaseSubscription/refreshSubscriptionInfo/retainSubscriptionReference`, `src/subscriptionPaymentAttempt.ts`: environment/shop key collision, unbounded journal, swallowed per-reference errors and stale-refresh cleanup race. | Migrate references without deletion to environment/shop-scoped storage, compare-and-clear current references, paginate history and expose per-purchase review/error states. |
| M-04 | `recordOrderObservation`, `listPaymentHistory`, `recordObservedAttempt`: same-time distinct payment IDs do not advance persisted latest metadata; mobile history collapses attempts; a create-time duplicate-key race is swallowed without reapplying the newer observation. | Define one deterministic attempt ordering and persist via conditional upserts with duplicate re-read/retry; expose attempt history separately from order history. |
| M-05 | `reconcilePendingCashfreePayments`: implicit timestamp lease lacks an owner token; late workers can overwrite scheduling metadata. | Use explicit claim ownership/expiry and fenced completion writes; test two actual worker processes and process termination. |
| M-06 | `recoverMissingOrder`, `processPaymentWebhook`: missing purchase terms correctly block fulfillment, but unknown-order events are acknowledged ignored without a durable review item. | Persist a redacted orphan/recovery case and provide a permissioned review route; never guess amount/plan. |
| M-07 | `src/api.ts`, `app.config.js`, environment deployment: no mandatory release backend URL check; development/testing share a callback. | Validate release URL/environment binding and deploy distinct Sandbox callbacks/processes. Keep production HTTPS and existing environment guards. |

### LOW

| ID | Finding | Recommended fix after approval |
| --- | --- | --- |
| L-01 | `server/src/config/env.js` still accepts `PAYMENT_RECONCILIATION_MAX_ATTEMPTS`, but it no longer controls retry termination. | Deprecate/document it explicitly, or replace it with meaningful operational settings without reinstating silent exclusion. |
| L-02 | Application audit schemas/insertion paths do not establish externally immutable retention or production restore guarantees. | Document retention, restricted database roles, backup/restore drills and external audit protection appropriate to the deployment. |

## 10. Missing tests and acceptance work

In addition to rerunning existing database suites after approval, add targeted regressions in a later code-change task for:

1. Transaction insertion failure after provider success, and entitlement insertion failure after transaction preparation.
2. Lost database connection and unknown commit result; abrupt backend kill during fulfillment.
3. Two independent backend processes claiming the same order, including expired claims and slow workers.
4. Unrelated unique-index violation with an existing pending transaction — H-01 diagnostic should become a regression expecting retry/error, not duplicate acknowledgement.
5. Exact A PENDING → B SUCCESS → A SUCCESS with one entitlement per order and deterministic scheduling.
6. Fresh FAILED webhook after SUCCESS, including different attempt IDs and replayed event IDs.
7. Paid order with its transaction missing; captured transaction with entitlement missing; unseen additional capture with no locally pending row.
8. Released wallet contribution followed by verified late success and approved financial resolution.
9. Refund/partial refund/dispute lifecycle once policy is approved.
10. Admin display of raw states, orphan/review records, failed webhook events and reconciliation authorization/audit outcomes.
11. Mobile reference migration across environments/shops, journal size limits and concurrent refresh/checkout cleanup.
12. Installed Android termination/cancellation/radio/storage faults and two-device offline reconciliation.

Native-device tests actually performed in this audit: **0**. Cashfree Sandbox checkout acceptance actually performed in this audit: **0**. Existing mocked tests and previous read-only Sandbox observations must not be described as production or native acceptance.

## 11. Test execution results

| Executed validation | Passing | Failing | Skipped | Notes |
| --- | ---: | ---: | ---: | --- |
| Root non-Mongo mobile/application suites | 266 | 0 | 0 | All retired automated validation, retired automated validation, retired automated validation, retired automated validation, and non-`.mongo.` retired automated validation. Includes the 29 subscription-security and 27 localization tests. |
| Backend non-Mongo suites | 42 | 0 | 0 | Provider 4, pricing 8, scheduling 10, environment 9, utility 5, Admin unit 6. |
| **Unique automated-suite total** | **308** | **0** | **0** | No duplicate counting of security/localization/scheduling subsets. |
| Duplicate-key fault diagnostic | 1 reproduction | — | — | Assertions confirmed the defect; not a payment-health pass. Models/provider/session mocked, no database connection. |
| Mobile `npm run typecheck` | PASS | — | — | No emitted application code. |
| Admin `./node_modules/.bin/tsc --noEmit --incremental false` | PASS | — | — | Direct typecheck used existing generated Next types; no Next application regeneration/build. |
| `git diff --check` | PASS | — | — | Read-only whitespace verification. |

Backend command:

Automated validation commands were retired on 8 November 2026.

The initial restricted runs had one mobile HTTP-clock socket failure and two backend mock-server socket failures (`EPERM`). The same suites were rerun with required socket permission and passed. No tests were changed, disabled or silently skipped.

**Not executed:** full retired automated validation (its provider/pricing portion did run), retired automated validation, retired automated validation, retired automated validation, retired automated validation, and `website`'s retired automated validation. These write database records, including browser authentication/audit/management activity. Your instruction requires approval for an isolated disposable database; that approval remains outstanding. They are not counted as skipped or passing tests because they were not launched.

No new Android export was necessary for this read-only audit; the preceding fix's successful export is historical evidence only. Backend is JavaScript and has no declared backend TypeScript command. No hosted production database or deployed index verification was performed.

Final SHA-256 comparison against the audit-start baseline found **zero changed files among 691 application/configuration files**. Only this audit report was added to the repository.

## 12. Final component assessment

| Component | Assessment |
| --- | --- |
| Previous USER_DROPPED/retry fixes retained | PASS by current inspection and relevant pure tests |
| Server authentication, pricing and ownership guards | PASS within inspected/tested scope |
| Raw webhook signature verification | PASS |
| Duplicate/replay/error recovery | PARTIAL — H-01 confirmed |
| Five-minute/startup reconciliation independent of mobile/checkout | PASS by inspection; deployment/process acceptance PARTIAL |
| Database atomicity and exactly-once normal flow | PARTIAL — intended controls present; failure acceptance outstanding |
| Missing/corrupt financial record recovery | PARTIAL — H-02/H-06 |
| Subscription scheduling policy | PASS for pure scheduler; database concurrency PARTIAL |
| Customer limits/archive financial preservation | PARTIAL — code/pure evidence; database/device acceptance outstanding |
| Refund/chargeback/dispute lifecycle | FAIL |
| Admin financial investigation completeness | FAIL |
| Admin authentication/authorization | PARTIAL — unit/inspection pass; integration/browser rerun pending |
| Mobile automated behavior | PASS for executed pure tests; native acceptance NOT VERIFIED |
| Production credentials, webhook delivery and deployment | NOT VERIFIED |
| Overall production readiness | **PARTIAL — release acceptance withheld** |

Recommended order: fix H-01 and integrity/index prerequisites; approve refund/dispute/wallet policies; implement operator visibility and recovery; execute approved database failure/concurrency tests; then complete installed-device and deployed Sandbox acceptance. Preserve the current subscription scheduling business rules. Changes must be approved separately; none were implemented during this audit.

## Follow-up implementation — 8 November 2026

See [readiness fixes and follow-up audit](CASHFREE-READINESS-FIXES-2026-11-08.md) for the subsequent implementation, latest validation, remaining release blockers and the user's instruction to retain no newly authored tests. See [payment lifecycle policy](PAYMENT-LIFECYCLE-POLICY.md) for refund, cancellation, dispute and entitlement-review boundaries. The original findings above remain the historical pre-fix audit; they are not a description of the updated implementation. Production acceptance remains incomplete.
