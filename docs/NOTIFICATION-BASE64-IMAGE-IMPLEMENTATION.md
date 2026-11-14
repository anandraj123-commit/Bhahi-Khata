# Embedded notification images — 13 November 2026

## Result and scope

New notification images are processed locally and embedded as data URLs. The active
Tiptap editor has only **Upload Image**. Its Insert Image dialog contains Choose
Image, local preview, optional Alternative Text, Insert Image and Cancel. Selecting
a file prepares the preview; Insert Image places the actual image at the saved
editor selection before the notification is saved. No media upload request, folder,
gallery, separate binary record or storage provisioning is required for new images.

This is implemented and statically validated, **not authenticated workflow or device
acceptance**. No production data, workers, pushes, commits or Git pushes were changed.
No automated cases, fixtures, mocks or suites were created or run.

## Existing architecture reviewed

Read the repository policy, Tiptap migration and notification completion reports;
traced notification form/editor, image picker, proxy, admin routes, content sanitizer,
media validation, Mixed MongoDB content fields, mobile presentation service, rich
renderer, encrypted notification cache and reconnection/read queue. Previously,
HTML was converted into structured documents, images required private media IDs,
and approximately 30 KB request limits prevented embedded content.

## Browser processing and editor

- Verify PNG/JPEG/WebP signatures, read dimension headers before decoding, reject
  source dimensions above 4096 × 4096 and source files above 2 MiB.
- Decode with `createImageBitmap`, resize proportionally to fit 1200 × 1200, and
  encode WebP at quality 0.85. Browser fallback is PNG, preserving transparency.
- Reject an encoded data URL above 500 KiB rather than repeatedly reducing quality.
  Animated input is explicitly presented as a still-frame insertion.
- Tiptap Image enables Base64, retains both selection endpoints, checks insertion
  success and updates the form through the existing onUpdate callback.
- Existing alignment, percentage sizing, alt editing, deletion and undo/redo remain.
- Both description fields retain independent state and text-length requirements.
  Descriptions still require meaningful text; image-only descriptions are not valid.
- Paste/import validation supports data URLs and legacy private media paths; arbitrary
  external image URLs remain unsupported. Gallery and URL insertion controls are gone.

## Shared configurable limits

`shared/notificationImagePolicy.json` is build-time configuration shared by Admin,
backend and mobile; deploy them consistently when adjusting it.

| Limit | Initial value |
|---|---:|
| Source bytes | 2 MiB |
| Source dimensions | 4096 × 4096 |
| Processed dimensions | 1200 × 1200 |
| Individual encoded data URL, including prefix | 500 KiB |
| Combined image data across both fields | 3 MiB |
| Complete request/content budget | 4 MiB |
| Images per field, including legacy images | 8 |

The proxy and Express raise the body limit only for notification creation/update;
other administrative requests retain their previous limits. The form checks total
content and image budgets before submitting. Server limits remain authoritative.

## MongoDB and security

No new collection, indexes or destructive migration. Existing `shortDescription`
and `description` Mixed fields now receive canonical sanitized **HTML strings** on
create/edit. Embedded image data lives in those strings with the text and formatting.
Legacy structured documents and private-media HTML remain readable and editable.

The server converts submitted content into allowlisted nodes, validates text/structure,
then serializes only those validated nodes back into HTML. Only JPEG/PNG/WebP data
URLs are accepted. Base64 must be canonical and nonempty. Sharp checks decoded format,
dimensions and frame count, then fully decodes bytes to detect truncated/invalid images.
Decoded dimensions are recorded in HTML. SVG/HTML data URLs, scripts, event handlers,
unsafe links and arbitrary image hosts are not allowed. Total embedded bytes and
image count are checked before the database transaction. Authentication, CSRF,
permissions, environment isolation, revision checks and recipient rules remain.

`mediaIds` contains only historical references. Legacy media records, storage settings,
upload/read APIs and recipient-authorized image reads remain intact. New embedded
images do not invoke `validateMediaContent` database lookups when no legacy IDs exist.

## Admin UI

Form sections: Notification Information, Recipients, Scheduling, Status, Actions.
IST dates, published audience/schedule locks and active status behavior remain.
Save and Cancel actions, responsive wrapping toolbar with icons/tooltips, readable
validation messages and local image preview are provided. Notification listing,
filters, pagination, View/Edit/Delete, soft deletion and targeting remain.

List responses use preview/metadata rather than full rich fields to prevent large
MongoDB facet documents; the existing detail endpoint supplies complete content.
No columns or list actions were removed.

## Mobile and offline

The mobile API continues to return structured rich documents, converting stored HTML
on read. Image nodes now support `src` data URLs alongside historical `mediaId`.
The native renderer displays bounded data URLs using React Native Image with server
validated aspect ratios, percentage width, alignment, alt text and error fallback.
There is no WebView or script execution. Legacy private images retain authenticated
fetching and online/offline placeholders.

Embedded data is part of the existing encrypted `record_json`; synchronized content
needs no separate image download offline. Account/session checks, read acknowledgements
and monotonic read-state merging are preserved. No SQLite schema migration or financial
cache rewrite is required.

Large-payload safeguards:
- Mobile fetches two full inbox records per request, keeping a ten-record display
  window; Load More continues through older records.
- Cached-content reconciliation handles up to eight records per refresh in two-record
  batches, retaining a keyset cursor across refreshes. Inactive/content changes to a
  large cache therefore converge over multiple refreshes, not all at once.
- Read acknowledgements still use their original bounded batches; pending read-state
  reconciliation splits rich responses into pairs.
- Backend pagination/count facets join lightweight campaign metadata; content is
  fetched in one bounded cursor, with an 8 MiB response budget. Requests exceeding
  that budget fail explicitly with 413, not an empty result. Older callers requesting
  many image-heavy records must request smaller pages.
- Encrypted notification cache has a 100 MiB per-account write budget. Crossing it
  rolls back that cache write and shows an explicit error. Existing content/read
  commands are preserved, not evicted. A user-facing cache-management workflow is not
  added here; large archives may need a separately approved retention policy.

## Changed files

Frontend:
- `website/src/components/admin/notifications/image-picker.tsx`
- `website/src/components/admin/notifications/tiptap-client.tsx`
- `website/src/components/admin/notifications/rich-editor.tsx`
- `website/src/components/admin/notifications/management.tsx`
- `website/src/app/admin/admin.css`
- `website/src/app/admin/api/[...path]/route.ts`

Backend:
- `server/src/notifications/embeddedImages.js` (new)
- `server/src/notifications/content.js`
- `server/src/notifications/html.js`
- `server/src/notifications/media.js`
- `server/src/admin/index.js`
- `server/src/admin/routes/notificationsRoutes.js`
- `server/src/services/notificationsService.js`

Shared/mobile:
- `shared/notificationImagePolicy.json` (new)
- `shared/notificationContent.ts`
- `src/NotificationContent.tsx`
- `src/api.ts`
- `src/offlineStore.ts`
- `src/useNotificationInbox.ts`

Documentation: this file and `docs/NOTIFICATION-TIPTAP-MIGRATION.md`.
Existing unrelated uncommitted changes were retained. No package changes were needed.

## Validation and release requirements

Passed: Admin TypeScript, mobile TypeScript, Admin production build (28 pages),
Android export (1425 modules), syntax checks of all seven changed backend JS files,
and whitespace checks. Android artifact is outside the repository at
`/private/tmp/dk-notification-base64-android`.

No authenticated browser, approved database or physical device verification was
performed. Immediate insertion, save/reopen, actual MongoDB contents, image fidelity,
legacy editing and offline encrypted-cache rendering still require runtime acceptance.
Builds do not establish those results. No real notifications were created.

Deploy backend, Admin and mobile support together before publishing image-bearing
notifications. Older mobile renderers do not understand embedded image nodes. Hosting
proxies must accept the 4 MiB notification-write budget; verify upstream hosting limits.
The existing publication infrastructure is still required and was not activated here.
New image insertion itself does not require media storage provisioning.

Rollback: retain a backend/mobile version able to read embedded images once records
have been saved. Rolling back to the old 30 KB/private-image-only parser would make
new content unreadable. Do not delete or rewrite records to force compatibility.
