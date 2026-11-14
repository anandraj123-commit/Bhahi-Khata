# Notification management implementation

9 November 2026. Implementation and static validation, not production/device acceptance.

## Audit and preservation

Read `NOTIFICATION-SYSTEM-AUDIT.md` for the source audit completed before implementation. Existing reminders create `Notification` inbox records; subscription reminders have independent logs/schedules. These paths remain. The Home bell and recent activity list remain, with administrative messages added to the same inbox. Existing payment, subscription, ledger and financial synchronization processing is unchanged. The shared push provider only gained an optional timeout signal; existing callers retain their behavior. Admin sidebar additions preserve all existing entries and the Payments group.

## Admin interface

`/admin/notifications` adds list, add, view, edit and confirmation-based soft delete. View/edit use existing Admin dialogs. ADMIN and SUPER_ADMIN have `notifications:read` and `notifications:manage`; SUPPORT remains unchanged. Existing session, trusted proxy, CSRF, authorization and Admin rate limits apply. No new shop-scoped Admin role is assumed.

The list uses server pagination (20/50/100), stable timestamp/title plus ID sorting, search over title/plain preview/exact ID, recipient type, active state, publication state, target shop ID, creator ID and date ranges for Display On/Created At/Updated At. Filter chips, reset, refresh and loading/error/empty states are included. Recipient selection searches eligible shop name, owner, phone or exact shop ID server-side, 20 per page, with selected chips and a 500-shop cap. All recipients are resolved by the worker; no full audience is downloaded to the browser. For all-shop notifications the count is explicitly unresolved until publication completes.

Tiptap 3.33.1 now supplies both rich description fields through a client-only custom toolbar. Only MIT packages/free extensions are used; there is no editor license key, Cloud or Pro dependency. CKEditor packages/configuration have been removed. Existing HTML and normalized documents remain compatible within the supported schema; unsupported formatting blocks saving rather than disappearing. Both fields retain their original content limits. See `NOTIFICATION-TIPTAP-MIGRATION.md` for the image picker, gallery/URL security, new alignment attributes, license notices and validation.

Display On (IST) is a datetime-local input interpreted explicitly in Asia/Kolkata, independent of browser timezone. Defaults use current IST; writes convert once to UTC; edits preserve the original UTC timestamp when unchanged. All notification Admin timestamps display IST. New/changed schedules older than server time minus five minutes are rejected; unchanged historical schedules remain editable. Publication uses authoritative server time, separate from active state and push delivery. A campaign becomes eligible at displayOn, never earlier; actual availability includes worker latency. Creation keys preserve retry idempotency.

Revision checks and MongoDB transactions protect edits and audit writes. Before first publication, content/recipients/schedule can change. After first publication recipients/schedule are frozen; content and active visibility may change without another send. A worker-held publication lease temporarily prevents editing. Soft deletion sets status=false and deletedAt, retains all records/history, and cannot be undone through edit. In-flight provider requests cannot be recalled.

## Models and APIs

- `AdminNotification` maps to `adminnotifications`: environment, normalized content, recipient configuration, scheduling/active state, revision/creator/timestamps, publication cursor/lease/retry/count evidence.
- Existing `Notification` maps to `notifications`: unchanged legacy fields plus campaign/environment/recipient-user relationship, readAt and push claim/attempt/ticket/error fields.
- Existing `Shop`, `User`, `Device` and `AdminAudit` are reused. Eligible recipients require the Shop owner and active User to reference each other.
- Recipient ID is a deterministic hash of campaign and shop, protected by MongoDB's existing unique `_id`. The upsert also matches campaign/shop. No replacement orders, payment records or ledger records are involved.

Admin prefix `/api/v1/admin` (same-origin frontend proxy `/admin/api`):

| Method/path | Purpose |
| --- | --- |
| GET/POST `/notifications` | List/create |
| GET `/notifications/recipients` | Eligible paginated shop search |
| GET/PATCH `/notifications/:id` | View/update |
| POST `/notifications/:id/soft-delete` | Revision-checked soft deletion |

Existing mobile API prefix `/api/v1`:

| Method/path | Purpose |
| --- | --- |
| GET `/notifications` | Eligible paged inbox, total, unread, server time |
| GET `/notifications/:id` | Owner-authorized detail |
| PATCH `/notifications/read` | Idempotent monotonic acknowledgement; legacy empty-ID mark-all semantics retained |
| POST `/notifications/reconcile` | Up to 100 known IDs; refreshed content and hidden IDs |

Legacy GET defaults to 100, while the new app explicitly requests 20. Mobile queries require authenticated shop ownership and, for announcements, the original recipient user. Active, published, due, current-environment campaigns only are visible. Read acknowledgements never alter campaign visibility. List endpoints do not publish or send pushes.

## Scheduling and deployment

A scheduler in the existing backend process runs at startup and every minute only when `ADMIN_NOTIFICATION_WORKER_ENABLED=true`. It processes up to ten batches of 50 shops per tick. An optional dedicated worker entrypoint is prepared as an alternative to this in-API scheduler; do not enable both inadvertently. Atomic two-minute leases and transactional recipient/cursor updates permit restart and multiple-instance recovery. Expired claims can be reclaimed. Errors record retry evidence with capped exponential delay (2–60 minutes); they do not mark publication complete. Shops created after the first-batch audience cutoff are excluded. Legacy shops without creation timestamps are also excluded; investigate those records rather than fabricate timestamps.

Inbox publication is independent of mobile/browser activity. Incomplete batches can already be visible after their transaction commits; `completedAt` identifies completion. Eligibility is evaluated during each batch; disabled/removed owners are not delivered to. Cursor progress is never an assertion that every initially selected user was eligible.

**Deployment prerequisites, not executed here:**

1. MongoDB replica-set transactions and an explicitly provisioned `adminnotifications` collection before enabling Admin writes/publication. Existing notifications/AdminAudit collections must exist. `autoCreate` and `autoIndex` are disabled on the new model; it is not added to startup index creation.
2. Review query indexes through the existing deployment process. Declared campaign indexes: `(appMode,status,state,displayOn)` and `(appMode,createdAt,_id)`. Consider `(campaignId,pushState)` for inbox delivery statistics and `(campaignMode,pushState,pushNextAt,createdAt,_id)` for dispatch. Existing `(shopId,createdAt,_id)` and `_id` indexes remain. No indexes were created or rebuilt during implementation.
3. Enable the scheduler explicitly only in the intended environment; existing APP_MODE validation/environment database isolation remains unchanged.
4. Enable `ADMIN_NOTIFICATION_PUSH_ENABLED=true` only with working Expo credentials/project/native configuration. Messages published while push is disabled are marked skipped and are not retroactively pushed.
5. Deploy the native app with existing SQLCipher support. The local migration advances schema 6 to 7 additively; rollback to a schema-6-only app will reject the newer database. Do not delete cached financial data to downgrade.

## Push semantics

The inbox is authoritative. Dispatch is bounded to 20 recipient records per tick, up to 100 registered device tokens per shop, using existing Expo sendPush. The payload is generic, containing only navigation references, with no announcement text or account PII. Invalid registered tokens may be removed through the existing Device model. Push taps fetch owner-authorized details; cold starts do not depend on a subscription snapshot being loaded. Offline taps can open the cached inbox when the cached shop identity matches.

Claims are durable before provider calls. Requests time out after 15 seconds. Provider tickets are counted as accepted/rejected, **not confirmed device delivery**. Complete explicit MessageRateExceeded rejection permits at most three sends with 5/10-minute delays. Partial acceptance is not retried wholesale. Crashed/ambiguous sends become `unknown` after five minutes and are not automatically resent. Receipt polling now persists accepted ticket IDs and protected token-registration snapshots, checks after 15 minutes, and marks unavailable receipts unknown after 24 hours. It never resends ambiguous pushes. No manual resend or physical-delivery guarantee is claimed. Detail view shows stored ticket/read/unread evidence and publication retry state; the list's state filter describes inbox publication, not a fabricated device-delivery lifecycle.

## Mobile and offline behavior

The Home bell shows combined server-inbox unread count; local recent activity remains separate. The existing notification screen supports refresh/incremental loading, read styling and a formatted detail modal. Native foreground notifications, reconnect and app resume trigger refresh. Existing push token registration remains and now listens for token changes.

`local_notifications` is added to the existing encrypted SQLite database, keyed by account and notification ID. It retains content, visible state, local read state and a durable pending-read flag. It does not place notification commands into the financially ordered ledger queue. Logout cleanup includes this account's notification cache. UI and asynchronous response guards prevent another account's content appearing on switch.

Offline: previously synchronized content/read counts remain usable, cached details open, and reads commit locally before acknowledgement. Online: pending reads upload in bounded batches of 100, new pages are cached, known visible IDs reconcile in keyset batches of 100, inactive/deleted content is hidden without deleting local evidence. Read state uses monotonic merge, so stale responses cannot make it unread. Unsent acknowledgements survive restart and retry on subsequent refresh/reconnect/resume. Unread counts while offline describe only locally cached messages.

Memory is bounded to 1,000 inbox entries in a sliding window; older cached pages remain accessible with Load More. Refresh returns to the latest window. Local cache pagination and remote pagination remain distinct from the preserved recent-activity paging. Expo Go/web without encrypted native storage can browse online but cannot promise durable offline inbox/read acknowledgements. No plaintext fallback is introduced. A device without connectivity cannot receive new content that it never downloaded. Previously cached content may remain visible until successful reconciliation.

## Validation and limitations

Passed: mobile `npm run typecheck`; Admin `npm --prefix website run typecheck`; Admin production `npm --prefix website run build -- --webpack`; Android `npm run export:android`; syntax checks on all 12 changed/new backend JavaScript files; `git diff --check`. Admin build lists the new route and existing routes. Next.js frontend was stopped for the build and restored; backend processes/workers were not started or restarted.

No automated cases, fixtures or suites were created/run. No database connections, production writes, index changes, real pushes, payment actions, commits or pushes were performed for validation. Authenticated browser interaction, actual MongoDB transactions, scheduler failover, physical-device push/background behavior, multi-device reads and native SQLCipher migration remain unverified. These require controlled acceptance before production enablement.

Dependency installation reported eight moderate advisories. A subsequent offline npm audit returned no entries, which is not fresh registry evidence and does not resolve that warning. Review current advisories before deployment; no unrelated forced dependency upgrades were made.

Native announcements currently use English interface labels; administrator-authored rich content can contain supported Unicode. No guarantee of localized UI copy is made. Very large audiences and substring searches require deployment-level query/index and throughput review. Rich content is stored in existing notification cache records and may consume storage; no destructive retention policy has been introduced. Unknown push outcomes require investigation rather than blind resend. Production readiness is not established by the successful builds.

## Changed-file inventory

### Backend

- `server/src/admin/config/index.js`
- `server/src/admin/index.js`
- `server/src/admin/routes/notificationsRoutes.js`
- `server/src/controllers/notificationsController.js`
- `server/src/index.js`
- `server/src/models.js`
- `server/src/notifications/content.js`
- `server/src/notifications/models.js`
- `server/src/notifications/publication.js`
- `server/src/providers.js`
- `server/src/routes/notificationsRoutes.js`
- `server/src/services/notificationsService.js`
### Mobile

- `App.tsx`
- `src/NotificationContent.tsx`
- `src/api.ts`
- `src/notificationTypes.ts`
- `src/offlineStore.ts`
- `src/useNotificationInbox.ts`
### Admin

- `website/package-lock.json`
- `website/package.json`
- `website/src/app/admin/(console)/notifications/page.tsx`
- `website/src/app/admin/admin.css`
- `website/src/app/admin/api/[...path]/route.ts`
- `website/src/components/admin/layout/shell.tsx`
- `website/src/components/admin/notifications/management.tsx`
- `website/src/components/admin/notifications/rich-editor.tsx`
### Documentation

- `docs/NOTIFICATION-MANAGEMENT-IMPLEMENTATION.md`
- `docs/NOTIFICATION-SYSTEM-AUDIT.md`

## Final-readiness follow-up — 10 November 2026

See `NOTIFICATION-FINAL-READINESS-AUDIT.md` for the current findings, exact provisioning commands, deployment/rollback instructions, dependency advisory review and runtime evidence. Follow-up fixes add Expo configured-project fallback, foreground handler initialization, bounded read-queue draining with active-app refresh, offline-session checks, expired-lease editing, batch owner lookup, conservative shared-token exclusion and independent push dispatch after publication errors. The latest completion pass supersedes that presentation with explicit IST input and display.

New operational files: `server/src/notifications/provision.mjs` (read-only check / explicit additive apply), `server/src/notifications/worker.mjs` (optional dedicated notification-only process), `server/deploy/notifications.service.example`, `server/deploy/notifications.env.example`. No provisioning or activation has occurred. Dedicated hosting is an alternative to the in-API scheduler, with separate environment files and only one deployment arrangement enabled. app.config.js accepts an optional GOOGLE_SERVICES_JSON file path; no credentials were added. `src/notificationRuntime.ts` resolves the configured Expo project ID.

The fresh registry audit confirms the eight moderate development-tooling findings; the previous offline audit did not resolve them. No safe compatible fix was identified. Production acceptance remains incomplete.

Follow-up validation passed mobile/Admin typechecks, Admin production build, Android export, 15 syntax checks and whitespace checks. A read-only unauthenticated local request confirmed the protected notification route redirects to login; authenticated rendering and CRUD remain unverified. The eight moderate development-tooling dependency advisories remain unresolved. See the readiness audit for exact evidence and current deployment status.

Final review also corrects unread-badge adjustment for queued reads already acknowledged by another device: only server-visible, unread pending IDs reduce the fetched count. The existing authorized reconciliation endpoint is reused. This remains eventual synchronization, not a real-time multi-device consistency promise.


## Final completion update (12 November 2026)

See `NOTIFICATION-FINAL-COMPLETION-REPORT.md` for current files, validation outcomes and release blockers. Private images use the explicitly provisioned `notificationmedia` collection, decoded/re-encoded WebP with maximum 2 MiB and 4096×4096 source dimensions; no temporary production disk or public media URLs. The Admin proxy accepts authorized binary uploads; mobile retrieves images only through owner/due/active campaign checks. Mobile media stays in mounted component memory and is unavailable offline; cached formatted text remains accessible. Tables use stacked readable native cells. No image cache migration touches financial data.

New subscription notifications are bridged into the existing inbox using a deterministic shop/deduplication-key identity, independently of push success. Historical push logs and OS-only scheduled local reminders lack a common read identity and are not backfilled or guessed. Consequently, counting every historical/local-only notification category is still incomplete. The bell accurately aggregates eligible persisted inbox records and uses locally cached counts offline.

Admin list adds recipient push-state filtering and grouped evidence; details add receipt outcomes. Publication and push states remain distinct. Provider handoff is not a claim of physical delivery. The latest provisioning utility adds private media metadata and a receipt-due index, without dropping existing indexes or running automatically.


## Latest follow-up

See the follow-up completion review in `NOTIFICATION-FINAL-COMPLETION-REPORT.md`. Expiry inbox generation now runs in the existing opt-in publisher independently of push, with bounded same-day recovery. Shared-token protection and guarded invalid-token cleanup extend to subscription and balance-reminder pushes. Subscription ambiguous delivery is not blindly retried. No historical unread backfill or local/remote unified identity is claimed. Current static checks passed; dependency counts are mobile 11, Admin 8 moderate, backend 0. Production activation and device acceptance remain unverified; no tests or production operations performed.

## Query-driven inbox correction — 13 November 2026

Inbox availability no longer requires publication workers or `publishedAt`. Active,
due campaigns are queried with recipient authorization; read receipts are created
idempotently on opening. Past schedules are accepted. See
[delivery correction](NOTIFICATION-DELIVERY-FIX.md) for identities, counts, future
subscription reminder registration, mobile cache compatibility, validation and
remaining runtime acceptance. Earlier worker-required inbox statements are superseded.
