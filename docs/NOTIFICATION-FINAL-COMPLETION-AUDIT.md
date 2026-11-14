# Final notification completion audit

10 November 2026. Reviewed existing audits and the uncommitted implementation before edits. Existing Admin CRUD, structured rich JSON, transactional publication leases, owner-scoped inbox, encrypted SQLite reads, optional push dispatch and provisioning templates must remain.

Confirmed gaps: editor is Tiptap rather than required CKEditor; schedules/forms and Admin timestamps use UTC; no image upload/storage route; native renderer has no images/tables; subscription push logs are not persistent readable inbox items; accepted Expo ticket IDs are discarded, preventing receipt polling. Existing announcement pushes conservatively exclude shared tokens. No reusable media upload infrastructure was found by source search. No deployment host or remote EAS credentials are verified.

Plan: CKEditor client-only adapter preserving legacy structured JSON; strict server HTML normalization; private MongoDB binary image collection with decode/re-encode validation; IST input conversion with UTC persistence; idempotent subscription inbox bridge; receipt state separate from device delivery; incremental private native media rendering. Existing routes/fields remain backward compatible. Explicit license configuration is required; GPL compliance is not assumed. No production activation, provisioning, pushes or automated cases.


## Completed source review and changes — 12 November 2026

- Confirmed no reusable image storage endpoint; added private, provisioned MongoDB media with size/type/decode checks and authenticated recipient access.
- Confirmed native renderer omitted images/tables; retained existing formatted documents and added maintained native HTML rendering with private in-memory image fetch.
- Confirmed Turbopack root excluded shared serializer: real production build failed module resolution. Root now covers only this repository, and the rebuilt Admin passed.
- Confirmed tickets were discarded; persisted protected ticket references and bounded receipt polling. Malformed ticket responses remain unknown rather than failed; receipt recovery runs even if dispatch fails.
- Confirmed global bell count includes server inbox only. Future subscription send events now get deterministic inbox identities. Existing OS-local reminders and historical push-only logs still have no safely unified identity/read state; this remains a feature gap, not claimed complete.
- Reviewed campaign status/time/owner checks for list/detail/unread/reconcile/media/push and publication; no future notification pre-download added.
- Existing payment routes, financial calculations, subscription activation, ledger synchronization and sidebar entries were not replaced. Builds retain all existing Admin routes. This source comparison is not full runtime preservation acceptance.
- License approval/configuration, remote metadata inspection, production provisioning, worker activation and real push acceptance remain outside this execution. No database or device-delivery evidence was obtained.

Current detailed evidence and exact release limitations are in `NOTIFICATION-FINAL-COMPLETION-REPORT.md`.
