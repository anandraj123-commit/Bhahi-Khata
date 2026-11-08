# Global customer ledger transactions

Implemented 8 November 2026. This is a read-only addition, separate from Cashfree payment monitoring.

## Navigation and preservation checklist

- Transactions is added after Customers in the existing sidebar, at /admin/transactions.
- Existing sidebar items retain their relative order and destinations.
- Existing Dashboard, Shops, Shop Details, all nine Financial Overview cards, Customers, subscriptions, referrals, Payments, reconciliation, administrator controls, reports, audit and settings remain.
- Existing Shop Details implementation is unchanged. Transaction shop links reuse /admin/shops/:id.
- Customer links reuse /admin/customers/:id, with additive contact/archive information and Created At/Updated At columns in its ledger table. Existing statements, filters and transaction dialogs remain.
- No financial write actions were added. Existing payment/webhook/refund logic, models and index declarations are unchanged.
- Source inspection and successful compilation support this checklist; authenticated interactive regression acceptance has not been performed.

## API and authorization

New GET endpoints (Express /api/v1/admin, frontend proxy /admin/api):
- /transactions: listing and matching summary in one aggregation response.
- /transactions/:id: a genuine MongoDB ledger entry ID, detailed allocations and existing customer financial summary.

Both require ALL of shops:read, customers:read, customers:financial:read and customers:transactions:read, behind existing trusted proxy, admin session authentication and rate limiting. The page and sidebar apply the same permissions. Existing roles with these global read permissions can view all shops; no new permissions are granted. Existing /customer-shops supplies the searchable shop selector.

The frontend proxy explicitly allowlists both routes and rejects non-GET methods. Successful reads use existing audit logging. Reading may update admin-session/audit bookkeeping but never customer balances, payment state or financial records.

The backend validates IDs, date ordering, amount ordering, page limits, enums and sort fields. Literal search escapes regex metacharacters and caps input length at 100 characters. Customer joins and chronology partitions include both shopId and customerClientId: a customer client ID in another shop cannot contribute to this customer's balance. Only explicitly projected fields are returned; no user credential documents are joined.

Response data:
- rows: at most 20, 50 or 100 actual ledger records.
- summary: total row count and paise amounts udhari, received, recovered, deposited, refunded, used.
- opening: separate opening contributions for the same shop/customer scope, or null when transaction-level filters make that comparison inapplicable.
- page, limit.

Detail response: transaction and currentCustomer (existing financial summary).

## Accounting

The shared chronology function in shopFinancials.js remains the accounting source. Its arithmetic and opening-event order are unchanged. Its shop restriction is optional only for this permission-protected global view; existing shop calls still supply a validated shop ID.

Actual ledger types:
- credit: Udhari; available advance may settle part of it.
- payment: money received, split into recovery of positive outstanding and excess advance deposit.
- refund: customer advance refund, never a Cashfree refund.

All seven summary cards aggregate the matching dataset on the server, not the current page. The seventh is Advance Used (credit covered by prepaid balance), not a misleading total of debit and credit flows. Allocations are computed before transaction/date filtering so earlier entries still establish the correct balance.

Opening balances are not invented transaction rows. The cards are explicitly transaction contributions. For unfiltered transaction scope, the expandable opening contribution breakdown explains how adding openings reconciles the financial cards with Home/Shop Financial Overview for the same live customer scope. Archived/disabled/removed customers with non-deleted records remain in the accounting scope. Tombstoned customers and entries are excluded, consistent with the overview.

The transaction dialog labels previous/updated balances as reconstructed from the current chronology, not stored historical snapshots. Current customer balances have a separate section. Later edits can alter reconstructed allocations. No timestamp is synthesized; missing values show an em dash.

## Interface

- Seven compact summary cards, global search debounced 350 ms, advanced filters and removable chips.
- Shop selector (up to 50 search matches, with exact-ID entry for unambiguous selection), shop name/mobile, customer ID/name/mobile/address/lifecycle/archive.
- Exact transaction ID and payment method; actual stored types and recorded/conflict-resolved statuses.
- Minimum/maximum INR amount; with/without notes; initial versus later server revision.
- Independent transaction date, Created At and Updated At ranges. Today, Yesterday, 7/30 Days, This/Last Month presets apply to the chosen date field.
- UTC date boundaries are explicit. Business dates remain stored YYYY-MM-DD; timestamp range ends are exclusive next-day midnight.
- Ascending/descending sorting by transaction date, timestamps, amount, type, shop name and customer name. Mongo _id is the deterministic final tie-breaker.
- Default page 1 / 20 rows, options 20/50/100, numbered navigation, previous/next and record range.
- URL query retains filters/page/sort for browser back and direct links. The View modal leaves the listing context intact.
- All 14 requested table columns, including Created At/Updated At, responsive horizontal scrolling, existing typography tokens and currency formatter.
- Loading skeletons, distinct API errors, refresh/retry, successful-empty state only after a response. Refresh failure is identified when cached data remains visible.
- Existing customer page remains the full ledger drilldown; contact and actual timestamp presentation are additive.

## Unsupported source data

No online/offline origin flag, transaction actor, reliable reversal relation or payment-source enum exists in this ledger model. Server version greater than 1 is labeled as a revision, not asserted to be a manual correction. The free-form stored reference is shown without claiming it is a reversal. No invented statuses, methods, source filters or historical snapshots are provided. Shop has no native lifecycle status field; an owner's account status is not presented as shop status. Deleted records remain available only through existing authorized customer ledger workflows, not this live financial summary.

## Performance and deployment

- No browser-side pagination, N+1 application queries or complete-ledger arrays.
- Shared MongoDB window aggregation supports disk spilling outside facets; summary, page and opening breakdown use one flat facet.
- Shop ID is applied at the first match. Customer predicates and shop name/mobile predicates run before the window where safe. Transaction predicates run after allocations to preserve accuracy.
- Aggregate execution is capped at 10 seconds, detail preliminary reads at 5 seconds, behind the existing 300/minute admin limiter and 15-second frontend proxy timeout.
- Existing shop/date, shop/customer/date and unique shop/client indexes are reused. No indexes were created or modified.
- Unfiltered global accounting still scans live ledger history. Partial substring search cannot generally use a standard B-tree index. Deep offset pages and broad cross-shop summaries need representative MongoDB explain/latency acceptance before claiming million-record performance. Narrow by shop when necessary.
- Before large-scale rollout, evaluate a separately approved materialized allocation/reporting design and search index. Do not add an arbitrary global date index expecting it to accelerate historical allocation windows.
- Backend must load the new router/service, and the frontend must use the new build. Backend was not restarted here because startup can launch reconciliation workers. Local frontend alone was restarted to avoid stale Next manifests. Deploy/reload backend through the existing controlled process.

## Validation actually performed

- Admin npm run typecheck: PASS.
- Admin npm run build -- --webpack: PASS; /admin/transactions appears in build route manifest.
- node --check: PASS for admin index, new transactions router/validator/service, shared shopFinancials and customer service.
- git diff --check: PASS.
- Local production frontend restarted on port 3000.
- Manual unauthenticated HTTP: /admin/transactions responds with the protected page shell; GET /admin/api/transactions returns 401 ADMIN_SESSION_REQUIRED with backend request ID; POST is rejected 405 by the proxy. This establishes proxy/auth behavior, NOT authorized database results or new router runtime acceptance.
- No browser automation tool/authenticated browser session was available. No MongoDB records were read or written for acceptance. No disposable database was created.
- No automated tests created or run. No production financial data, indexes or credentials changed. No commit, push or deployment.

## Remaining manual acceptance

After controlled backend reload, sign in as an authorized administrator:
1. Open Transactions directly and through the sidebar; inspect desktop, tablet, mobile and keyboard focus behavior.
2. Verify returned database rows and detail responses, including same client IDs in different shops.
3. Compare shop-filtered transaction contributions plus opening breakdown to the existing financial overview, including backdated entries, edits and archived customers.
4. Exercise all filters together, date boundaries, sorting and 20/50/100 pagination; verify browser back restores the query.
5. Open customer and shop links and confirm all original controls remain accessible.
6. Verify denied roles, expired sessions, backend failures, empty responses and refresh failure states.
7. Measure broad and deep-page queries against representative approved data; verify timeout behavior and query plans.

Authenticated rendering, real database aggregation results and large-data performance remain unverified.

## Filter interface enhancement — 8 November 2026

The listing now uses a reusable TransactionFilters component with a compact primary toolbar: global search, server-searched Shop dropdown, actual transaction type, date preset, Advanced Filters and Reset. Advanced controls are grouped into Customer, Transaction, Date, Sorting/Display and Additional Shop filters. All original query parameters remain available.

- Shop dropdown uses the existing authorized /customer-shops endpoint, at most 50 results per request, with loading, retry and no-match states. The endpoint now also searches phone and exact Mongo shop ID without changing its response structure. Selected shop names are resolved by ID, including when restoring URL state. Keyboard Tab, Enter and Escape are supported with native controls and buttons.
- Payment Method uses the mobile app's existing Cash, UPI, Bank and Other options (App.tsx), plus a custom stored-value input to retain free-form historical method filtering. No new backend enum is imposed.
- Transaction types remain credit/payment/refund. No fake recovery/deposit/adjustment types or unsupported shop lifecycle filter is introduced.
- Native date pickers appear for Custom Range. Presets and inclusive UTC end-date semantics are unchanged. Transaction, Created At and Updated At ranges remain independent and combinable via the Date Field selector.
- Negative/non-finite/out-of-bounds amounts, reversed amount ranges and invalid/reversed date ranges block automatic requests and manual refresh. Inline messages explain corrections; backend validation remains intact.
- Removable chips use friendly labels, selected shop names, date presets/ranges and INR amount ranges. Advanced Filters shows the active chip count.
- Reset/Clear removes filters and resets page 1 while retaining sort field, direction and page size. Sorting and page-size dropdowns are added alongside existing table sorting and pagination.
- Responsive grouped grids, consistent 44px controls, shared typography/colors, focus states and a scrollable shop results menu replace the long ungrouped form. No new UI libraries.
- Seven cards, transaction table/detail dialog and customer/shop links are preserved.

Changed for this enhancement: website/src/components/admin/filters/transaction-filters.tsx (new), website/src/components/admin/tables/transactions.tsx, website/src/app/admin/admin.css, server/src/admin/services/customers.js, and this document.

Validation: Admin typecheck, production build, backend customer-service syntax and git diff whitespace checks. No automated tests created or run. Browser interaction and authenticated database responses remain unverified. Reload the backend through the existing controlled process to enable the additive phone/ID shop search; this task does not restart payment workers or modify financial records.

## Opening Balance Summary presentation — 8 November 2026

Replaced the inline opening-contribution disclosure with Opening Balance Summary, an initially expanded, accessible Show Less / Show More section. Its collapsed header retains the short customer-history description.

The section explains what opening balances are, why they differ from transaction totals, that they do not increase transaction count, and the requested ₹3,000 opening / ₹2,000 subsequent credit example. Six responsive icon cards display the existing udhari, received, recovered, deposited, refunded and used opening aggregation fields through the shared INR formatter. No combined financial total is calculated.

The category-overlap note cautions against adding the six values as total cash. A comparison panel explains matching shop/customer/date/accounting scope. Shop/customer-filtered contributions are explicitly labeled all-time within that filtered scope. Transaction-level filters that return opening:null show an availability explanation, not zero-valued cards. Pending/failed refresh and invalid-filter states retain their cautionary labels.

Files changed for this presentation: new website/src/components/admin/tables/opening-balance-summary.tsx; integration in website/src/components/admin/tables/transactions.tsx; scoped styles in website/src/app/admin/admin.css; this document.

Backend aggregation, authorization, transaction counts, seven main cards, filter parameters, table, navigation and detail actions are unchanged. No synthetic transactions or database changes. Validation uses Admin typecheck, production build and git diff --check only; authenticated browser/device visual acceptance remains unverified.
