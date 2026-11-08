# Admin payment endpoint routing correction

## Root cause and evidence

`website/src/components/admin/tables/payment-orders.tsx` requested payment monitoring APIs through `adminRequest`, which prefixes paths with `/admin/api/`. The Next route at `website/src/app/admin/api/[...path]/route.ts` rejected these paths in its explicit allowlist. It allowed `payments` but omitted `payment-orders`, `payment-health`, `payment-recovery-snapshots`, `payment-recovery-events`, `payment-refunds`, and `payment-orders/:id/reconcile`.

Before the correction, a direct unauthenticated GET to the running local frontend's `/admin/api/payment-orders` returned HTTP 404 with `ADMIN_ROUTE_NOT_FOUND` and `Endpoint not found`. This matches the proxy's error, not Express's different `Administrative endpoint not found` message. The missing paths already existed in the backend. This was a proxy-registration omission, not evidence of a Cashfree failure or missing payment records.

## Complete request mapping

Browser origin in this workspace: `http://localhost:3000`. Configured `EXPRESS_ADMIN_API_URL`: `http://localhost:4000/api/v1/admin`. No environment values or credentials were changed.

| Browser path (relative to origin) | Method | Express path under `/api/v1/admin` | Existing implementation |
| --- | --- | --- | --- |
| `/admin/api/payment-orders?page=1&limit=20[&shopId=...]` | GET | `/payment-orders` | `readModels.paymentOrders` |
| `/admin/api/payment-health` | GET | `/payment-health` | `readModels.paymentHealth` |
| `/admin/api/payment-recovery-snapshots?page=1&limit=20` | GET | `/payment-recovery-snapshots` | `readModels.paymentRecoverySnapshots` |
| `/admin/api/payment-refunds?page=1&limit=20[&shopId=...]` | GET | `/payment-refunds` | `readModels.paymentRefunds` |
| `/admin/api/payment-recovery-events?page=1&limit=20` | GET | `/payment-recovery-events` | `readModels.paymentRecoveryEvents` |
| `/admin/api/payment-orders/:id/reconcile` | POST | `/payment-orders/:id/reconcile` | Existing `verifyPayment({shopId, orderId})` via `readRoutes` |
| `/admin/api/payments?...` (existing transaction history) | GET | `/payments` | `readModels.payments`; already allowed, unchanged |

`server/src/app.js` mounts `adminRouter` at `/api/v1/admin`. `server/src/admin/index.js` applies trusted-proxy checks, rate limits and authentication before mounting `readRoutes`. The read routes and service implementations are in `server/src/admin/routes/readRoutes.js` and `server/src/admin/services/readModels.js`. Routes defined after `export default router` are still registered during module evaluation; that placement did not cause the error.

## Security and schemas retained

- Proxy forwards the existing cookie, trusted-proxy secret, origin and CSRF header; it retains origin checks, no-store responses, JSON body limits and the 15-second upstream timeout.
- New allowlist additions are exact endpoint names. The action's ID remains 24 hex characters. These payment read endpoints accept GET; reconciliation accepts only POST at the proxy as well as Express.
- All reads require `payments:read`. Reconciliation additionally requires `payments:reconcile`, recent authentication, CSRF validation and action rate limiting. Its shop is derived from the environment-scoped stored order/recovery record, not a client-supplied shop ID.
- Existing Zod `filters` validates query shape, shop ID, pagination, date ranges and sorting. Lists return `{data: [...], pagination: {page, limit, total}}`; health returns `{data: {webhookBacklog, overdueWebhooks, orderErrors, refundErrors, missingOrderReviews, observedAt}}`. The action returns `{data: {status}}`.
- `paymentOrders` and `paymentRefunds` enforce the optional shop filter and current `APP_MODE`. Health and recovery lists are global administrative views; they are no longer requested unnecessarily in the shop-only component where they are not displayed.
- Queries read PaymentOrder, PaymentTransaction, PaymentOrderRecovery, PaymentRefund and PaymentWebhookEvent through the existing services. No new database connection, migration, index or payment processing service was introduced.

## UI changes

All existing order table columns, latest-20 sections, pagination, recovery refresh and authorized reconciliation controls remain. Added a read-only Refresh payment records action. Query loading, successful empty results and errors are mutually exclusive; an error no longer leaves an apparently empty successful table. Invalid list payloads produce an error instead of being treated as no records. The UI distinguishes 401, 403, 404, backend failures and network failures while retaining server diagnostic messages.

Refund rows use the stored provider status, verification timestamp and actual `entitlementReviewRequired` flag. They do not imply every refund succeeded or always requires review. Webhook diagnostic codes and retry fields are preserved. An explicit reconciliation click still uses the existing POST action and refreshes affected read views; opening or refreshing the page performs only GET requests.

No payment status, fulfillment, idempotency, webhook signature logic, refund execution or reconciliation algorithm changed. Existing Shop Financial Overview and other Admin components remain intact.

## Validation actually performed

- Admin `npm run typecheck`: passed.
- Admin `npm run build -- --webpack`: passed, including all 20 generated static pages.
- Backend `node --check`: passed for `readRoutes.js`, `readModels.js`, admin router, security middleware and `app.js`.
- `git diff --check`: passed.
- Stopped the local port-3000 frontend before building and restarted it from `website` using Node 22.23.4, preventing a stale production server from retaining the previous route allowlist. The backend and databases were not restarted.
- After restart, direct unauthenticated GET requests to all six read paths (five newly allowed monitoring APIs plus existing `/payments`) returned **401 `ADMIN_SESSION_REQUIRED`**, each with an Express request ID. This demonstrates that the running proxy now forwards to backend authentication rather than rejecting with its own 404.

These HTTP observations are manual read-only integration diagnostics, not an automated test suite. No test cases, fixtures or frameworks were created or run. No payment/refund/reconciliation POST was invoked, and no database records or indexes were modified.

## Remaining verification and deployment requirements

Actual records were **not retrieved**: there was no authenticated browser/session available, and authentication was not bypassed or fabricated. No disposable database or isolated records were created. The 401 results verify forwarding and authentication, not execution of the protected controllers, production database availability, successful table rendering, or gateway reconciliation. Those remain unverified until a permitted administrator loads the page. No claim of fully operational reconciliation is made.

For another deployment, rebuild and restart the website frontend so the updated proxy is used; keep its configured API base pointed at the backend that registers the listed routes. No backend implementation or environment change is required by this fix. Production records and credentials must remain unchanged. This session only restarted the local frontend, not a remote deployment.

Files changed for this task:

1. `website/src/app/admin/api/[...path]/route.ts`
2. `website/src/components/admin/tables/payment-orders.tsx`
3. `docs/ADMIN-PAYMENT-ENDPOINT-FIX.md`

Pre-existing worktree changes from Shop Financial Overview were preserved. No commit or push was performed.
