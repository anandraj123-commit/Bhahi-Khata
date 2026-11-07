# Cashfree PENDING → USER_DROPPED reconciliation fix

> Historical engineering record: automated testing infrastructure was removed on 8 November 2026 at the owner’s request. Prior results are historical; do not create or run tests until explicitly requested.

Implemented and validated on 1 November 2026 (Asia/Kolkata). This follows the read-only findings in `CASHFREE-SANDBOX-RECONCILIATION-AUDIT.md`; that report describes the earlier implementation.

## Actual affected payment and root cause

The development Sandbox payment was identified using existing local order records and authenticated Cashfree GET requests:

| Field | Verified value |
| --- | --- |
| Environment | `development`, Cashfree `sandbox` |
| Database | `digital_khata_development` |
| Cashfree order ID | `dk_6ae623de8c944df0042c71c4` |
| Cashfree payment ID | `1470107617531918336` |
| Provider order status | `ACTIVE` |
| Provider attempt status | `USER_DROPPED` |
| Last original worker update | 31 October, 19:05:00 UTC |
| Original next check | 31 October, 23:05:00 UTC |
| Provider completion timestamp | 1 November, 00:52:58 IST / 31 October, 19:22:58 UTC |

**The immediate cause was four-hour backoff after five checks, not a Cashfree authentication failure or absent USER_DROPPED mapping.** The attempt changed after the last check. The worker had not yet reached its next scheduled verification. Its old policy could eventually stop checking altogether after eight attempts or seven days.

The original backend already normalized USER_DROPPED to `failed`, but did not retain that raw provider status in the transaction or latest-attempt fields on the order. This made order/attempt state difficult to distinguish and prevented a specific mobile message.

For this development order, the transaction was **present but stale (`pending`)**. The separate testing database contains order `dk_6ae2470ac773acfc164b3786`; Cashfree returned **no payment attempts** for it. Its empty transaction collection is appropriate. No fabricated transaction was inserted for that order.

Requests used `https://sandbox.cashfree.com/pg`, server-side credentials and configured API version `2026-01-01`:

- `GET /orders/{order_id}`
- `GET /orders/{order_id}/payments`
- `GET /orders/{order_id}/payments/{cf_payment_id}`

The exact payment lookup independently confirmed USER_DROPPED. Provider order reference, amount and currency matched the stored purchase. No credentials were printed.

## Worker and webhook evidence

The backend was running on port 4000. Its persisted attempt counter had advanced to five, with successful prior checks and no last provider error. This establishes execution rather than relying on an enabled log. The original process wrote stdout/stderr to an interactive terminal, so its historical console output was not available as a retained log file.

During development the running backend restarted/reloaded, and the affected transaction was synchronized before the final guarded one-shot worker check. The backend PID changed from 3181 to 33830. At the verification observation at **20:16:29 UTC**, the order's successful-check timestamp was **20:13:30 UTC**. The one-shot invocation logged both worker startup and completion, with `scanned: 0` and `attempted: 0`, because the already-synchronized order was not yet due. The report does not attribute the repair to that zero-work invocation.

The worker runs independently of the mobile application. Its schedule remains every five minutes; it now also runs immediately at backend startup. Successful ongoing polling schedules the next five-minute boundary. Provider errors retry with 1/5/15-minute backoff, subject to cron cadence and batch capacity. Unresolved orders no longer exhaust an attempt budget or age out. The legacy `PAYMENT_RECONCILIATION_MAX_ATTEMPTS` configuration remains accepted for compatibility but no longer terminates verification.

The existing endpoint remains `POST /api/v1/payments/webhook`. Raw-body HMAC signature verification, server-side payment/order re-fetching, identity/amount/currency checks, MongoDB transactions, and event uniqueness remain in place. USER_DROPPED events are handled as unsuccessful attempts; they never activate subscriptions.

The configured Sandbox notification URL uses the existing ngrok tunnel. No matching USER_DROPPED event was found in its currently retained captures for the affected order. Capture retention is incomplete evidence: **whether Cashfree emitted/delivered this specific event is not established**, and dashboard event registration was not independently inspected. The fix does not rely on every status transition producing a webhook. Cashfree's [checkout integration guidance](https://www.cashfree.com/devstudio/preview/pg/mobile/android) distinguishes user-dropped failures from pending payments and provides server-side payment-list retrieval.

## Changes

### Persistence and reporting

- Added `PaymentTransaction.gatewayStatus` while preserving existing normalized transaction status values and APIs.
- Added provider order status, latest genuine payment ID/status/time, and attempted/successfully checked timestamps to `PaymentOrder`.
- Genuine PENDING attempts are inserted; subsequent USER_DROPPED/FAILED/SUCCESS observations update the same unique payment record.
- Conditional non-success updates cannot overwrite captured success or regress an already-failed transaction to pending.
- USER_DROPPED/CANCELLED/VOID are unsuccessful attempt states; an ACTIVE order is retained as open/pending rather than incorrectly finalized as a failed order.
- Failed-attempt webhooks arriving after another attempt paid the order can still preserve that failed transaction.
- Polling processes all returned successful captures. Additional successful captures for one order are retained for review without a second entitlement or misleading additional-payment success notification.

### Autonomous reconciliation and recovery

- Removed age and attempt exclusions. Old long-backoff records become eligible once stale for fifteen minutes.
- Provider failures produce a per-order warning and persisted error code, rather than only an aggregate failed count.
- Retained atomic claim checks and process-local overlap protection. Claims have a finite next-check time so interrupted work can resume.
- Worker startup depends on verification credentials, not whether new checkout is enabled.
- Paid orders with a locally recorded pending attempt continue to be selected until that attempt resolves. A compound transaction `orderId/status` index supports this lookup.
- Missing orders can be restored from trusted server purchase snapshots and verified automatically. Interrupted creation can probe the existing deterministic Cashfree order ID without creating another charge.
- Recovery failures retain their evidence, record a review code, log a warning, and retry later instead of occupying every recovery batch immediately.
- Added the previously omitted recovery model to index initialization.
- Recovery refuses to resurrect orders for absent shops or blindly restore mutable wallet reservations. Missing wallet-assisted orders requiring financial reconstruction remain explicitly reviewable.

### Mobile and localization

- Added a shared message selector that displays **Payment Not Completed** for USER_DROPPED/CANCELLED/VOID while preserving successful-payment precedence.
- Existing Retry Payment and Check Payment Status controls remain available.
- Existing unresolved-reference retention and duplicate-charge acknowledgement remain in force when another attempt is pending.
- Added the new message in all 22 non-English supported locales; English uses the source key. Updated the translation inventory and its explicit completeness counts without removing translation checks.
- Paid activation, renewal scheduling, server-side pricing, signed previews and Cashfree verification checks were not weakened.

## Original-order result

After the fixed backend synchronized the development order, an independent read confirmed:

| Stored result | Value |
| --- | --- |
| Order status | `pending` — appropriate for provider ACTIVE |
| Latest attempt status | `USER_DROPPED` |
| Transaction normalized status | `failed` |
| Transaction raw gateway status | `USER_DROPPED` |
| Records for genuine Cashfree payment ID | **1** |
| Subscriptions for this order before/after | **0 / 0** |

**The original affected order is reconciled.** The app must load the updated mobile code and refresh to display the new wording; native-device UI acceptance was not performed.

The verification script rejected production, checked the exact expected order/payment and provider state, and refused to run if additional unresolved orders or missing-order recoveries would be processed. No payment was created or replayed. Only development Sandbox reconciliation and isolated localhost test fixtures were authorized; production payment data was untouched.

## Tests actually executed

| Command | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Server: retired automated validation | 49 | 0 | 0 |
| Root: retired automated validation | 29 | 0 | 0 |
| retired automated validation | 10 | 0 | 0 |
| retired automated validation | 27 | 0 | 0 |
| **Final total** | **115** | **0** | **0** |

Additional checks: mobile `npm run typecheck` passed; `npm run export:android` passed; `git diff --check` passed.

New regressions cover same-ID PENDING → USER_DROPPED, FAILED and SUCCESS without webhook/mobile intervention; missing transaction/order recovery; ACTIVE plus USER_DROPPED; duplicate terminal webhooks; startup/restart and checkout-disabled operation; legacy long backoff; multiple attempts; and an unresolved attempt transitioning after another attempt has paid the order. The latter verifies that an extra capture cannot create a duplicate subscription. Existing ownership, amount, idempotency, webhook and subscription security regressions remain enabled.

Initial restricted runs hit localhost socket permission errors and were rerun with the required execution permission. Intermediate application/test failures exposed created-order recovery reporting and a test assumption that no other unresolved order could be checked during the target's backoff; these were corrected and all final suites rerun successfully. Localization inventory expectations were updated for the added key. No failure was suppressed or test skipped.

The payment tests used mocked provider responses and the isolated localhost replica set on port 27032, not the Atlas development/testing databases. Native-device tests performed: **0**. Android export is not native checkout acceptance.

## Files changed for this fix

- `server/src/paymentReconciliation.js`
- `server/src/services/subscriptionService.js`
- `server/src/models.js`
- `App.tsx`
- `src/api.ts`
- `src/subscriptionPaymentAttempt.ts`
- `src/subscriptionTranslations.ts`
- `src/translationInventory.ts`
- `docs/CASHFREE-USER-DROPPED-FIX.md`

Pre-existing uncommitted changes were preserved. The working-tree diff against Git HEAD also contains earlier work and is not a list of changes made solely for this fix.

## Deployment and remaining acceptance

Restart deployed backends to load the startup worker and new schedule; publish the updated mobile build for its wording. Schema fields are additive. The existing index initialization now includes the recovery uniqueness index and transaction lookup index; preflight historical duplicates before production index deployment. No production migration/index operation was performed here.

Retain the operational distinction between a paid order and its individual attempts. Legacy deleted orders without trusted purchase terms cannot be automatically fulfilled; missing wallet-assisted orders can require financial review. Batch size remains 20; high-volume deployments should monitor backlog and provider rate limits. Paid orders without any locally known pending attempt are not continuously rescanned for entirely unseen extra captures; that broader history-audit concern remains separate from this transition fix.

Remaining manual acceptance: installed Android wording/retry flow, app termination while a Sandbox attempt is pending, Cashfree dashboard event registration and delivery tracing, and production-scale reconciliation throughput. No real payments, production credential changes, commits or pushes were performed.
