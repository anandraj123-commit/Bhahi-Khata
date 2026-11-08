# Payments & Reconciliation dashboard

## Implementation

The existing payment operations section is now a responsive workspace using the Admin design system's colors, panels, typography, buttons, badges and Lucide icons. It has a compact header, conservative last-successful-refresh timestamp, read-only Refresh action, five summary cards, and keyboard-accessible tabs:

1. Payment Attempts — existing checkout-order table with latest provider attempt, all reconciliation fields and Verify with gateway actions.
2. Missing-order Recovery — existing latest-20 recovery records converted from a list into a readable table.
3. Payment Verification & Reconciliation — the existing `ResourceTable` for payments, including its original columns, search, status/date filters, sorting, pagination and row links. The global verified-net-revenue summary and reports link remain available here.
4. Verified Refunds — existing latest-20 provider refund records, preserving status, references, amount, verification timestamp and review flag.
5. Webhook Recovery Events — existing latest-20 event diagnostics, original status/error codes, retry counts and next retry timestamp.

Tab panels remain mounted while hidden, preserving filter and pagination state. Arrow keys and Home/End navigate tabs; focus and ARIA relationships identify each panel. The global payment page has all five tabs. Shop-specific payment sections retain their original authorized scope: attempts, verification and refunds only. They do not fetch global health, missing-order or webhook data. Global-only summary metrics explicitly show unavailable values in that context.

The previous payment history table is passed into the verification tab as a React slot, not reimplemented. Other Shop Details sections, the Shop Financial Overview button and cards, customer management, subscriptions and navigation remain intact.

## Summary definitions and integrity

- **Total Payment Attempts:** the actual `pagination.total` from the existing environment-scoped `/payments?page=1&limit=1` API; these are recorded payment transactions, not a fabricated count of Cashfree attempts that have not reached the database.
- **Pending Reconciliation:** current-environment PaymentOrder count whose persisted status is `created` or `pending`. The card explicitly describes this subset, not every possible worker task.
- **Missing Orders Requiring Review:** the existing health response's count of recovery records with a reconciliation diagnostic code.
- **Verified Refunds:** current-environment PaymentRefund count with an actual `verifiedAt` date. This means provider-checked records, **not necessarily successful refunds**; pending and failed provider outcomes remain visible and distinct.
- **Failed Webhook Events:** current-environment PaymentWebhookEvent count whose stored status is `failed`.

The latter new counts are backward-compatible additions to `/payment-health`; no existing response property was removed. All values are derived from read-only queries. Missing, failed or older-backend values show **Unavailable**, never an invented zero. No monetary summary is estimated from a limited page of records. INR records use existing INR currency formatting; records in another currency are not falsely relabeled INR.

## Loading, errors and actions

Initial loading uses skeletons. Background refresh retains available rows; a refresh error displays a compact inline alert and labels cached records as potentially stale. Empty states appear only for successful empty list responses. Summary failures are grouped, with technical detail available on demand. Selected views retain individual retry actions. Errors distinguish unavailable endpoints, access/session failures and connection failures; original error messages remain inspectable.

Header Refresh, per-view Refresh and Retry perform read queries only. Explicit Verify with gateway retains the existing POST, CSRF token, permission gate, backend recent-authentication requirement and idempotent verification service. The global refresh also invalidates existing payment history/revenue queries without changing their filters. No payment/refund/webhook processing logic was modified.

Attempts retain default page size 20 and Previous/Next, with an additional supported size 50 (the existing backend maximum). Latest-20 recovery/refund/event scopes remain unchanged. Tables scroll horizontally on small screens; numeric columns are right aligned, identifiers wrap safely and timestamps use UTC. Styles are scoped under the payment workspace and support the existing dark theme.

## API route investigation

The prior `Endpoint not found` cause was the frontend proxy's missing route allowlist entries, documented in `ADMIN-PAYMENT-ENDPOINT-FIX.md`. The current allowlist includes:

- GET `/admin/api/payment-orders` → `/api/v1/admin/payment-orders`
- GET `/admin/api/payment-health` → `/api/v1/admin/payment-health`
- GET `/admin/api/payment-recovery-snapshots` → `/api/v1/admin/payment-recovery-snapshots`
- GET `/admin/api/payment-refunds` → `/api/v1/admin/payment-refunds`
- GET `/admin/api/payment-recovery-events` → `/api/v1/admin/payment-recovery-events`
- GET `/admin/api/payments` → `/api/v1/admin/payments`
- POST `/admin/api/payment-orders/:id/reconcile` → the existing protected reconciliation action.

During this task the five monitoring GET paths were requested manually from the running localhost:3000 frontend without credentials. All returned **401 ADMIN_SESSION_REQUIRED**, not a proxy 404. This confirms forwarding to authentication, not authenticated database retrieval. No new routing mismatch was identified and no API failure is hidden by the redesign.

## Files changed for this redesign

- `website/src/components/admin/tables/payment-orders.tsx`
- `website/src/components/admin/tables/resource-table.tsx`
- `website/src/components/admin/tables/shop-detail.tsx`
- `website/src/app/admin/admin.css`
- `server/src/admin/services/readModels.js`
- `docs/PAYMENT-DASHBOARD-REDESIGN.md`

## Validation and remaining acceptance

Admin typecheck, production Webpack build (all 20 static pages), backend syntax checks and `git diff --check` passed. No automated tests were created or executed. No records, credentials or indexes were modified; no financial action was called. The local frontend is rebuilt and restarted to avoid stale production assets. The backend must load the updated read service before the three new health counts are available; older responses remain compatible and display Unavailable for missing fields.

Authenticated browser interactions, database counts, gateway reconciliation and visual acceptance across physical desktop/tablet/mobile browsers remain unverified. No browser-control tool or authenticated session was available. Runtime unauthenticated responses and successful builds do not constitute live payment acceptance. No backend worker was restarted to obtain financial data, no remote deployment was made, and no commit or push was performed.
