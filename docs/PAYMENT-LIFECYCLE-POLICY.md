# Payment lifecycle and recovery policy

Updated: 8 November 2026. Implementation policy, not a production acceptance certificate.

## Verified purchases and unresolved debits

Cashfree-funded entitlement requires authenticated server-side order and payment verification, matching purchase references, amount and currency. Mobile callbacks are not payment evidence. An independently verified purchase is fulfilled once using transactional scheduling and unique source-payment/source-order constraints. A second capture against the same order is retained for review, not granted a second entitlement.

A bank debit, PENDING response, unavailable API, missing purchase terms, or webhook assertion is insufficient to activate entitlement. Preserve references and retry verification. An independent purchase requires the existing duplicate-charge warning; a later success for each independent order is fulfilled separately. Never refund automatically merely because another payment succeeded.

When a verified capture lacks its original entitlement or primary transaction, the system raises a recovery-review code instead of inventing terms or allocating replacement subscription time. Missing orders with trusted server purchase snapshots retain the existing recovery path. Missing wallet contributions require review: released wallet reservations cannot silently fund an entitlement.

## Cancellation

Cancelling the checkout UI does not cancel or refund a provider payment. Re-query the provider. USER_DROPPED/failed attempts permit retry while their order may remain ACTIVE. A completed purchase, including scheduled or paused time, remains intact until a separately authorized adjustment policy exists. There is no automated subscription cancellation/refund endpoint in this implementation.

## Full and partial refunds

The backend observes refunds through authenticated `GET /orders/{order_id}/refunds`. It validates genuine provider refund/payment IDs, order identity, currency and minor-unit amount. A unique environment/refund identifier prevents duplicate records. Successful refunds are not overwritten by stale unsuccessful responses; successful totals are reconciled transactionally and cannot exceed the verified capture. Original payment capture and refund state remain separate.

Source: [Cashfree Get All Refunds for an Order](https://www.cashfree.com/docs/api-reference/payments/latest/refunds/get-all-refunds-for-an-order).

Refund processing is **observation only**. The application does not submit refunds, retry refund submissions, credit wallets, or automatically revoke subscription time. Consequently, it cannot create a duplicate refund submission. Provider refunds initiated by an authorized merchant outside the application can be observed. Genuine refunds with a missing local capture are retained for explicit recovery review without inventing a capture.

Every observed refund requires entitlement review. Before implementing automatic adjustments, the merchant must approve treatment of consumed time, paused time, queued purchases, partial refunds, wallet contributions, tax/receipts, and multiple captures. Until then, automatic revocation is disabled. Refund submission and adjustment workflows are release-policy gaps, not implied approvals.

## Disputes and chargebacks

Signed dispute events routed to the webhook inbox remain review items; they do not mark payment failed, refund money, or revoke entitlement. This implementation does **not** provide authenticated dispute-API reconciliation or evidence submission. Authorized operators must verify disputes in Cashfree's merchant interface and follow the applicable response deadline. The application must not label an unverified dispute assertion as an API-verified outcome.

Automated chargeback accounting, dispute resolution and entitlement adjustments remain unsupported. A merchant-approved policy and provider contract acceptance are required before those actions are automated.

## Durable webhook handling and recovery

The authenticated payment/refund event's routing references are written with majority acknowledgement before processing. HTTP success means either completed durable processing or a durable recovery record; a failed inbox write is not acknowledged. Required processing re-fetches provider state. Retry errors preserve events, sanitized error codes and next-attempt timestamps. A missing order is a review case, not a silently ignored successful event.

Financial duplicate-key errors are not treated as completed webhook processing merely because a transaction exists. Only an already-processed event supports that shortcut. Duplicate failure audit events use an upsert. A delayed FAILED event whose authenticated provider response is SUCCESS follows verified fulfillment rather than downgrading the capture.

The worker runs at startup and every five minutes independently of the app, including when checkout is disabled. Order batches are bounded; unresolved orders have no permanent age exclusion. Normal unresolved polling is five minutes; completed/terminal history without pending attempts is revisited daily. Provider failures use bounded backoff and honor Retry-After. Per-process GET single-flight and concurrency limits reduce API load; these are not a distributed rate limiter.

Refund polling is separate, in bounded batches with an hourly eligibility window. There are no refund submissions. Lease tokens fence order-reconciliation completion metadata. Durable events and unique transactional fulfillment remain necessary when multiple workers overlap.

## Administration and monitoring

Existing authenticated, authorized Admin endpoints expose orders, raw attempt status, review reasons, inbox retries, missing-order recovery snapshots, refund records and backlog counts. Manual order reconciliation retains recent-authentication, permission and audit requirements and always asks Cashfree. No “mark paid” action is provided.

Monitor `payment-health`, worker failure logs and webhook backlog warnings. Operational targets: investigate webhook events older than one hour, missing-record review codes, wallet contribution review, refund capture review, and persistent provider failures. These thresholds provide visibility; delivery to an external paging/alert service is not configured by this change. Assign an on-call owner and test alert delivery before production acceptance.

Financial references and unresolved events are not automatically deleted. Database backups, access controls, retention periods and immutable external audit storage require deployment-level configuration; ordinary MongoDB documents are not WORM storage.

## Mobile persistence and compatibility

Pending SecureStore keys include a hash of the backend URL. Legacy keys are copied without deletion and never replace newer scoped values. Legacy references without environment metadata cannot be retrospectively authenticated by storage migration: server ownership/environment verification remains mandatory.

The journal uses an additive table in the existing encrypted SQLite database. It preserves references and checks a rotating batch of 20. An interrupted migration can retry its idempotent inserts; original SecureStore history remains available. Refresh never clears a newer checkout's pending key. A stale reference owned by another shop does not permanently block an independent purchase.

The additive table does not rewrite customer, ledger, balance or sync records. Native SQLCipher migration, reinstall/restore and concurrent checkout acceptance remain required. Production EAS/APP_MODE builds require an explicit HTTPS backend URL; local development export alone is not production environment acceptance.
