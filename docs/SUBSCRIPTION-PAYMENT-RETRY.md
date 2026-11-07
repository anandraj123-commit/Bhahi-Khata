# Subscription payment retry fix — 31 October 2026

> Historical engineering record: automated testing infrastructure was removed on 8 November 2026 at the owner’s request. Prior results are historical; do not create or run tests until explicitly requested.

## Root cause

`inspectCashfreeOrder` previously looked for SUCCESS with a PAID order, or EXPIRED/TERMINATED orders. It ignored FAILED payment attempts on ACTIVE orders. The failure webhook wrote a failed `PaymentTransaction`, but the status endpoint still returned the pending `PaymentOrder` state. Mobile and backend guards treated that pending order as an indefinite checkout lock. A missing local Mongo order returned 404, which correctly retained the device reference but offered no independent purchase/reconciliation path.

Cashfree orders and payment attempts have distinct lifecycles: an ACTIVE order may contain a terminal failed attempt and still accept another attempt. See the [Cashfree order API](https://www.postman.com/cashfreedevelopers/cashfree-apis-v2025-01-01/request/39jbmjg/get-order) and [Cashfree late-authorisation guidance](https://www.cashfree.com/blog/late-payment-authorisation/).

## Changes

- Polling validates order identity, amount and currency, records provider-observed failed/pending transactions, and reports the latest attempt separately from the order. Successful activation still requires PAID plus a matching SUCCESS transaction and the existing transactional checks.
- Success takes precedence over a concurrent stale failure. Failed attempts cannot overwrite captured transactions. An older pending attempt remains a duplicate-charge risk even if the newest attempt failed.
- Payment history selects the latest attempt by provider time, while retaining captured/refund precedence. Responses include separate order/attempt statuses.
- Failed attempts allow retry. Unresolved attempts require explicit duplicate-charge acknowledgement before an independent purchase receives its own idempotency key. Releasing a checkout slot does not delete an order, mark it failed, release reserved wallet funds, or prevent later reconciliation.
- Previously released but still unresolved orders also require acknowledgement. The unique active-checkout constraint, stable idempotency keys, shop/environment checks and transactional entitlement uniqueness remain enforced.
- Mobile saves previous references to an account-scoped SecureStore journal before replacing the working reference. Journal writes are serialized; read/write failures stop replacement. References are deduplicated by order or idempotency key and are not automatically removed. Retained references are checked only for the current shop; backend order/recovery lookups enforce APP_MODE in the environment-separated database.
- Reopening the subscription screen checks retained references and refreshes entitlements. Check Payment Status and Retry Payment buttons are provided. Verified failures display Payment Failed; a successful payment with a cache failure remains successful.
- New server-authored `PaymentOrderRecovery` documents preserve immutable purchase terms before provider order creation. Orders encountered during inspection also acquire recovery evidence. A missing order can be restored using these terms for polling, webhook fulfilment and idempotent checkout recovery.
- Legacy deleted orders without recovery evidence are looked up using the deterministic `dk_<MongoID>` Cashfree order ID. Cashfree customer identity must match the authenticated shop. Failed attempts can be recorded and reported, but SUCCESS alone cannot supply missing plan, duration, pricing or wallet terms. These cases return `requiresReview`; they never invent paid entitlement or block an explicitly acknowledged independent purchase. Restore trusted historical purchase evidence through an authorized recovery process before fulfilling such a legacy orphan.

## Files changed for this fix

- `App.tsx`
- `src/api.ts`
- `src/subscriptionPaymentAttempt.ts`
- `src/subscriptionTranslations.ts`
- `src/translationInventory.ts`
- `server/src/models.js`
- `server/src/controllers/subscriptionController.js`
- `server/src/services/subscriptionService.js`
- This document and the existing subscription system/validation documents.

## Deployment and acceptance

Create the new collection/index through the existing environment-specific index process. Recovery evidence is additive and not a retrospective reconstruction of already deleted records. Do not delete payment orders or the recovery collection as an operational retry procedure. Retained unresolved wallet reservations must only be released through authoritative terminal reconciliation, not merely because another checkout starts.

All provider calls in automated tests are mocked with Sandbox configuration. No external Sandbox or Live checkout, production database write, commit or push was performed. Installed Android acceptance must still verify failed Sandbox checkout → status refresh → retry; explicit pending-payment warning; process restart with retained references; and late success after an independent purchase. Native SecureStore/SDK acceptance has not been performed.

## Automated results for this follow-up

- retired automated validation (server): **41 passed, 0 failed, 0 skipped**.
- retired automated validation (server): **10 passed, 0 failed, 0 skipped**.
- retired automated validation: **28 passed, 0 failed, 0 skipped**.
- Full mobile/shared/plugin suite with opt-in Mongo tests: **267 passed, 0 failed, 0 skipped** (includes the security tests and 27 localization tests; do not double-count).
- Mobile typecheck, Android export and `git diff --check`: passed.

Payment additions cover FAILED on ACTIVE, newest PENDING after older FAILED, newest FAILED with older PENDING, explicit independent retry, retained historical pending guards, exactly-once fulfilment of separate purchases, missing-order API/webhook recovery, missing-order idempotency replay and legacy missing-order ownership checks. Existing expired-order, timeout, duplicate-webhook, amount/ownership and cache/SecureStore tests also passed. No tests were skipped or disabled.
