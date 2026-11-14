# Notification visibility, read state and mobile delivery correction

13 November 2026. Source-backed fixes; authenticated/database/device acceptance is
still outstanding. No automated cases or suites were created or run.

## Confirmed root causes

1. `server/src/services/notificationsService.js` started exclusively from recipient
   `notifications` rows. Its campaign lookup required `publishedAt`. Admin Save wrote
   only `adminnotifications`, so an inactive/unavailable publication worker made saved
   campaigns undiscoverable, including due campaigns. The unread total was already a
   server-side total, but excluded all these unmaterialized recipients.
2. `server/src/admin/routes/notificationsRoutes.js` rejected changed schedules more
   than five minutes in the past, contrary to the requested backdated-save policy.
3. The API sorted/displayed recipient `createdAt`, which reflected worker timing
   rather than the campaign's Display On instant.
4. Read updates checked shop ownership but not campaign visibility; an empty ID array
   expanded to all shop notifications. The mobile read handler waited for persistence
   before changing its visible count, and an overlapping refresh could drop the follow-up
   refresh request.
5. More already contained Notifications and a bell icon, but no unread count. The
   notification view applied a second local pagination layer to a server-paginated
   feed and lacked pull-to-refresh. Home already had a 99+ badge; this was retained.
6. Future OS subscription reminders had no durable inbox identity unless the reminder
   worker later ran. Historical OS-only alerts cannot reliably be assigned read state.

These are code-confirmed causes. No failing authenticated request or live MongoDB
record was inspected, so environment/provisioning failures are not ruled out.

## Query-driven visibility and sorting

The existing `notifications` collection is unioned with eligible `adminnotifications`
campaigns. Eligibility uses one helper: current environment, active status, no
`deletedAt`, `displayOn <= server now`, and either all recipients or selected current
shop ID. Authentication still validates the active user and shop ownership. No
`publishedAt`, delivery state, push success or worker-created row is needed.

Admin input remains IST-to-UTC; now/past timestamps are accepted. After the save
transaction commits, the next authorized query can see the campaign. Future campaigns
are absent from list, detail, count, reconciliation and legacy-media access. The
mobile polling interval remains 60 seconds while active; app foreground, navigation,
reconnection, push and manual/pull refresh also fetch. Exact-second device delivery
is not promised. Offline devices cannot download unseen notifications.

Sort: effective date descending, then `_id` descending. For announcements, effective
date is Display On. A backdated announcement is available immediately but appears
at its historical position, not necessarily first. Ordinary events use createdAt;
registered subscription reminders use visibleAfter. Counts are computed before page
limits. Concurrent changes between offset pages still require refresh; mobile merges
IDs to avoid duplicate rendered rows.

“All” inbox eligibility covers current authenticated shop owners, including shops
registered later. Selected eligibility uses the saved shop IDs. Optional push fanout
retains its existing audience snapshot; later shops may see inbox content without
receiving that historical push. Due active audience/schedule fields are locked against
editing even before worker fanout, while content, status and soft deletion retain the
existing controls. Worker state remains separate from inbox eligibility in Admin.

## Identities and per-shopkeeper reads

Announcement public identity is the campaign ObjectId. Existing recipient-row IDs
remain aliases accepted by detail, read, reconciliation and legacy-media APIs.
The query joins only the current shop/user's receipts and emits one announcement,
regardless of how many old delivery rows exist. No receipt means unread.

On opening, mobile updates list/badge optimistically. Native storage persists the
read and its pending acknowledgement in encrypted SQLite; network failures leave
that queue durable. Repeated opening is guarded locally and idempotent on the server.
Without native cache, a failed write rolls back the optimistic state with an error.
Overlapping refresh requests now queue one follow-up refresh rather than losing it.

Read acknowledgement reuses an existing authorized receipt or upserts a deterministic
campaign/shop/user receipt using MongoDB's unique `_id`. Duplicate-key races retry the
same update. It does not create a new collection or reset existing reads. Empty IDs
are a no-op, and future/inactive/deleted/nonrecipient IDs do not create receipts.
The optional worker reuses these receipts, preserves read state, initializes optional
push state when absent, and commits recipient counts with its existing cursor transaction.

Mobile alias migration is scoped to the account and occurs transactionally in the
existing SQLite cache. Old alias entries merge read/pending flags into the canonical
entry before the redundant local row is removed. No MongoDB rows are removed. Native
read state stays monotonic. Online list display uses the current authorized API
result; cached content remains the offline fallback. Existing cache/session limits,
Base64 support and read queue remain.

## All-category inventory

- Admin announcements: queried directly; worker-independent, durable campaign identity.
- Subscription purchase/activation/payment-related messages: existing
  `sendSubscriptionPush` already writes a deterministic inbox record before optional
  push. Those records continue contributing once each.
- Balance reminder delivery messages: existing reminder service persists a recipient
  notification identified by the delivery record. Retained.
- Ordinary/system activity already persisted in `notifications`: retained.
- Future subscription expiry/OS reminders: new authenticated
  `POST /notifications/subscription-reminders` registers server-verified future slots
  for the current account's active subscription. No client-provided shop, dates,
  subscription IDs or content are trusted. It uses the same deterministic identity
  as the existing subscription worker; no push is sent by registration.
- Historical OS-only notifications/push logs without persistent identities: not
  fabricated or backfilled. Local ledger audit rows are activity evidence, not new
  unread notifications.

Registration is attempted on mobile sync at most every 15 minutes after success.
It uses configured server reminder timezone/time for 15/7/3/1/0-day slots; stores
actual createdAt and separate visibleAfter. Future rows are excluded until due.
Cancelled/paused/superseded subscriptions and covering renewals suppress these
registered reminders through the query. Existing local OS scheduling remains;
OS delivery itself never creates a second unread record. Only future slots are
registered—first deployment does not infer whether past OS alerts were seen.

## Mobile UI and refresh

More → Notifications now shows its existing bell plus unread count (99+ cap). Home
retains its badge and hides zero. The list retains New/Read styling, title, preview,
effective timestamp, details, pagination, formatted HTML/Base64 and legacy images.
Added pull-to-refresh and explicit offline/empty states; removed the redundant local
page slice. Recent activity and its existing controls remain. Opening the bell does
not mark everything read. Backend totals, not visible-row counts, drive the badge.

## Collections, APIs and deployment

Actual model mappings: `AdminNotification` → `adminnotifications`, `Notification` →
`notifications`, `ShopSubscription` → `shopsubscriptions`; existing `shops`, `users`
and legacy `notificationmedia` remain. New optional notification fields:
`visibleAfter`, `subscriptionReminderId`. No destructive migration/new collection.
MongoDB must support `$unionWith` (4.4+); actual deployment version was not inspected.

Existing mobile routes retained: GET /notifications; GET /notifications/:id;
PATCH /notifications/read; POST /notifications/reconcile; authorized legacy image
GET /notifications/:id/media/:mediaId. New future-reminder registration POST noted
above. All remain under the existing `/api/v1` router/authentication and write limits.
Admin CRUD/proxy paths and Tiptap/Base64 HTML format are unchanged.

Two index declarations/provisioning recommendations added:
- adminnotifications: appMode, status, displayOn descending, _id descending.
- notifications: campaignId, shopId, recipientUserId.

Auto-index creation remains disabled. Existing provisioning command remains
`node --env-file=<approved-environment-file> src/notifications/provision.mjs --check`
from `server/`; apply requires the existing explicit `--apply --confirm-db <name>`
procedure and approval. Neither command was executed here. Read-receipt idempotency
uses the existing unique `_id`, not an unprovisioned new unique index. Optional push
and receipt workers still need deployment activation, but inbox visibility does not.

## Files changed for this correction

- `server/src/services/notificationsService.js`
- `server/src/notifications/subscriptionInbox.js` (new)
- `server/src/notifications/publication.js`
- `server/src/notifications/models.js`
- `server/src/notifications/provision.mjs`
- `server/src/models.js` (notification-only fields/index)
- `server/src/routes/notificationsRoutes.js`
- `server/src/admin/routes/notificationsRoutes.js`
- `src/api.ts`
- `src/useNotificationInbox.ts`
- `src/offlineStore.ts`
- `src/notificationTypes.ts`
- `App.tsx` (notification UI only)
- `website/src/components/admin/notifications/management.tsx`
- This report and links from existing notification documentation.

## Validation and remaining acceptance

Passed: Admin typecheck, mobile typecheck, Admin production build (28 pages), Android
export (1425 modules), syntax checks for eight changed backend JS/MJS files, and
`git diff --check`. The existing local Admin frontend was restored successfully.
The first restoration attempt was blocked by sandbox port permissions; the approved
retry succeeded. An initial syntax command used the wrong working directory and was
corrected; the subsequent syntax check passed.

No authenticated Admin/mobile flow, database query execution, recipient isolation,
concurrent receipt writes, legacy alias migration, physical-device badge behavior,
image rendering or offline restart behavior was runtime verified. Builds do not prove
those outcomes. No approved development database/authenticated browser/device was
available. The live collection/index state and worker deployment remain unverified.

No automated tests, production record/index writes, worker activation, real pushes,
financial operations, commits or Git pushes were performed. Unrelated existing
uncommitted changes were preserved. Payment, ledger, subscription entitlement,
Tiptap/Base64 validation and push receipt processing were not rewritten.

Production acceptance remains outstanding. Deploy compatible backend/mobile/Admin
versions, review/provision indexes through approval, then perform authorized
end-to-end development/device acceptance. Do not roll back to the old worker-gated
reader after query-driven campaigns/read receipts have been used without reviewing
those compatibility implications. Keep existing rows and aliases intact.

## Shared Home / More badge correction

Both entry points now render `src/NotificationBell.tsx` with the same
`useNotificationInbox.unread` value, hidden at zero and capped visually at 99+.
The More entry remains clickable across the complete row. Navigation to Home and
More now requests the same serialized refresh used by Notifications. Login hydration,
foreground, reconnection, push receipt and active-app 60-second polling remain.

Confirmed additional defects: cached-row counts replaced the global server total
on hydration/error (only a subset of notifications is downloaded); no global count
snapshot survived restart; an in-flight response could overwrite an optimistic read
update. The shared hook now avoids replacing an already displayed count during cache
hydration and rejects count responses concurrent with new local read changes, queuing
another refresh. Backend `GET /notifications` already returns a global `unread` facet
before pagination; its visibility/category rules and response contract are unchanged.

Encrypted SQLite migration 8 adds only `local_notification_counts`, keyed by account.
Successful reconciled server totals are stored there. A first local read atomically
marks its existing row, queues the acknowledgement and decrements the snapshot once.
Account cleanup also clears its count. No ledger rows or existing cache are reset.
Until the first successful global count synchronization after upgrading, an account
without a snapshot has no trustworthy global total and shows no badge; it does not
invent a total from downloaded rows. Offline totals reflect last-known eligibility,
with local reads applied; newly due/deactivated remote records require reconnection.

Files for this correction: App.tsx, src/NotificationBell.tsx,
src/useNotificationInbox.ts, src/offlineStore.ts and this document. Notification detail
presentation, read-on-open callbacks, Admin functionality and backend are unchanged.
Physical-device badge layout, cross-device counts, migration, scheduled eligibility and
offline restart/reconnection remain unverified; no authenticated development device
was available. No production operations, pushes, automated cases, commits or pushes.

Badge correction validation: mobile TypeScript check passed; Android export passed
(1426 modules); git diff whitespace check passed. These are static/build results,
not evidence of physical-device or authenticated API behavior.

## Badge presentation follow-up

Notifications now uses the exact More `Row` used by Downloads, with an optional
icon overlay; other rows retain their original icon rendering. Downloads itself has
no separate chevron when an icon is supplied, so Notifications follows that existing
pattern rather than adding a different navigation affordance. The shared red badge
uses explicit Android text metrics and stacking, white digits, and visible overflow.
Home retains its existing location and touch target. No synthetic counts are used.

A confirmed state-path defect was that caching rich content or reconciling older
cached pages could fail before a successfully retrieved global unread total was
applied. The count is now applied before those operations, after validation and
pending-read adjustment; later cache failure cannot replace it with an older snapshot.
The API returns the unread field directly and the backend counts before pagination.
No authenticated request was available to establish whether the reported running app
receives zero, errors, or a positive count. Nor was its installed bundle inspected.
Thus the exact runtime cause of the reported invisible badge remains unverified.

Changed: App.tsx, src/ui.tsx (optional overlay only), src/NotificationBell.tsx,
src/useNotificationInbox.ts, this document. No backend eligibility, read-queue,
notification detail, or production data changes. Device visual acceptance with a
real positive count and confirmation of the installed bundle remain necessary.
