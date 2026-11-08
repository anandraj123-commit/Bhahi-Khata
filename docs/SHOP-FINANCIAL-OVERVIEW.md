# Shop Financial Overview

Implemented as an additional section directly below the shop heading and All shops navigation, before Shop profile and Current subscription. No automated cases, mocks, fixtures, or frameworks were created or executed. No database records or indexes were changed.

## Preservation checklist

Source comparison confirms the following original components remain in their original order, with their existing implementations, permissions, APIs, and controls:

- Shops directory: search, status/plan/date filters, sorting, pagination, shop links.
- Shop heading, account badge, All shops navigation, loading skeleton and retry/error handling.
- Shop profile: identifiers, customer counts, owner, registration and permitted contact details.
- Current subscription, dates, recorded status and Free-plan explanation.
- ShopCustomers: lifecycle statistics, customer links, table and pagination.
- Subscription ResourceTable: search/filter/sort/pagination and recent subscription history with empty state.
- PaymentOrders and payment ResourceTable, their existing controls and permission gates.
- Existing restriction notice and all existing customer detail/statement/export workflows.

Only the obsolete heading description that said ledgers were not exposed was updated. Financial Overview appears near the top; opening its details replaces only its own card grid. No existing section is conditionally hidden by this interaction. Existing customer details can open in a separate tab; clicking a customer name opens that exact customer's ledger within the added section.

This is a source-level preservation check, not a claim of browser acceptance.

## Files

- `server/src/admin/services/shopFinancials.js`: scoped chronological aggregation and server-side record queries.
- `server/src/admin/validators/shopFinancials.js`: strict validated financial filters.
- `server/src/admin/routes/readRoutes.js`: additive authorized/audited GET routes.
- `website/src/app/admin/api/[...path]/route.ts`: adds only the two new route names to the existing proxy allowlist.
- `website/src/components/admin/tables/shop-financial-overview.tsx`: cards, filters, drilldowns, pagination and formatting.
- `website/src/components/admin/tables/shop-detail.tsx`: top-positioned permission-gated section and accurate heading description.
- `website/src/app/admin/admin.css`: scoped responsive styling, including existing light/dark panel colors.
- This document.

## API contract

Existing contracts are unchanged. Both new responses use the existing `{ data: ... }` envelope:

- `GET /admin/.../shops/:id/financial-overview`: shop metadata and nine card totals/counts.
- `GET /admin/.../shops/:id/financial-records?view=...`: shop metadata, rows, matching total, filtered monetary amount, page and limit.

The route paths relative to the existing backend admin router are `/shops/:id/financial-overview` and `/shops/:id/financial-records`; the website proxies them under `/admin/api/shops/:id/...`.

Views: `recent`, `outstanding`, `udhari`, `received`, `recovered`, `availableAdvance`, `deposited`, `refunded`, `customers`.

Existing trusted-proxy, session authentication, rate limits and admin error handling apply. All four existing permissions are required: `shops:read`, `customers:read`, `customers:financial:read`, `customers:transactions:read`. SUPPORT receives no new access. Financial reads are audited without logging search strings or ledger contents. All branches and customer joins constrain shop ID. These endpoints contain no financial mutation; audit recording is the only write.

## Accounting

The source of truth for Home definitions is `src/model.ts` (`customerFinancialSummary`, `financialSummary`), with wire timestamp/phone normalization from `server/src/utils/serializers.js`. Existing customer financial APIs are retained unchanged. The shop implementation expresses the same chronology as MongoDB window operations, rather than invoking the existing single-customer service once per customer.

- Work in integer paise. Sort entries by business date, recordedAt (createdAt wire fallback, then business-day midnight), and client ID. Apply opening at midnight before equal-time entries.
- Opening Udhari contributes to cumulative Udhari. Opening advances contribute to money received and advance deposited. The smaller opening amount contributes to recovered Udhari.
- Credit contributes to Udhari and consumes any available advance; payment contributes once to received, with the due-covered portion in recovered and remainder in deposited; refunds increase net balance and contribute to refunded.
- Current outstanding is positive net balance; available advance is negative net balance expressed positively. Sum each customer's positive balance separately, never offset one customer's debt against another's advance.
- Preserve Home's existing opening reset semantics, including entries sorted before the opening event. Stored allocation fields are deliberately not summed: the ledger service and Home use different opening handling for backdated entries. No existing accounting logic was changed.
- Apply transaction/date/contribution filters **after** chronological allocation. Filtering out earlier payments must not change a later receipt's recovery allocation.
- Tombstoned entries/customers are excluded. Disabled, removed and subscription-archived customer profiles remain in financial totals, matching the Home reducer. Resolved conflicts use the current authoritative stored version; conflict audit records are not additional monetary entries.
- Recent Transactions counts actual non-deleted entries, excluding synthetic opening presentation rows. Credit rows expose advance adjustments; payment rows expose recovered and deposited portions without duplicating transactions.
- Opening contribution rows are explicitly labeled `opening`, reference their customer, and use actual customer timestamps. They are not inserted into the database or counted as payment transactions.
- Recovery is not increased by credit funded from advance, matching Home. The available-advance table shows credit-funded advance use separately. Opening offset and legacy opening resets can also affect available balance.
- The Customers card intentionally counts all non-deleted profiles as requested. Mobile Home's Customers count is active-only; the UI explains this difference. The monetary definitions remain the same.
- Customer ledger refunds are entirely separate from Cashfree subscription refunds.

All nine tables show contact information and actual created/updated timestamps. Missing timestamp/method/note values display Unavailable. Running balances are explicitly labeled **calculated**, not claimed to be stored historical snapshots. Transaction dates retain the stored business date; timestamp displays use the existing admin UTC convention. Available Advances is a customer balance view; its last-activity date includes advance use, deposits and refunds.

## Search, filters, sorting and pagination

All filtering is performed by MongoDB. Text inputs are debounced 300 ms, trimmed and length-bounded, and regex metacharacters escaped. Supported inputs:

- Combined search and individual partial customer name, mobile, address and customer ID.
- Customer lifecycle and separate subscription-archive classification.
- Exact customer context for customer-name drilldown (never partial ID matching).
- Transaction ID, actual type (`credit`, `payment`, `refund`, explicit opening presentation), method, contribution minimum/maximum and recorded/conflict-resolved/opening status.
- Positive-only outstanding/advance, minimum and maximum current balance on customer views.
- Business date range; customer views use last transaction date. Today, yesterday, last 7/30 days, this/last month and custom presets use UTC calendar boundaries.
- Independent Created At and Updated At ranges; inclusive selected end days use next-day exclusive UTC comparisons.
- Allowlisted name, contribution, outstanding, available advance, business date and created/updated sorting, ascending/descending. Stable customer/client identifiers break ties.

Default page 1 and size 20; accepted sizes only 20/50/100. Database `$facet` computes matching count, monetary total and a `$skip`/`$limit` page. No browser-side pagination or filtering. Filters reset page 1, remain during pagination, and Clear All resets the view. Pagination includes previous/next, nearby page numbers and first/last numbers, and showing X–Y of Z. Summary card totals remain visibly distinct from filtered totals. Recent gross transaction amount is labeled as gross, not net cash flow.

## Performance and deployment

Requires MongoDB 5.0+ for `$setWindowFields` and concise lookup pipelines. Verify deployment version before rollout. Initial matches use the existing shop-scoped Entry indexes and Customer `{shopId, clientId}` index. Customer joins remain shop-scoped; exact customer drilldowns narrow both streams. Customer-only predicates run before window calculations. One aggregate computes each result, with no per-customer application queries and no complete-ledger arrays sent to Node or the browser. Disk spill is permitted for window/sort stages. Queries are bounded to 10 seconds, inside the existing 15-second admin proxy timeout.

No new indexes are proposed without explain-plan evidence; none were created. Existing index installation procedures remain unchanged. Exact chronology still requires processing the selected shop's relevant history. Million-row performance has not been measured; at scale, inspect explain plans and latency before rollout. Current correctness cannot be replaced with naive sums of stored allocation fields. A future materialized summary would need reliable invalidation for edits, opening changes, deletions and conflict resolutions; it is not introduced here.

## Validation and outstanding acceptance

Executed successfully on Node 22.23.4:

- Root `npm run typecheck`.
- Website `npm run typecheck` (including a repeat after build).
- Website `npm run build -- --webpack`: production compilation, TypeScript and all 20 static pages completed.
- `node --check` on the added backend service, validator and modified route.
- `git diff --check`.

No automated suites or database-backed checks were run. No backend server was started, database index installed, production data altered, payment made, commit created or push performed.

Remaining acceptance: run the feature against an approved development MongoDB 5.0+ deployment; inspect all nine views in a browser with authorized and unauthorized roles; compare a fully synchronized mobile account with admin totals; review opening/backdated records, edited/deleted/resolved records, archives and refunds; exercise date boundaries, filters and all pagination sizes; inspect keyboard focus and small-screen/dark-theme layouts; confirm existing shop/customer/subscription/payment workflows; measure aggregation latency on representative large shops.

The admin cannot display unsynchronized device-only operations. Concurrent server changes can cause a newer detail response to differ from the previously loaded overview; Refresh reloads both. Offset pagination is deterministic for an unchanged dataset but does not freeze a snapshot across separate requests during concurrent edits. Missing historical timestamps are not repaired or fabricated. Browser/database acceptance and production-scale performance remain unverified; this document does not claim production acceptance.

## Visibility correction

The route `website/src/app/admin/(console)/shops/[id]/page.tsx` already imports and renders `ShopDetail`; `ShopDetail` already imported Financial Overview. The original placement was below every customer, subscription and payment table. Missing financial permissions silently omitted the entire section, and loading or failure of the overview request replaced all nine cards. These are confirmed source-level visibility problems; the actual affected browser session and backend response were not available to establish which condition the user encountered.

The existing overview now appears directly below the Shop Details heading at `/admin/shops/:id`, before the profile/subscription row. Existing sections retain their relative order. Financial permissions remain mandatory; restricted users see a clear access explanation instead of an absent section. Authorized users see all nine existing clickable card links during loading and overview errors, with Loading or Unavailable values rather than fabricated zeros. Existing error/retry handling remains visible, and record queries remain independently available. No accounting, route authorization or drilldown behavior was changed.

Files changed for this correction: `shop-detail.tsx`, `shop-financial-overview.tsx`, and this document. No browser-control tool or authenticated browser session was available, so actual rendered-page and database-backed interaction acceptance remains unverified.

## Explicit overview button

The actual Shop Details component now includes a primary **Shop Financial Overview** button alongside **All shops** at `/admin/shops/:id`. The header actions wrap on smaller screens using the existing responsive heading layout. The button scrolls to and focuses the existing financial region and asks the mounted overview to return to its nine-card grid. It does not remount the overview, duplicate APIs or change any detailed-table implementation. All original profile, subscription, customer and payment sections remain intact.

The button and financial region are independent of the shop-profile request's loading/error branch. Restricted roles retain the visible button, which focuses their explicit access-denied explanation; financial queries remain permission-gated. Existing overview API error handling leaves all nine card links available with unavailable totals. The button also returns from a card drilldown to the overview without changing the selected shop.

Files changed for the button addition: `website/src/components/admin/tables/shop-detail.tsx`, `website/src/components/admin/tables/shop-financial-overview.tsx`, and this document. Admin typecheck, production Webpack build (all 20 static pages), and whitespace validation passed. Actual authenticated browser interaction remains unverified because no browser-control tool was available. No automated tests were created or run.

## Running-server investigation: confirmed stale production process

The later visibility investigation traced the actual navigation:
`AdminShell` Shops link → `/admin/shops` → `ResourceTable` shop-name link →
`/admin/shops/:id` → `app/admin/(console)/shops/[id]/page.tsx` → `ShopDetail`.
No alternate Shop Details implementation was found. The button is unconditional;
only financial content is permission-gated. The inspected responsive rules do not
hide this button, and the Admin response has `private, no-store, max-age=0`.

Confirmed local environment: branch `main`, directory
`/Users/anandraj/Desktop/Digital-Khata/website`. Port 3000 was a `next start`
process launched on November 8 at 02:07, before the subsequent builds. A separate
port 3100 development frontend and port 4101 old test-harness backend had been
running since October 31. Neither old harness process was started, exercised as a
test suite, or modified in this investigation. The configured website origin is
`http://localhost:3000`, with the application backend on port 4000.

**Before restart:** the live port-3000 Shop route referenced
`page-2b7ebf58ac708ed8.js`, while the current production build contained
`page-00333aa5ef92b9f9.js`. The old referenced asset returned HTTP 500 and a request
for the current asset returned HTTP 404. This confirms a stale running production
server with outdated asset routing; rebuilding without restarting was insufficient.
Prior compilation-only reports did not identify this runtime mismatch.

**Action:** Admin typecheck and production Webpack build passed. Only the local
port-3000 frontend was stopped and restarted from the current website directory
using Node 22.23.4. No application code needed another button or route change.
The backend, databases, permissions, financial calculations and existing UI were
not changed. No automated tests were created or run.

**After restart:** the running Shop route references
`page-00333aa5ef92b9f9.js`; that asset returns HTTP 200 and its bytes match the
current build. It contains the Shop Financial Overview button, the
`aria-controls` target `shop-financial-overview-panel`, the `showOverview` action,
All shops, and all nine card labels. The unauthenticated route still requires
login. `git diff --check` passed.

**Verification boundary:** these are direct HTTP/runtime-asset observations, not
an authenticated browser-render assertion. No browser-control tool or authorized
browser session was available. The user's actual browser URL was requested but
not yet supplied at the time of this report. The confirmed local stale-server
problem is resolved; visibility and click behavior in the user's authenticated
session remain unverified, especially if that session uses another origin.

Files changed during this investigation: this document and `website/README.md`
(local production restart instructions). Earlier application modifications remain
intact. No commits, pushes, production data changes or remote deployment occurred.
