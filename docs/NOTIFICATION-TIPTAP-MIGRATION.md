# Notification editor migration to Tiptap

12 November 2026. This is an additive editor/media enhancement, not a notification-system rebuild. No database migration or production record/index changes were performed.

## Audit and compatibility

The prior Admin editor used CKEditor 49.1 and its React adapter. Both fields passed HTML to the backend, which normalizes it into bounded rich-document JSON. Media already lived in the private `notificationmedia` collection. Mobile consumed the same structured content through its escaped HTML/native renderer. Existing scheduling, targeting, read state, caching, workers and push processing were reusable and were not replaced.

Tiptap 3.33.1 React/StarterKit/ProseMirror, Image, TextAlign and Table extensions are now used. The installed React package peer range includes React 19; Admin uses React 19.3 and Next 16.4.2. A custom toolbar avoids a prebuilt UI dependency. All 31 installed @tiptap packages declare MIT. No Pro extension, cloud service, API key or GPL editor package remains. CKEditor dependencies/imports/configuration were removed. MIT notices are retained in `TIPTAP-LICENSE-NOTICE.md` and `website/public/licenses/tiptap.txt`; package license files remain intact.

Both fields have independent editor state, client-only loading and immediatelyRender=false. Required title/content lengths and backend size/depth/node limits remain. A failed legacy import disables saving instead of replacing its content with a blank document.

## Toolbar

Bold, italic, underline, paragraphs/headings 1–3, lists, safe HTTP(S) links, left/center/right/justified text, quotes, simple tables, undo/redo, remove formatting and Insert Image are available. Table controls add/delete rows/columns and delete tables; merged cells and custom column widths are not silently imported. Images offer left/center/right alignment, percentage sizing (10–100%, retaining existing intermediate percentages), alternative text and deletion from the document. Deletion does not delete the shared media record. Width changes preserve aspect ratio.

## Image selection

- **Upload Image:** computer file picker, local preview, JPEG/PNG/WebP, 2 MiB bound, upload progress/errors, authenticated existing upload endpoint and cursor-preserving insertion. The backend continues decoding/re-encoding images and validating dimensions/content. Upload timeout advises checking the gallery before repeating an upload.
- **Choose from Gallery:** authenticated, current-environment media; lazy-loaded private thumbnails, escaped filename/ID search, debounce, stale-response cancellation and server pagination (20 per page). Existing images insert by reference without another upload. Older images without filenames remain available/searchable by ID. No collection provisioning returns an explicit error, not a misleading empty gallery.
- **Insert Image URL:** accepts relative or same-origin absolute `/admin/api/notification-media/<id>` URLs. Credentials, query strings, fragments, unsafe schemes and other hosts/paths are rejected. The existing record is verified through the authorized gallery API before insertion. Arbitrary external URL download/import is intentionally unsupported; upload those files first. No SSRF-capable fetcher or public media hosting was introduced.

Gallery thumbnails currently use bounded existing image files rather than a new thumbnail-storage pipeline. Lazy loading and page size limit requests; a dedicated thumbnail optimization remains optional for very large galleries.

## API and data changes

Added read-only `GET /api/v1/admin/notification-media` with q, page and limit. Existing notifications:read permission and APP_MODE filtering apply. Queries project only ID/name/dimensions/size/date, allow 20/50/100, cap page at 500, escape regex and enforce a 10-second database query limit. Sorting is createdAt descending then _id descending. No indexes were created; filename search is bounded by input and execution time but is not full-text indexed.

Existing upload optionally stores a validated filename supplied via x-notification-filename. The proxy forwards this header only for that upload and allows GET on the gallery collection path. No existing API contract was removed.

Structured content adds allowlisted paragraph/heading textAlign and image align attributes. Existing widthPercent/mediaId remain. Server sanitization accepts only those formatting attributes and private image references; each referenced image is checked against the current environment. Existing mobile media ownership/scheduling checks remain unchanged.

## Legacy content and mobile behavior

Supported CKEditor HTML is imported into the Tiptap schema. Figure image sizing and alignment are carried to image attributes; caption text is retained as an adjacent paragraph, matching the existing stored-document representation. Lists, links, headings, paragraphs, images and simple tables remain. Unknown nodes/marks, scripts/event handlers, unsupported styles, merged cells, custom column widths and non-default list starts are blocked for review rather than silently discarded. Existing JSON is checked before conversion.

Admin View supports legacy HTML through a read-only schema-based renderer, not direct HTML injection. Mobile API responses normalize legacy HTML in memory; nothing rewrites stored records automatically. New content continues using the existing normalized JSON format. Native rendering preserves new alignment and percentage image sizes, plus existing private-image fetch/offline placeholders. Cached text/read state/encryption were not changed. Remote images are still not guaranteed offline.

## Files changed in this task

Frontend:
- website/package.json and package-lock.json
- website/src/components/admin/notifications/tiptap-client.tsx (new)
- website/src/components/admin/notifications/image-picker.tsx (new)
- website/src/components/admin/notifications/rich-editor.tsx
- website/src/components/admin/notifications/management.tsx
- website/src/components/admin/notifications/ckeditor-client.tsx (removed)
- website/src/app/admin/api/[...path]/route.ts
- website/src/app/admin/admin.css
- website/public/licenses/tiptap.txt (new)

Backend/shared/mobile:
- server/src/admin/routes/notificationsRoutes.js
- server/src/notifications/media.js
- server/src/notifications/html.js
- server/src/notifications/content.js
- server/src/services/notificationsService.js
- server/deploy/notifications.env.example (obsolete license template removed)
- shared/notificationContent.ts
- src/NotificationContent.tsx

Documentation: this report, TIPTAP-LICENSE-NOTICE.md, notification management/completion/readiness documents. Earlier uncommitted work is preserved, not attributed to this migration.

## Validation and limitations

Admin typecheck, Admin production build, mobile typecheck, Android export and syntax checks for all five changed backend files passed. Android export bundled 1,424 modules. Git diff whitespace check passed. The first typecheck found an optional-callback invocation error; corrected before successful validation. No automated cases, mocks or suites were created/run.

Authenticated browser editing, actual upload/gallery operations against MongoDB, native device rendering and round-trip editing of real historical records remain unverified because no approved authenticated/runtime data access was available. Existing notificationmedia provisioning is still required before upload/gallery use. No backend worker was started and no notification/push was sent. The local frontend alone was rebuilt/restored. No production changes, commits or pushes occurred.

This removes the CKEditor licensing/configuration blocker. It does not claim to resolve unrelated notification lifecycle gaps or establish production readiness.


## Insert Image follow-up — 13 November 2026

Source inspection confirmed that all three picker paths closed without checking
Tiptap's insertion result. Upload and gallery callbacks also left insertion
exceptions unhandled. This hid insertion failures; it does not establish which
failure occurred in the reported authenticated session. The editor now returns
its command result, preserves both selection endpoints, and updates the document
without requesting focus inside the nested image dialog. All paths catch errors
and close only after a successful command. A confirmed upload reference is retained
for insertion retry without uploading the same file again.

URL validation previously used the first 20 results of a filename-or-ID gallery
search. Matching filenames could displace the requested record; uppercase hex IDs
also failed the frontend's case-sensitive comparison. URLs now normalize IDs and
use authenticated GET `/admin/api/notification-media/:id?metadata=1` (proxied to
`/api/v1/admin/notification-media/:id?metadata=1`). This additive metadata response
uses the existing notification read permission and environment-scoped exact-ID
lookup, excludes image bytes, and leaves normal private image GET responses intact.
External hosts, credentials, query strings and fragments in pasted references
remain rejected. Gallery search and pagination remain unchanged.

Gallery and URL failures now tolerate non-JSON error responses and distinguish HTTP
401, 403, 404, 413, 415, 500 and 503. Existing storage-not-provisioned diagnostics
are preserved. Upload success is accepted only after the backend returns its stored
reference. Optional alternative text still populates `alt`; existing-image editing,
sanitization, stored media IDs, and mobile rendering remain unchanged.

Files changed for this follow-up:
- `website/src/components/admin/notifications/image-picker.tsx`
- `website/src/components/admin/notifications/tiptap-client.tsx`
- `server/src/admin/routes/notificationsRoutes.js`
- This document.

Runtime limits: no authenticated upload, gallery, insertion or notification
save/reopen was performed. No storage collection/index provisioning, production
record changes, pushes, backend/worker starts, tests, commits or pushes were performed.
The configured private MongoDB media storage must be provisioned through the existing
approved deployment procedure and support the upload transaction. Deploy frontend
and backend together for the metadata query contract. Physical mobile rendering is
unchanged and not reverified. The reported runtime failure cannot be conclusively
attributed without an authenticated failing request or reproduction.

Follow-up validation: Admin `npm run typecheck` passed; backend `node --check
server/src/admin/routes/notificationsRoutes.js` passed; `git diff --check` passed.
Admin `npm run build` initially hit a sandbox port-binding error that persisted in
Turbopack's cache. After moving `.next` to a temporary backup and retrying outside
the sandbox, the production build passed (28 pages). No browser tool or authenticated
session was available, so these are static/build results, not image workflow acceptance.

## Current image policy — embedded images (13 November 2026)

The owner has replaced the gallery/private-upload workflow for **new** editor images
with local Base64 embedding. Earlier gallery and upload descriptions above are
historical. Only Upload Image remains in the active editor. Legacy media references
and APIs are retained. See [Base64 implementation](NOTIFICATION-BASE64-IMAGE-IMPLEMENTATION.md)
for storage format, security, configurable limits, mobile/cache changes, validation,
and coordinated deployment requirements. No migration of existing records was run.
