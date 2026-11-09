# Webhook Events empty-page investigation

9 November 2026. Audit before correction. Existing working-tree changes from Payments navigation are retained.

## Observed evidence
Read-only inspection of the configured development database, with autoCreate/autoIndex disabled and bounded queries, found exactly five documents in `paymentwebhookevents`. All five have no `appMode`, no `orderId`, and no matching order; their stored status is `processed` and type is `PAYMENT_SUCCESS_WEBHOOK`. No document IDs, payloads or secrets were printed. The original `paymentMonitoring('webhooks', defaultFilters)` returned total0 and data[]. This reproduces the empty data result against real existing records.

The defect is legacy compatibility: `PaymentWebhookEvent.appMode` is optional, while the new Admin query required exact appMode. Current ingestion supplies it only on insertion; historical records were not backfilled. The UI also had only a generic empty-results message, obscuring the difference between no records and filtered records. This is not a wrong collection name, a page/API-kind mismatch or proof of failed webhook processing.

## Trace and security
Page `/admin/webhook-events` -> PaymentMonitoring kind `webhooks` -> `/admin/api/payment-monitoring/webhooks` -> allowlisted Next proxy -> `/api/v1/admin/payment-monitoring/:kind` -> monitoringKind/monitoringFilters -> paymentMonitoring -> PaymentWebhookEvent aggregate. The literal `webhook-events` is a page slug, not the backend kind.

Actual model.collection.name confirmed at runtime: `paymentwebhookevents`. Schema includes eventId(unique), eventType, optional appMode/orderId/paymentId/refundId, attempts, nextAttemptAt, lastErrorCode, processedAt, received/processed/failed status and timestamps. No alternate collection name is configured.

Page requires payments:read; Express trusted proxy, active session, permission and rate-limit middleware protect the API. The proxy points to localhost4000/api/v1/admin. Local backend PID5879 was observed running the development environment from this repository, started07:12:46; readRoutes source modification time02:39:46 predates startup. A real request through trusted proxy headers without an Admin cookie returned401 ADMIN_SESSION_REQUIRED. This confirms reachability and authentication, but does not alone prove the protected handler was reached. No authenticated session/browser tool was available. No backend or worker was started/restarted.

Default filters are page1/limit20, newest createdAt, no shop/status/date restriction. Shop filtering requires a resolved parent shop; these five unlinked legacy records correctly cannot satisfy a shop filter. Date filters use UTC inclusive days, sorting uses _id as a stable tie-break. Response data[]/pagination matches the frontend contract.

## Safe correction policy
Legacy documents without appMode may be listed only when BOTH configured MONGODB_DB_NAME and actual model connection name equal the expected dedicated `digital_khata_<APP_MODE>` database for an allowlisted mode. Explicit other-environment records remain excluded. This uses the existing enforced database isolation boundary; it does NOT claim a legacy event's provider environment or payment identity is known. UI labels that provenance explicitly. In an unrecognized/shared database, legacy rows remain excluded. No inference from event hashes or fabricated payment IDs, no data backfill and no ingestion/worker changes.

The corrected response adds same-scope totals to distinguish no records, filters excluding records and out-of-range pagination. Legacy event environment remains unavailable and is not substituted with the current APP_MODE. A stored processed status is displayed as stored evidence, not proof of payment/subscription fulfillment.

Validation and final outcomes are recorded after implementation below.

## Correction and measured result
Changed server/src/admin/services/paymentMonitoring.js to include missing-appMode webhook rows only under the dedicated-database guard described above. Explicit environment filters remain. Added scoped totals/legacy count before user filters, keeping filtered totals and paging separate. Database-query failures return safe ADMIN_PAYMENT_QUERY_FAILED, never an empty success.

Changed website/src/components/admin/tables/payment-monitoring.tsx to show legacy provenance, validate row/pagination response structure, distinguish scope-empty/filter-empty/page-empty, provide first-page/reset actions, and explain unlinked events under shop filters. A response missing scope metadata warns that the running backend needs the updated handler rather than claiming no records exist. Changed payment-orders.tsx's shared PaymentNotice error labeling for database query failures and incompatible responses.

Executed the corrected service directly against the same existing development database using a read-only connection: total5, returned5, scope.total5, scope.legacy5, legacyIncludedFromIsolatedDatabase=true. Zero rows received an invented appMode, and zero order links were invented. No database/model/index writes were performed. These are manual diagnostic reads of actual data, not automated test cases.

## Validation and runtime limits
- Admin typecheck (Next typegen + TypeScript): PASS.
- Backend syntax checks: paymentMonitoring service, monitoring validator and readRoutes: PASS.
- Admin production build (webpack): PASS; final frontend-only diagnostic-message adjustment revalidated before delivery.
- git diff --check: PASS.
- No automated tests created/run; no processing services or model schemas edited.
- Source registration and local backend authentication confirmed. Authenticated handler/browser interaction remains unverified; the401 response cannot establish handler execution.
- The existing backend is a non-watch process and has not been restarted. It must be reloaded through the normal controlled process to serve this correction. Starting/restarting it automatically launches reconciliation, which may modify existing records; that was deliberately not done under this task's no-record-modification constraint. No duplicate workers started.
- Only the identified frontend was stopped/rebuilt/restored to avoid mixed build assets. The unrelated port3000 process was left untouched.
- Existing records without event environment or payment references remain incomplete. Their event/provider identity cannot be recovered from this read-only UI change. They are displayed honestly, not repaired or reprocessed.

Status: root cause reproduced and query correction verified against existing records; complete live-page resolution awaits controlled backend reload and authenticated browser confirmation. No production-readiness claim.
