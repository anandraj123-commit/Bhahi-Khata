# Cashfree readiness fixes and follow-up audit

> Historical engineering record: automated testing infrastructure was removed on 8 November 2026 at the owner’s request. Prior results are historical; do not create or run tests until explicitly requested.

Date: 8 November 2026. **Assessment: PARTIAL — NOT production-ready.**

This report follows `CASHFREE-PRODUCTION-READINESS-AUDIT.md`. Source changes are implemented locally; no deployment, production database/configuration modification, real payment/refund, commit or push was performed. No disposable database was created: explicit approval has not been received.

The user subsequently requested no new or modified tests. Tests introduced during this implementation pass were removed, appended test cases were removed, and changes made in this pass to existing test expectations/scripts were restored. Earlier project tests and earlier uncommitted subscription work were preserved. No tests are added or changed further under that instruction.

## Findings and changes

| Finding | Change | Follow-up assessment |
| --- | --- | --- |
| H-01 success-webhook duplicate-key acknowledgement | Removed the transaction-existence shortcut; require a committed processed event. Added majority-written inbox and backend retry processing. | Implemented; database failure acceptance NOT VERIFIED. |
| H-02 recovery blind spots | Paid manual checks re-fetch Cashfree; worker also revisits paid/failed history. Missing entitlement/primary capture and released wallet contributions produce explicit review codes. Trusted missing-order snapshots remain supported; Admin can request their recovery. | PARTIAL: no automatic reconstruction without trustworthy evidence; recovery cases require operator resolution. |
| H-03 refunds/disputes | Authenticated refund GET adapter, unique refund observations, monotonic success, transactional totals, polling, refund webhook routing, Admin views and explicit lifecycle policy. | PARTIAL: no refund submission, dispute API integration, chargeback accounting or automatic entitlement adjustment. |
| H-04 observability | Durable webhook backlog, error/attempt timestamps, raw provider statuses, extra-capture review fields, refund and missing-order views, authenticated health counts and warning logs. | PARTIAL: external alert delivery and operational response are unverified; some views show only latest 20 records. |
| H-05 wallet late success | Released or absent required wallet reservation fails closed with review code. | Implemented; real transaction acceptance NOT VERIFIED. |
| H-06 verification-only indexes | Startup index initialization also runs when verification credentials exist with checkout disabled. Required unique key/sparse/partial constraints are checked against actual index metadata after creation. | Implemented; no real index migration/verification executed in this pass. |
| H-07 fault/concurrency acceptance | Earlier mocked results remain historical evidence. | NOT VERIFIED; no new regression suite retained per latest instruction. |
| M-01 API usage | Per-process GET single-flight, eight-request concurrency bound, provider HTTP status, Retry-After cooldown/backoff, daily terminal integrity polling. | PARTIAL: distributed quota/load and query-plan acceptance remain. |
| M-02 replay/ingress | Separate webhook rate limiter; durable event deduplication and provider re-verification permit delayed authentic events. | PARTIAL: no signed-timestamp age rejection; financial replay protection relies on idempotency and verification. |
| M-03 mobile persistence | Backend-scoped pending keys, non-destructive legacy copy, encrypted SQLite reference journal, rotating 20-reference refresh, no refresh deletion race, independent checkout after cross-shop warning. | Implemented; native migration/termination/restore acceptance NOT VERIFIED. |
| M-04 attempts/history | Concurrent insertion conflicts re-read the genuine attempt; deterministic equal-time ID ordering; history exposes all recorded attempts; raw statuses displayed. | Implemented; concurrency/native presentation acceptance NOT VERIFIED. |
| M-05 claim ownership | Unique lease tokens fence completion/error metadata; crashed claims become due; legacy unresolved delays can recover without overriding rate-limit cooldowns. | Implemented; two-process/failover acceptance NOT VERIFIED. |
| M-06 unknown orders | Durable webhook recovery queue and explicit review instead of silently ignoring missing known payment orders. | PARTIAL: missing trusted evidence needs manual resolution. |
| M-07 release configuration | Explicit HTTPS URL required for production EAS/APP_MODE builds. | PARTIAL: hosted environment binding and distinct webhook delivery URLs remain deployment acceptance. |
| LOW audit retention | Policy documents preservation, retention and external immutable storage requirements. | Deployment controls NOT VERIFIED. |

Final review additionally requires an unresolved failure webhook to remain queued, a refund webhook to match an authenticated API refund reference, and a successful durable-update match before reporting completion or retained recovery. Missing queue rows cannot be acknowledged as queued.

No critical authentication bypass was established. That statement is not a security certification. Success continues to require backend provider verification; scheduling business rules are unchanged. No pending/reference records were deleted to unlock checkout.

## Modified implementation files in this pass

- `App.tsx`, `app.config.js`, `plugins/validateReleasePaymentConfig.cjs`.
- `src/offlineStore.ts`, `src/subscriptionPaymentAttempt.ts`, `src/translationInventory.ts`.
- `server/src/services/subscriptionService.js`, `paymentWebhookInbox.js`, `paymentRefunds.js`, `paymentIndexVerification.js`.
- `server/src/models.js`, `server/src/index.js`, `server/src/paymentReconciliation.js`.
- `server/src/providers/cashfree.js`, `server/src/providers/paymentProvider.js`.
- `server/src/controllers/subscriptionController.js`, `server/src/middleware/rateLimits.js`, `server/src/routes/index.js`, `server/src/routes/paymentRoutes.js`.
- `server/src/admin/services/readModels.js`, `server/src/admin/routes/readRoutes.js`.
- `website/src/components/admin/tables/payment-orders.tsx`, `website/src/components/admin/tables/resource-table.tsx`.
- This report, `docs/PAYMENT-LIFECYCLE-POLICY.md`, and a pointer in the original audit.

The repository already contained substantial uncommitted changes before this pass. This list is not a claim of ownership over the entire working-tree diff.

## Validation evidence

Latest checks after implementation and removal of newly authored tests:

| Check | Result |
| --- | --- |
| Mobile `npm run typecheck` | PASS, exit 0 |
| Admin `tsc --noEmit --incremental false` | PASS, exit 0 |
| `npm run export:android` | PASS, exit 0; development export, not physical-device acceptance |
| JavaScript syntax checks on modified backend services/controllers/models | PASS, exit 0 |
| `git diff --check` | PASS, exit 0 |
| Database-backed payment and Admin integration/browser suites | NOT RUN; disposable DB approval outstanding |
| Native Android/Cashfree Sandbox end-to-end acceptance | NOT RUN |

Before the latest instruction and subsequent final source edits, a combined non-database run reported **266 mobile/localization/plugin tests passed and 67 backend tests passed**, zero failures on those runs. The backend count included new tests subsequently removed as requested. Subscription security separately passed 29 tests; localization separately passed 27; both overlap other totals. Earlier runs encountered localhost EPERM (resolved by authorized execution outside the sandbox) and localization inventory mismatch (corrected). These historical counts do not certify the final source tree or supply ongoing coverage after test removal. No final new test cases were written or executed after the instruction.

## Required acceptance and remaining risks

1. **HIGH:** Approve an isolated disposable replica set before checking actual majority durability, transaction rollback/unknown commit, concurrent webhook/worker operation, restart during fulfillment, two instances, unique indexes and deleted-record recovery. No existing database should substitute for that approval.
2. **HIGH:** Approve and implement the missing operational dispute/refund-adjustment policy where required by the intended release. Dispute API verification, evidence handling and chargeback accounting are not complete. Refund observation does not constitute refund processing approval.
3. **HIGH:** Exercise actual Sandbox webhook delivery, USER_DROPPED, pending/late success, extra captures, missing-order review and the independent A-pending/B-success/A-success sequence. Use synthetic Sandbox purchases only under an authorized acceptance plan.
4. **HIGH:** On Android, validate SecureStore/SQLCipher migration, checkout cancellation/termination, network loss after debit, storage failure, restore/reinstall and environment switching. Verify successful payment remains successful despite cache failure.
5. **MEDIUM:** Validate provider quotas and database query plans at realistic history sizes. Shared cross-instance API budgeting and external alert delivery remain deployment gaps.
6. **MEDIUM:** Verify Admin permissions, CSRF/re-authentication, audit records, missing-order reconciliation, refund visibility and recovery queue pagination in browser acceptance.
7. **MEDIUM:** Configure distinct development/testing callback delivery, production secrets and HTTPS URL through the existing environment system. No production configuration was changed.
8. Keep database backups and establish the manual review owner/response time before release. Do not guess missing plan terms, re-debit released wallet funds or issue refunds to close a review item.

The local development watcher/backend was paused earlier to prevent automatic execution of unfinished payment changes against the existing database. It was not resumed by this implementation pass. Restart it deliberately after reviewing these changes and choosing the intended environment.
