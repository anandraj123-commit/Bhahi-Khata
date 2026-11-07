# Subscription and payment implementation

## Architecture and checkout diagnosis

The existing Expo application keeps customer/ledger records and its durable sync queue in SQLCipher SQLite. SecureStore holds authentication, database encryption and subscription clock/binding data. Express authenticates the user and verifies shop ownership. MongoDB transactions and unique order/payment identifiers protect the financial ledger. Cashfree remains the sole external subscription gateway; wallet-only purchases use the existing transactional wallet path. The Next.js administrative panel uses its existing trusted proxy, session, CSRF, permissions and audit controls.

The previous checkout popup used the generic transaction-sync error formatter. Any unrecognized HTTP 409 became “Could not sync changes”. The previous scheduler explicitly rejected immediate Pro-to-Business purchases and allowed only a narrow future-renewal sequence. These were backend business-rule conflicts, not evidence of Cashfree or SQLite failure. The original popup cannot identify which request returned 409 without request diagnostics. A separate defect labeled verified payments as pending when refreshing or saving the device cache failed.

## Authoritative scheduling policy

`subscriptionTimeline.js` is a pure scheduler tested independently of the provider. Intervals are UTC, start inclusive and end exclusive. One effective interval is allowed. A higher tier interrupts the current lower tier; its consumed portion is recorded in `segments` and the remaining milliseconds are preserved. The active interval stays first for same/lower-tier purchases. Future intervals sort by tier descending, paused before unstarted at that tier, then purchase creation time and stable ID. Paused lower-tier time therefore resumes before newly queued lower-tier purchases. Existing queued intervals preserve their exact milliseconds when moved. A new purchase receives UTC calendar months, clamped at month ends, at its initially allocated start. This explicitly avoids losing days when a later purchase moves an existing commitment to a shorter month.

Every payment insertion takes a shop document write lock inside the existing transaction. Cashfree transactions, order finalization, timeline changes and audit events commit together. Existing unique payment and order links prevent duplicate entitlements. Full-wallet purchases now also carry the unique source-order link. Additional captures retain the existing review workflow rather than creating another subscription.

Authorization reads effective intervals directly, even after restart or while workers are delayed. The transition worker materializes active/expired/resumed statuses and audit events for reporting. The scheduler and mobile timeline do not depend on that worker. Worker errors are logged with shop context; payment reconciliation state is visible in the admin panel.

## Purchase preview and security

The backend previews scheduling, customer limit, duration, base price, discount, tax, total and expected dates. A ten-minute HMAC token binds shop, selected plan configuration, billing duration, wallet choice and the current entitlement timeline. Checkout checks it again within the shop transaction and stores the confirmed preview on the order. Changed state or prices require renewed review. Immediate dates are estimates until server verification; the relative scheduling policy and preserved-time guarantee are the purchase commitment.

Old clients without a preview cannot start a new checkout. Existing idempotent orders can still be recovered and verified. The SDK callback never activates access. Amount, currency, order identity, payment identity, ownership, signature and transaction checks remain server-side. Verification/status/order lookups and reconciliation are bound to APP_MODE as well as the separated environment databases.

An unresolved saved attempt is retained on network failure, timeout, 404 or invalid local data. An exact purchase retries the same idempotency key. A separately confirmed independent purchase uses a fresh key after explicit duplicate-charge acknowledgement when earlier attempts remain unresolved; all prior references are retained. Paid status remains successful if SQLite/SecureStore synchronization fails. A new purchase is not started while a verified prior purchase still needs local synchronization.

## Customer capacity and archives

Plan limits remain admin-configured. Purchased entitlements retain their immutable limit snapshots; Free uses current server configuration. `subscriptionArchived` is separate from disabled, removed and legacy tombstone state. Archive selection never changes balances, opening amounts or ledger rows. Selection is online, explicitly confirmed, version checked and idempotent. Suggestions use customer activity timestamps and require review. A shop document lock and capacity counter serialize selection, restoration and customer creation across devices.

When the operational count exceeds a lower-tier limit, new credit is blocked until selection is resolved. Existing records remain readable; existing outstanding payments may be collected. Archived collections cannot exceed the outstanding balance. New credit, financial edits/restorations that could introduce obligations, and advance refunds require operational access. Explicitly disabled/removed customers retain their existing stricter lifecycle rules. Restoring a subscription archive uses the same customer ID and existing history. The optional `entitlements.credit=false` permission disables new credit. Other existing entitlement metadata remains displayed; arbitrary new feature keys do not automatically implement new product features.

## Offline policy

`SUBSCRIPTION_OFFLINE_GRACE_HOURS` is a server-side setting: default 72 hours, validated range 1–720. The current response carries the full verified future timeline, plan limits/permissions, archived customer IDs, entitlement revision and verification timestamp. SQLCipher stores it; a SHA-256 digest of current entitlement plus plan configuration is bound in SecureStore, alongside the existing shop binding and monotonic clock anchor. A modified SQLite snapshot does not grant paid access.

Within grace, the app chooses the effective interval from that verified timeline, including scheduled transitions and paused resumption. Grace never extends an interval's expiry. At grace expiry the verified Free configuration applies. Missing/untrusted snapshots or unsafe clocks fail closed for new operational capacity/credit; existing safe reads and outstanding collections remain available. No hardcoded illustrative customer limit is used by the new mobile authorization path. Old unsigned caches require an online refresh.

The existing SQLite queue, stable operation identifiers, ordering, retries, conflict screens and at-most-once server ledger writes remain in use. Rejected capacity operations are retained for review and do not block unrelated collections. Reconnection refreshes entitlement before queue replay. The server checks current authoritative permission; a client-supplied backdated timestamp never resurrects expired premium access. Legitimate offline operations that are no longer authorized can therefore require review. This conservative rule avoids trusting a user-controlled clock. A rooted device cannot be made absolutely tamper-proof, and simultaneous offline devices can each tentatively use their cached capacity; server reconciliation rejects excess operations without deleting their local records.

## Schema compatibility, migration and rollback

Additive fields: `Shop.entitlementRevision`, `Customer.subscriptionArchived`, optional plan `tier`, subscription `paused` status, `remainingMilliseconds`, `pauseReason`, `segments`, and payment order `confirmedPreview`. Existing plan codes supply tier defaults. Existing customers without an archive field remain unarchived. Existing paid snapshots and source-payment links remain valid. SQLite JSON storage requires no destructive schema migration.

New indexes support archive lookup and global transition scans. Run the existing `indexes:<mode>` process during the appropriate deployment window; it does not require a main `.env`. The optional read-only preflight is:

```
node --env-file=.env.testing --import=./src/config/startupGuard.js src/scripts/checkSubscriptionCompatibility.js
```

Use the matching environment file when deploying. Review overlap/lifetime-entitlement findings before enabling new purchases. No automated repair deletes or shortens those entitlements. No production migration has been run during development.

Roll out backend and admin before the new mobile build. Keep backups and deployment manifests. After paused entitlements or customer archives exist, **do not roll back to the old scheduler/authorization code**: it does not understand those states. Safe rollback is to disable new checkout using existing environment controls and deploy a compatible fix while retaining date-based access, payment verification and collection support. Do not restore an old database snapshot over newly accepted financial writes. Additive fields/indexes may remain in place.

## Manual acceptance on a testing installation

1. Use `.env.testing`, an isolated testing database and Cashfree Sandbox configuration; never use Live credentials. Automated tests mock provider responses. The separate device acceptance run must explicitly exercise the real Sandbox SDK flow with Sandbox test instruments only.
2. Purchase a first Pro plan. Check preview, verified payment, one entitlement and payment/history references.
3. Renew the same tier with a different duration; confirm contiguous future dates and unchanged current expiry.
4. Upgrade to Business; check the paused Pro milliseconds. Renew Business, then buy Pro. Confirm Business → Business → paused Pro → new Pro ordering.
5. Advance synthetic test timestamps across each boundary and restart the API with the worker delayed; compare mobile/current API/admin results.
6. Exceed a lower plan's configured capacity in a synthetic shop. Review suggested/manual selection. Confirm no customer or ledger is deleted, archived credit is denied and outstanding collection works.
7. Repeat selection and financial requests and race two devices for the final slot. Confirm one application and reviewable rejection.
8. Disconnect an installed native build. Check search, ledger/history, cached timeline transitions, local capacity, pending collection and reconnection. Verify SQLCipher/SecureStore availability on device.
9. Simulate checkout termination, verification timeout, missed/duplicate webhook and local cache failure. Confirm saved references survive and successful payments remain successful.
10. Exercise admin reconciliation with SUPER_ADMIN and recent reauthentication; verify support/ordinary admin denial, CSRF protection and audit events. Never use a manual “mark paid” operation.

Native SDK UI, OS SecureStore faults, notifications and end-to-end multilingual presentation still require installed-device acceptance. The admin browser suite has been executed successfully; see SUBSCRIPTION-SYSTEM.md for exact results. Native-device and external Cashfree Sandbox acceptance have not been performed.

## Checkout operation trace and failure classification

The original `purchaseSubscription` catch in `App.tsx` displayed “Unable to complete payment” and passed its exception to `errorMessage`. `errorMessage` delegates to the generic localization/network formatter; `src/localization.ts` mapped HTTP 409 to “Could not sync changes”. The separate bookkeeping-sync alert still legitimately uses that wording. The checkout-specific formatter now preserves server business-rule messages.

The payment path is: connectivity check → server preview/confirmation → SecureStore read/parse of the saved attempt → backend lookup and Cashfree verification of any existing attempt → SecureStore persistence of a stable purchase idempotency key → authenticated checkout request → server price/preview/ownership/environment checks → transactional order/wallet reservation → Cashfree order preparation → SecureStore persistence of the order reference → native checkout → backend provider verification → transactional payment/entitlement scheduling → mobile entitlement/history refresh → SQLite cache write → SecureStore clock/integrity binding → saved-attempt cleanup. An error at one stage no longer establishes failure at another stage.

The previous Pro-to-Business rejection occurred before opening checkout. A provider verification timeout occurs after or while recovering checkout and leaves payment unresolved. A SecureStore read/write error can occur before launch and stops dependent work. A SQLite/cache/SecureStore failure after a paid backend response leaves payment successful and local synchronization incomplete. Without the historical response/logs, the original popup cannot establish which individual server rejection occurred.

Another corrected backend defect converted locally expired, unresolved orders into failed orders before checkout. Expiry now triggers authoritative provider inspection. Pending, unavailable or contradictory outcomes retain the order. Concurrent successful webhook results are reread before returning a terminal inspection result. Canonical Free < Pro < Business ordering is preserved even if admin numeric tier settings change between purchases.

## Acceptance fixes — 31 October 2026

A verified subscription snapshot's `archivedCustomerIds` takes precedence over the per-customer archive flag. The flag is only a legacy fallback when the authoritative list is absent. This matters when a server restoration is already verified but a pending synchronization queue prevents replacement of older local customer records. Both customer-capacity counting and credit authorization use the same helper.

Localization continues to use the existing dictionary/template system. `subscriptionTranslations.ts` supplements missing keys without replacing existing translations. Payment helper messages, paused/upcoming labels, server preview templates and preserved-time parameters have all-locale regression checks. The preview translates each line before composing its alert, retaining the backend's exact pricing, dates and confirmed token. Known status identifiers are translated only for display; persisted/backend statuses are unchanged. The generated localization report was removed during testing-infrastructure cleanup. Unknown admin-configured plan names, feature metadata and server business-rule text are not silently rewritten. Native-speaker and RTL/layout acceptance remain necessary.

## Payment retry follow-up

See [SUBSCRIPTION-PAYMENT-RETRY.md](SUBSCRIPTION-PAYMENT-RETRY.md). Failed payment attempts are now distinct from ACTIVE orders. An unresolved historical order no longer permanently locks checkout: an independent purchase requires duplicate-charge acknowledgement and retains earlier references and reservations. Additive server recovery snapshots support deleted-order reconciliation without trusting mobile purchase terms. Legacy deletions without trusted terms require review before entitlement fulfilment.
