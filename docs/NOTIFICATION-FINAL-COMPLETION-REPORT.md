# Notification completion and deployment report

**Current editor update:** CKEditor has been replaced with MIT-only Tiptap at the owner’s request. CKEditor licensing/configuration statements below are historical and no longer block editing. See [Tiptap migration](NOTIFICATION-TIPTAP-MIGRATION.md) for current image selection, compatibility, files and validation. Other deployment limitations remain.

12 November 2026. **Not production-ready.** Implementation and static validation are distinct from authenticated runtime/device acceptance. Existing uncommitted implementation was preserved. No automated cases, mocks, fixtures or suites were created or run; no backend workers, production writes, pushes, financial operations, commits or pushes to Git were performed.

## Completion status

| Requirement | Status and evidence |
|---|---|
| CKEditor 5 in both description fields | Implemented and statically validated: client-only ClassicEditor 49.1 / React adapter 12, OSS plugins, successful Next production build. Editor activation awaits license configuration. |
| Image selection/upload/insertion | Implemented and statically validated: custom upload adapter, authenticated proxy/backend, validated private binary storage. Not runtime verified; storage provisioning and licensed editor are prerequisites. |
| Display On in IST | Implemented and statically validated: Asia/Kolkata conversion independent of browser timezone; UTC storage. |
| Strict scheduled visibility | Implemented/source reviewed: active, due, published, owner-authorized campaign required by list/detail/count/reconciliation/media; worker and push independently enforce due eligibility. Database runtime unverified. |
| Bell counts every category | Partial: all eligible persisted inbox records are aggregated, not just the current page. New subscription send events enter that inbox idempotently. Historical push-only logs and OS-only local reminders are not fully unified. |
| Bell opens complete list | Existing bell/list/navigation retained; all persisted eligible inbox categories use incremental loading. Historical/local-only gap above remains. |
| Native formatting/images | Implemented and bundled: maintained @native-html/render, no WebView/script execution; private image fetch and offline/error placeholders. Physical-device rendering unverified. |
| Previously synchronized offline notifications | Existing encrypted SQLite schema-7 cache preserved; formatted text remains available subject to offline-session rules. Images deliberately not persisted. Device migration unverified. |
| Offline read synchronization | Existing durable account-scoped acknowledgements/monotonic read merging retained and typechecked; runtime multi-device/restart acceptance unverified. |
| Expo receipt handling | Implemented and syntax checked for administrative pushes; not activated or provider-verified. Legacy subscription push dispatch remains otherwise unchanged. |
| Provisioning/workers | Prepared but not activated. Explicit approval required for production metadata changes/activation. Actual database indexes not inspected. |
| Actual device delivery | Unverified: no real push sent, no physical device acceptance. |
| Production readiness | No: license, provisioning, deployment, remaining category gap, dependency review and end-to-end acceptance remain. |

Runtime verified only: restored existing local Next server starts successfully. An unauthenticated GET `/admin/notifications` returns the partial-render shell (HTTP 200) containing `NEXT_REDIRECT` and `/admin/login`. This is route/auth-gate evidence, not evidence of authenticated editor rendering. No authenticated browser session or approved safe database was available.

## Changes and preserved behavior

Admin CRUD, selected/all targeting, revision concurrency, soft deletion, recipient search, sorting, 20/50/100 pagination, published schedule locks, permission gates and existing routes remain. Added recipient push-state filter/summary and receipt evidence without merging publication with delivery. Existing payment, shop financial, ledger and subscription pages remain in the production route inventory. No unrelated financial calculations or payment-processing paths changed.

Both editors retain legacy structured content, converting editor HTML into the same bounded JSON representation server-side. Formatting supports headings 1–3, paragraphs, bold/italic/underline, lists, HTTP(S) links, blockquotes, simple tables and uploaded images with percentage sizing. Image alignment controls and merged table cells are not implemented; unsupported merged cells are rejected. Native table cells stack to preserve readable content without horizontal overflow. No premium plugins used.

[CKEditor licensing](https://ckeditor.com/docs/ckeditor5/latest/getting-started/licensing/license-key-and-activation.html) requires an appropriate self-hosted commercial key or GPL compliance. No GPL assumption or license key was inserted. Set `NEXT_PUBLIC_CKEDITOR_LICENSE_KEY` in the frontend build environment only after licensing approval. The editor shows a clear configuration message while missing; stored content remains intact. Rebuild after configuration. Real license activation/CSP compatibility must be accepted before release.

## Media and sanitization

New explicit `notificationmedia` collection stores environment, creator, timestamps, content type, dimensions, byte size and private image bytes. Upload accepts JPEG/PNG/WebP up to 2 MiB, checks decoded format/dimensions (maximum 4096×4096 and 16M pixels), rejects animation, strips metadata and re-encodes WebP. Stored output is also bounded to 2 MiB. Up to eight references per description field. No filesystem persistence, external public URL, base64-in-description, or automatic media deletion. Orphan uploads are retained; storage quotas/retention monitoring need deployment planning.

Server sanitize-html strips unsafe markup; structural validation rejects unsupported data/links, credentials in links, invalid references, overlong/deep documents. Only local authorized media references survive. Notification documents store IDs, not images. Admin GET requires notification-read permission. Mobile GET verifies authenticated account/shop recipient plus current environment, active/nondeleted/published/due campaign and media membership. Backend bytes are excluded from ordinary model selection.

The mobile response includes bounded WebP base64 for an authenticated request; it is held only in component memory, never SQLite or the ledger queue. Account-specific component keys, stale-response guards and offline/unmount cleanup avoid reuse across sessions. Remote image caching is not claimed. Images cannot be viewed offline; formatted cached text can.

## Scheduling and read identity

Input converts `YYYY-MM-DDTHH:mm` explicitly with +05:30 and validates round-trip; for example 10 November 2026 10:30 IST maps to 2026-11-10T05:00:00.000Z. Defaults derive current IST. Unchanged edits retain the original UTC timestamp (including seconds). New/changed times more than five minutes before server time are rejected; this grace allows normal form submission delays. Future content is never pre-downloaded. Worker interval remains one minute, so exact-second delivery is not promised.

Bell uses server unread aggregate and local cached count offline, excludes read/hidden/future/foreign-account recipients and caps visual badge at 99+. Opening the list does not mark everything read. Individual reads remain durable and monotonic. Existing local recent activity remains available separately.

New subscription inbox IDs derive from shop ID plus existing subscription deduplication key; repeated push attempts cannot create repeated inbox entries. Inbox failure is logged without changing the financial result. Historical subscription logs lack reusable message content/read identity; no fabricated backfill. OS-local expiry reminders remain unchanged and are not counted as separate persisted messages. Subscription reminder generation still respects its existing enablement configuration. Full all-category unification remains outstanding.

## Push receipts and ambiguity

Accepted ticket IDs and device registration timestamps are stored in protected fields. First receipt check occurs after 15 minutes; up to 20 recipient records per tick, at most the existing 100 tokens per recipient. Atomic 60-second leases support multiple instances. Missing receipts retry at 15 minutes; transient request failures back off 5–60 minutes. After 24 hours outstanding receipts become unknown. Receipt retrieval never resends a push. Dispatch failures do not prevent the receipt phase.

An Expo OK receipt indicates handoff to FCM/APNs, not device display or user read. See [Expo delivery receipts](https://docs.expo.dev/push-notifications/sending-notifications/). DeviceNotRegistered cleanup requires the same shop/token and a registration timestamp no newer than the captured attempt. Current shared-token exclusion remains; historical ownership is not guessed. Malformed/ambiguous ticket outcomes remain unknown; no uncontrolled or manual mass resend added. Legacy accepted tickets without stored IDs cannot be retrospectively polled.

## APIs and collections

Existing `/api/v1/admin/notifications` list/create, recipients, detail/update and soft-delete contracts remain. Optional `deliveryState` filtering uses actual per-recipient push states; list adds `deliverySummary`, detail adds `receipts`. Existing consumers may ignore these additive fields.

New read/upload endpoints:

- `POST /api/v1/admin/notification-media` — notification-manage permission, Admin audit, binary upload.
- `GET /api/v1/admin/notification-media/:id` — notification-read permission, private bytes.
- `GET /api/v1/notifications/:id/media/:mediaId` — account/shop and published campaign authorization, private image response.

Next proxies Admin endpoints through `/admin/api`; raw binary allowance is confined to this upload route, capped at 2 MiB, with existing CSRF and session enforcement. Other request bounds remain.

Collections: `adminnotifications` campaigns; `notifications` recipient/read/delivery evidence; new explicit `notificationmedia` private images. Existing `devices`, `shops`, `users`, `adminaudits` reused. Receipt fields/category additions are optional and backward compatible. No records or database metadata were changed in this execution.

## Provisioning and deployment (not executed)

Use Node 22.12 or newer (validated with 22.23.4) and the existing selected environment file. The backend engines declaration now matches the sanitizer requirement; Node 20 deployments must upgrade before this release. From `server/`:

```sh
node --env-file=.env.development --import=./src/config/startupGuard.js src/notifications/provision.mjs --check
```

After explicit target approval, provision with the exact configured database name:

```sh
node --env-file=.env.production --import=./src/config/startupGuard.js src/notifications/provision.mjs --apply --confirm-db digital_khata_production
```

Do not run this against production until approved. Procedure requires replica-set/sharded transactions, retains existing collections/data/indexes, creates only missing campaign/media collections and compatible named query indexes, and stops on conflicts. New index keys: notification media `(appMode,createdAt)` and receipts `(campaignMode,receiptState,receiptNextAt,_id)`, in addition to existing prepared campaign/inbox/delivery/device indexes. No TTL deletes, no automatic index drops, no production auto-index reliance.

Choose existing in-API scheduler OR dedicated `server/src/notifications/worker.mjs` with `server/deploy/notifications.service.example`; do not accidentally run both. Templates are not evidence of a particular hosting provider. A persistent supervised process, network access and reliable clock are required. Keep `ADMIN_NOTIFICATION_WORKER_ENABLED=false` and `ADMIN_NOTIFICATION_PUSH_ENABLED=false` until approved. Configure server-only `EXPO_ACCESS_TOKEN` if enhanced push security is enabled; confirm EAS project/FCM credentials and a SQLCipher-capable Android build separately. Images require provisioning even if push remains disabled.

Monitor publication/dispatch/receipt error codes, missing tick logs, unknown/skipped outcomes, storage growth and overdue campaigns. No receipt means unknown, not failure or read. Rollback: stop notification flags/worker, retain all data/indexes, use campaign-visibility-aware backend and schema-7-aware mobile reader. Never delete cached ledger data to downgrade. Keep a backward-compatible release available; do not roll back to pre-visibility-check APIs.

## Dependency review

- Backend: compatible Mongoose/body-parser/qs updates; install/update report **0 advisories**. Added sharp, sanitize-html, htmlparser2. No force or major framework upgrade.
- Mobile root: **12 advisories: 2 high, 9 moderate, 1 low** after compatible node-forge update (down from 13). Remaining paths include Expo CLI/Zod 3, Expo config/xcode/uuid, glob/minimatch, deepmerge. Parent ranges do not all permit fixed majors; SDK58 migration/overrides were not forced. Deepmerge is also a native HTML renderer dependency; renderer inputs/options are bounded trusted structured data, but this is mitigation rather than advisory clearance.
- Admin: **8 moderate** ESLint/typescript-eslint/minimatch tooling advisories remain; unsafe tooling downgrade/major override was not applied. CKEditor replaced unused Tiptap packages.

Review all outstanding advisories before production. Build success does not establish vulnerability absence.

## Files in this completion pass

Frontend: `website/next.config.ts`, `website/package.json`, `website/package-lock.json`, `website/src/components/admin/notifications/{ckeditor-client,rich-editor,management}.tsx`, `website/src/components/admin/notifications/time.ts`, `website/src/app/admin/api/[...path]/route.ts`, `website/src/app/admin/admin.css`.

Mobile/shared: `App.tsx`, `src/api.ts`, `src/NotificationContent.tsx`, `src/notificationTypes.ts`, `shared/notificationContent.ts`, root package manifests/lockfile and `.gitignore` (generated shared-workspace Next cache only). Existing offline store/hook/runtime changes from prior work remain.

Backend: server package manifests/lockfile; `server/src/notifications/{html,media,receipts,content,models,publication}.js`, `server/src/notifications/provision.mjs`, `server/src/models.js`, `server/src/admin/routes/notificationsRoutes.js`, `server/src/routes/notificationsRoutes.js`, `server/src/services/{notificationsService,subscriptionNotificationService}.js`, `server/deploy/notifications.env.example`.

Documentation: final-completion audit/report, management implementation and final-readiness audit. Earlier uncommitted files were retained; this list does not attribute all prior work to this pass.

## Validation outcomes

| Check | Outcome |
|---|---|
| Mobile `npm run typecheck` | Passed |
| Admin `npm --prefix website run typecheck` | Passed |
| Admin `npm --prefix website run build` | Passed after fixing shared-module root and allowing existing Google Fonts downloads |
| `npm run export:android` | Passed: 1,424 modules, Hermes bundle generated |
| Node syntax checks | Passed for all 123 server source JS/MJS files; no modules executed |
| `git diff --check` | Passed |
| Static routes/imports and preservation review | Existing Admin routes retained, no new financial writes from rendering |
| Authenticated Admin UI/API/database | Unverified |
| Android device, image display, encrypted migration, push, worker recovery | Unverified |

Initial Admin build failures were real: sandbox font downloads and a shared-module path outside Turbopack root. Both resolved before the successful production build. No automated suites were run. Deployment acceptance must still establish licensed editor rendering, authorized image upload/access, database/index readiness, concurrent publication/recovery, device rich content/read state, offline migration, account switching, receipt outcomes and native push/tap behavior before release.


## Follow-up completion review — 12 November 2026

This section supersedes earlier gap/dependency counts where noted. No automated cases were created/run, no backend started, no worker activated, no database/provider operation performed, no commits/pushes.

### Source inventory and fixes

- Administrative campaigns: existing due/active/owner-scoped records, cache, read states, optional pushes and receipt polling retained.
- Customer balance reminders: existing SMS/WhatsApp success notifications already enter the inbox. Added explicit balance_reminder category, original shop owner recipient and delivery-claim ID as stable notification identity. Existing financial calculations and messaging schedule remain unchanged. Actual customer SMS/WhatsApp deliveries are not themselves shopkeeper unread messages; their existing success notices are.
- Subscription/payment-status notifications: existing deterministic inbox bridge retained; now push is not sent if the inbox write fails. Repeated events preserve read state. All calls through the existing subscription notification service use this identity.
- Subscription expiry: found inbox generation improperly gated by push enablement and an exact-minute trigger. The existing notification publisher now runs bounded expiry processing independently of optional push, including the dedicated worker path. The old standalone reminder timer delegates when that publisher is enabled, avoiding a second timer in the same process. Push-only existing deployments retain their timer. Same-day late runs recover; scan limited to 100 rows/tick and 16-day horizon. Current-day expired subscriptions are included, with active or scheduled renewals suppressing obsolete notices. No historical unread backfill.
- Shared-token security: administrative dispatch already excluded ambiguous tokens, but subscription/customer reminder pushes did not. New ownedPushDevices helper verifies current shop owner and excludes every token associated with another shop. Invalid-token cleanup is guarded by captured registration timestamp. Historical ownership is not reassigned or deleted merely because it is shared.
- Subscription push ambiguity: stale claims, malformed/timeout outcomes and legacy unknown-attempt history are not automatically resent. New explicit rejections are bounded to three attempts; provider call timeout is 15 seconds. Optional deliveryUncertain/attempts fields preserve old status enum and records. Ticket acceptance still does not mean device delivery. Receipt polling remains for administrative pushes; extending legacy subscription receipt tracking is not claimed.

### Remaining gaps

Complete all-category equivalence is NOT claimed. OS-only local expiry reminders still have device-local scheduling and no reliable common historical read identity. Future server-generated expiry counterparts now participate in the shared inbox when the notification publisher is enabled, but local-only delivery while fully offline cannot create a server-authoritative unread record. Historical push logs do not establish unread state and are not backfilled. Multi-day missed expiry checkpoints are not retroactively invented. A complete durable unified local/remote reminder identity design remains outstanding. Customer reminder success-log and inbox writes are still separate; recovery after a database failure between those writes is not implemented in this pass.

### Licensing decision

CKEditor 49.1.0 and React adapter 12.0.0 remain, with only the existing non-premium plugins. No license was configured or GPL selected. A proprietary release must resolve the applicable license with the vendor: [CKEditor licensing](https://ckeditor.com/docs/ckeditor5/latest/getting-started/licensing/license-key-and-activation.html).

A maintained alternative is [Tiptap OSS](https://tiptap.dev/docs/editor/getting-started/overview), published under MIT. An approved migration could reuse the current structured document schema, sanitizer and authenticated upload endpoints; it would need an image media-ID extension/upload adapter, table/underline extensions and equivalent toolbar/Next client-only integration. It would not require rewriting notification records or the mobile renderer. Premium Tiptap services are not included in that recommendation. No editor replacement/package installation was performed: retaining CKEditor is preferred if licensing is resolved; switching requires an explicit decision.

### Verification and deployment boundary

Passed in this follow-up: Mobile typecheck, Admin typecheck, Admin production build, Android export (1,424 modules), syntax checks across 124 backend JS/MJS files, git diff whitespace check. Changed backend files received final syntax checks after formatting. Existing Admin routes remain in the build inventory. Existing local frontend was stopped only for its build and restored; no backend/notification worker was started.

Fresh audits: mobile 11 (2 high, 8 moderate, 1 low); Admin 8 moderate; backend 0. No dependency version changes in this follow-up and no forced upgrade. Previous compatible-fix review remains applicable; remaining Expo/Zod/glob/minimatch and renderer deepmerge risks require release review.

Unverified: actual metadata/indexes, licensed editor, authenticated Admin/image operations, native rendering/migration, token registration races, real worker recovery and end-to-end push delivery. All previous provisioning/activation/rollback instructions remain; the opt-in publisher additionally processes expiry inbox generation, so review this scope before enabling it. Keep production flags unchanged until approval. Node minimum remains 22.12. No automatic media/index provisioning added.

Files changed this follow-up: server/src/services/pushOwnership.js (new); server/src/services/subscriptionNotificationService.js; server/src/subscriptionReminders.js; server/src/reminders.js; server/src/notifications/publication.js; server/src/models.js; these three notification documents. Existing uncommitted changes retained.

### Final status matrix

| Area | Status |
|---|---|
| Admin notification CRUD | Implemented and statically validated |
| CKEditor licensing | Awaiting approval |
| Image uploads | Implemented and statically validated |
| IST scheduling | Implemented and statically validated |
| Strict scheduled visibility | Implemented and statically validated |
| All-category unread count | Not implemented |
| Historical reminder handling | Not implemented |
| Mobile notification inbox | Implemented and statically validated |
| Offline notification cache | Implemented and statically validated |
| Offline read synchronization | Implemented and statically validated |
| Expo push dispatch | Implemented and statically validated |
| Expo receipt polling | Implemented and statically validated |
| Shared-token cleanup | Implemented and statically validated |
| MongoDB provisioning | Prepared but not activated |
| Scheduler activation | Awaiting approval |
| Authenticated Admin verification | Unverified |
| Physical Android verification | Unverified |
| Production readiness | Unverified |

The all-category row denotes the remaining unified local/remote gap, not an absence of the existing aggregate. Historical handling denotes no fabricated backfill. Shared-token cleanup denotes safe exclusion and invalid-token cleanup, not general ownership reassignment.

**Fully implemented? No:** unified local/remote reminders and reminder failure recovery remain, and licensed editing is not activated. **Working end-to-end? Not established:** no approved database/authenticated/device acceptance. **Production-ready? No:** resolve implementation gaps, license, metadata/worker configuration, advisories and runtime acceptance first.
