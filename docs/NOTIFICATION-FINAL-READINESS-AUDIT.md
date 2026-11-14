# Notification final readiness audit

**Current editor update:** CKEditor has been replaced with MIT-only Tiptap at the owner’s request. CKEditor licensing/configuration statements below are historical and no longer block editing. See [Tiptap migration](NOTIFICATION-TIPTAP-MIGRATION.md) for current image selection, compatibility, files and validation. Other deployment limitations remain.

10 November 2026. Source audit before follow-up changes; final validation evidence appended below. Existing uncommitted notification implementation retained. No automated cases or suites.

## Confirmed implementation

Admin route, same-origin proxy and Express registrations are connected. ADMIN/SUPER_ADMIN permissions, CSRF, revision checks, transactional audit, deterministic creation IDs, sanitized structured rich content, server pagination and soft deletion exist. `AdminNotification` maps to `adminnotifications`; recipient inbox `Notification` maps to `notifications`; existing `shops`, `users`, `devices` and `adminaudits` participate. Recipient ownership is checked on mobile API requests. Scheduled claims, two-minute leases, deterministic recipient IDs and transactional cursor progress exist. Expo tickets are distinguished from delivery; uncertain dispatch is not blindly resent. SQLite schema 7 adds an encrypted account-scoped inbox and durable read flags without replacing the ledger queue. Subscription/reminder workers are separate and retained.

## Confirmed defects and missing operational work

- Push registration ignores the configured Expo project ID unless EXPO_PUBLIC_EAS_PROJECT_ID is independently set. Foreground handling is initialized through subscription scheduling rather than notification registration.
- Only 100 pending reads upload per refresh. Reads during an already-running refresh can remain queued until another lifecycle event. Refresh error handling can clear online-only messages when native storage is unavailable.
- Notification cache access relies on mounted signed-in state; it does not itself recheck the existing bounded offline session on resume. A long-running mounted app needs the same offline-session gate.
- Dead publication leases block Admin edits even after expiry while the worker is disabled. Lease expiry should allow an edit to atomically invalidate the stale claim.
- Publication performs one owner query per shop; batch owner lookup is sufficient. Publication failure prevents push dispatch for that entire tick.
- Database provisioning and metadata inspection commands are missing; starting index.js is unsafe for inspection because it performs unrelated migrations and starts workers.
- Shared tokens can be stored under multiple shops. New announcement dispatch must avoid targeting a token still mapped to another account, without rewriting unrelated existing notification workflows.
- Current Docker Compose references obsolete server/.env and wrong database naming, while Dockerfile requires an environment-specific file it does not copy. Do not use it as evidence of a deployable notification host. Prepare an independent opt-in worker deployment template; do not alter existing payment deployment behavior.
- Current registry audit confirms eight moderate advisories rooted in minimatch via development-only ESLint/TypeScript tooling. Detailed review follows below; no force downgrade is appropriate.

## Runtime/configuration boundaries

No physical Android device or authenticated browser session has been provided. Database collection/index existence is unknown until a read-only inspection of an approved environment succeeds. Production provisioning, publication activation and real pushes require approval. Existing environment validation must remain. Neither a successful build nor the availability of a cron function establishes a reliable hosting environment.

## Follow-up fixes completed

- Native registration now falls back to `Constants.easConfig.projectId` / configured `extra.eas.projectId`, retaining an explicit public override. Foreground handling is installed during registration with the same behavior as subscription notifications. Android channel creation precedes permission/token access; the expo-notifications library manifest declares POST_NOTIFICATIONS.
- Optional `GOOGLE_SERVICES_JSON` build-file configuration is supported by app.config.js. No credential file is supplied or changed.
- Inbox checks the existing SecureStore-backed offline session before exposing cache on refresh. Expired/unreadable sessions clear private cached UI and close an open detail; online authenticated responses can still display. No plaintext fallback or financial queue change.
- Read acknowledgements drain up to ten batches of 100 per refresh. Active-app refresh every minute handles additional commands and reads queued during an in-flight request. Repeated taps are deduplicated in memory; durable SQLite reads remain monotonic. Online-only records are no longer cleared on refresh failure by an empty SQLite fallback.
- Admin edits can invalidate an expired worker claim transactionally; live claims still block edits. Soft deletion remains terminal, status=false, with retained inbox/read/audit history.
- Publication resolves owners in one bounded query per 50-shop batch. Push dispatch runs independently even if publication fails that tick. Explicit boolean flag validation and startup/tick/error log codes were added.
- Announcement push validates current shop ownership and conservatively excludes tokens stored for another shop. Such records are skipped with DEVICE_OWNERSHIP_UNRESOLVED rather than guessing. Existing reminder/subscription dispatch remains unchanged; shared-token cleanup needs an approved account/device policy and is not performed here.
- Added non-destructive provisioning/inspection utility and an optional dedicated notification-only worker. Neither was executed. Existing API-hosted scheduler remains supported.
- Admin edit form now accepts/displays IST explicitly and retains UTC storage; unchanged timestamps are preserved.

## Database procedure (prepared, not executed)

Actual model mappings: AdminNotification → adminnotifications; Notification → notifications; Shop → shops; User → users; Device → devices; AdminAudit → adminaudits. Campaign IDs and deterministic recipient `_id`s use MongoDB's existing unique `_id` index. No additional unique constraint is silently applied to legacy records.

Run from `server/` with Node 22. The selected environment file must pass the existing guard; do not use index.js for notification-only inspection.

Read-only development metadata inspection:

```sh
node --env-file=.env.development --import=./src/config/startupGuard.js src/notifications/provision.mjs --check
```

Exit 0: prerequisites/index definitions present. Exit 2: metadata read succeeded but requirements are missing. Exit 1: configuration, connection, topology or index conflict failure. The command does not read notification content, import application models, create indexes, publish notifications or start workers. Connection autoCreate/autoIndex are false. The configured development database is remote; explicit permission for this inspection was requested and was not received during this execution. No database connection was attempted.

After approval, provision development:

```sh
node --env-file=.env.development --import=./src/config/startupGuard.js src/notifications/provision.mjs --apply --confirm-db digital_khata_development
```

Production metadata/provisioning commands, **not authorized or executed**:

```sh
node --env-file=.env.production --import=./src/config/startupGuard.js src/notifications/provision.mjs --check
node --env-file=.env.production --import=./src/config/startupGuard.js src/notifications/provision.mjs --apply --confirm-db digital_khata_production
```

Apply requires transaction-capable topology and existing notifications/shops/users/devices/adminaudits collections. It creates only missing adminnotifications/notificationmedia collections and missing compatible query indexes. Existing equivalent full indexes are reused regardless of name. Name/options conflicts stop for review. It never drops an index, changes documents, resets history, or installs a unique constraint over legacy data. Application migrations/index startup paths are not invoked.

Query indexes prepared: private media environment/creation; receipt due ordering; campaign due/listing; shop inbox ordering; campaign delivery evidence; mode/push-state/retry dispatch; token/shop lookup for device ownership checks. Use the script's source as the exact key specification. Collection/index existence and actual notification counts remain NOT VERIFIED.

## Scheduler deployment and activation

The current repository Docker Compose is not a verified deployment: obsolete `.env`/database naming conflicts with current environment guards, and the Dockerfile does not provision the required environment file. No unrelated payment deployment configuration was rewritten.

Choose exactly one deployment arrangement after approval:

1. Existing always-on API service: set ADMIN_NOTIFICATION_WORKER_ENABLED=true in its selected environment file. Keep push false until separately approved. Restart only through the normal deployment process; confirm no other notification worker is enabled.
2. Separate always-on service: use `server/deploy/notifications.service.example`, adapting Node executable/user/paths. Deploy the same source to a **separate directory and environment file**. API notification flag remains false; dedicated worker flag is true. The dedicated entrypoint opens MongoDB but never starts HTTP, payment/reconciliation workers, subscription workers, reminder workers, compatibility migrations or index creation. Do not run both arrangements inadvertently.

Use `server/deploy/notifications.env.example` as a merge template, not as a second env file. Existing environment-file validation disallows that. Persistent hosting with network access, restart supervision and clock synchronization is required. An idle/suspended/serverless HTTP deployment is not sufficient. The worker runs immediately and each minute, with bounded transactional batches and recoverable leases. Graceful dedicated shutdown waits for a tick for up to 30 seconds; killed claims recover through the existing lease/unknown-send policy.

Monitoring: alert on ADMIN_NOTIFICATION_WORKER_FAILED, ADMIN_NOTIFICATION_PUSH_FAILED, NOTIFICATION_WORKER_START_FAILED; observe ADMIN_NOTIFICATION_WORKER_STARTED and ADMIN_NOTIFICATION_TICK_COMPLETE. Missing tick logs for multiple intervals require investigation; completion logs alone do not prove successful delivery. Admin detail exposes publication attempts, next retry, errors, read counts and push ticket states. Review growing failed/unknown/skipped counts. There is no automatic unknown-push resend; do not reset claims blindly. Back up data before approved provisioning. Disable both flags to halt new work, retain existing data/indexes and investigate failures; do not roll back to a backend lacking campaign visibility checks while campaign inbox records exist. Preserve schema-7-aware mobile readers on rollback; never delete financial caches to downgrade.

## Push readiness and runtime evidence

Non-secret environment inspection: development/testing/production files exist; all configured MongoDB hosts are non-local; notification worker/push flags are absent (disabled); Expo access token is absent. APP_MODE/environment isolation is unchanged. Expo project ID exists in app.config.js. No Firebase service file was found in the repository. Remote EAS/FCM credentials have not been inspected. Expo access token is required only if enhanced push security is enabled; lack of a token alone does not establish invalid Expo credentials.

Provide GOOGLE_SERVICES_JSON through the EAS file-secret/build environment if required; configure the matching FCM v1 credentials through the approved EAS process. Never put an Expo server access token in EXPO_PUBLIC variables. A new native build must contain the notification plugin, merged permission/channel configuration and SQLCipher support. Android export cannot establish these native-device properties. Keep ADMIN_NOTIFICATION_PUSH_ENABLED=false until explicitly approved. Cached content remains the inbox source of truth; device delivery is not claimed from Expo ticket acceptance.

No authenticated browser session or physical Android device was available. No browser automation was added. No remote database connection, worker startup, real push, financial operation or production data/index mutation occurred. Only the existing frontend process was temporarily stopped for its build and restored. The unrelated frontend on the same numeric port was untouched.

## Dependency advisory review

Fresh `npm --prefix website audit --json` returned eight moderate findings, zero high/critical. Root advisory: [minimatch globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249), vulnerable range >=7.0.0 <11.0.1. This is a denial-of-service risk from attacker-controlled glob patterns in development tooling.

Affected packages: direct devDependency eslint-config-next; transitive typescript-eslint, @typescript-eslint/eslint-plugin, @typescript-eslint/parser, @typescript-eslint/type-utils, @typescript-eslint/typescript-estree, @typescript-eslint/utils and minimatch. The installed typescript-estree declares minimatch ^10.2.2; fixed 11.0.1 falls outside that range. The audit proposes eslint-config-next 15.5.29, a major downgrade from the installed 16.4.2. Neither overriding a major transitive dependency nor downgrading Next-aligned tooling is a safe compatible patch here. No force fix was run. These paths are lint tooling, not the runtime notification rich-text renderer. Avoid processing untrusted lint/glob configuration; review upstream compatible fixes before release. The previous offline audit's zero findings were not valid clearance. No Tiptap advisory appeared in the current report.

## Acceptance boundary

Implemented/static: notification CRUD, visibility and ownership rules, cache/read synchronization, scheduling/claims, optional dispatch, deployment tools.
Prepared/not activated: indexes/collection provisioning, dedicated service, worker/push flags, optional Firebase file setting.
Approval-dependent: remote development metadata inspection; production provisioning/activation; real push delivery.
Unverified: actual indexes/records, authenticated Admin CRUD, MongoDB transaction/failover behavior, native schema migration, OS background/cold-start delivery and multiple-device read synchronization.
Now implemented: Expo receipt polling and registration-time-guarded invalid-token cleanup. Not implemented: manual unknown-push resend, generalized historical shared-token reassignment, automatic localization of authored content, or unified read state for OS-only local reminders. These are not silently represented as completed delivery guarantees.

Production ready: **No**. Required provisioning, hosting confirmation, approved isolated runtime acceptance, native migration and physical-device push acceptance remain. Static validation alone cannot close those requirements.

## Final validation evidence

- Mobile `npm run typecheck`: exit 0.
- Admin `npm --prefix website run typecheck`: exit 0.
- Admin `npm --prefix website run build -- --webpack`: exit 0; all existing Admin routes plus /admin/notifications appear in the build output.
- Android `npm run export:android`: exit 0; 823 modules bundled. This is not a native install/device-delivery check.
- `node --check`: all 15 changed/new JavaScript/module files passed (14 backend files and app.config.js).
- `git diff --check`: passed.
- Current registry dependency audit: exit 1 because eight moderate advisories remain; zero high/critical. This is a reported outstanding issue, not a passing check.
- Local HTTP request to the restored Digital-Khata IPv6 listener `/admin/notifications`: 200 streamed PPR response containing NEXT_REDIRECT and a meta redirect to /admin/login; protected announcement UI was absent. Confirms unauthenticated route protection only, not authenticated CRUD or database availability.
- No automated cases/suites were created/run. No backend workers were started, no provisioning was applied, no pushes were sent, and no commits/pushes were made.

## Files changed in this follow-up

Existing uncommitted implementation remains. Additional edits: `App.tsx`, `app.config.js`, `src/notificationRuntime.ts`, `src/useNotificationInbox.ts`, `server/src/admin/routes/notificationsRoutes.js`, `server/src/notifications/publication.js`, `website/src/components/admin/notifications/management.tsx`, `docs/NOTIFICATION-MANAGEMENT-IMPLEMENTATION.md`.

New files: `server/src/notifications/provision.mjs`, `server/src/notifications/worker.mjs`, `server/deploy/notifications.service.example`, `server/deploy/notifications.env.example`, and this readiness audit. That earlier follow-up left dependencies unchanged. The final completion pass replaces Tiptap with CKEditor, adds native HTML rendering and server image/HTML processing, and applies compatible advisory fixes; see the completion report for current counts.

## Final repeated-request review

Rechecked the existing uncommitted implementation instead of rebuilding it. One further confirmed defect was corrected in `src/useNotificationInbox.ts`: subtracting every pending local read from the server unread total could undercount unrelated unread notifications when another device had already read a queued item. The hook now resolves pending IDs through the existing ownership-checked reconciliation endpoint and subtracts only visible, server-unread items. It also avoids reading the encrypted acknowledgement queue when the offline-session gate disallows cache access. Counts remain eventually consistent during concurrent reads; no instantaneous cross-device guarantee is claimed.

No backend, Admin page, schema, dependency or deployment activation changes were made in this review. Prior Admin build/typecheck, backend syntax and unauthenticated-route results remain applicable to unchanged files. Database metadata approval remains outstanding; repeated implementation instructions do not authorize production provisioning or real pushes.

Repeated-review validation: mobile typecheck exit 0; Android export exit 0 (823 modules); git diff whitespace check passed. No automated cases or suites were created/run.


## Superseding completion evidence — 12 November 2026

Read `NOTIFICATION-FINAL-COMPLETION-REPORT.md` for the latest status. CKEditor, IST conversion, private images, receipt tracking and subscription inbox bridging are implemented and statically validated. License configuration remains approval-dependent; provisioning and worker activation have not run. The authenticated UI, remote database, physical-device delivery and migration remain unverified. Notification media is private MongoDB binary storage, not public hosting. Root dependency audit retains 12 findings; backend update reported zero; Admin retains eight moderate findings. No production-readiness claim is made.


## Latest follow-up

See the follow-up completion review in `NOTIFICATION-FINAL-COMPLETION-REPORT.md`. Expiry inbox generation now runs in the existing opt-in publisher independently of push, with bounded same-day recovery. Shared-token protection and guarded invalid-token cleanup extend to subscription and balance-reminder pushes. Subscription ambiguous delivery is not blindly retried. No historical unread backfill or local/remote unified identity is claimed. Current static checks passed; dependency counts are mobile 11, Admin 8 moderate, backend 0. Production activation and device acceptance remain unverified; no tests or production operations performed.

## Delivery correction — 13 November 2026

Confirmed and corrected worker-gated campaign visibility, rejected backdated
schedules, recipient-created-time ordering, overbroad read acknowledgements and
mobile read/refresh/UI gaps. Due campaigns now use server-query eligibility without
fanout. See [delivery correction](NOTIFICATION-DELIVERY-FIX.md). Static checks passed;
authenticated database/device acceptance is still unverified, not production-ready.
