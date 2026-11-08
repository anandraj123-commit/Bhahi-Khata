# Admin typography and readability

## Causes identified

The Admin stylesheet used a 14px base and dozens of independent 9–12px declarations for metadata, navigation labels, filters, tables and payment records. Buttons and inputs were forced to 12px with `!important`. Payment-specific and mobile rules reduced these sizes again. Geist was used in Admin, while the document body had Arial defaults and portaled dialogs/menus required their own font scope. Fixed topbar heights, narrow date inputs, non-wrapping navigation labels and table ellipsis could clip enlarged text.

No application-wide CSS scaling or inline component font-size rules were found in the inspected Admin components. An intentional monospace recovery-code style is preserved.

## Shared font loading

`website/src/lib/admin/fonts.ts` is the single Admin font loader. It uses the existing `next/font/google` strategy for variable Inter and Noto Sans Devanagari, with `display: swap`, Latin and Devanagari subsets. Next downloads and self-hosts the font assets at build time; no new font dependency or browser Google Fonts request is introduced.

The shared font-variable classes are applied to the Admin layout, body-portaled modal dialogs, mobile navigation drawer and profile menu. The CSS stack is Inter → Noto Sans Devanagari → system-ui → Apple/Segoe UI → sans-serif. The public website's existing root font setup is unchanged.

## Tokens and scale

All ordinary Admin font-size declarations now use shared rem-based tokens in `admin.css`. At a default 16px root:

| Role | Size | Weight |
| --- | --- | --- |
| Page title | 28px | 700 |
| Section/dialog title | 22px | 600 |
| Subsection heading | 18px | 600 |
| Card title | 16px | 600 |
| KPI amount | 26px | 700 |
| Body | 16px | 400 |
| Table header | 14px | 600 |
| Table body | 15px | 400 |
| Label | 15px | 500 |
| Input | 16px | 400 |
| Button | 15px | 600 |
| Navigation | 16px | 500 |
| Tab | 15px | 500–600 |
| Pagination | 14px | 500 |
| Secondary | 14px | 400 |
| Error | 14px | 500 |
| Eyebrow/status caption | 13px | context-dependent |

Reusable tokens cover font family, each semantic size, normal/medium/semibold/bold weights, and body/heading/control line heights (1.6/1.35/1.5). Original sub-13px ordinary UI sizes and font-size `!important` overrides were removed. rem sizes respect user font settings and browser zoom.

## Coverage and layout adjustments

The shared rules cover dashboard charts and cards, sidebar and header, Shop Details, all nine financial cards and their tables, customer management, subscription management, payment dashboard/tabs/tables, reports, audit logs, settings, login and password pages, forms, filters, pagination and dialogs.

- Navigation labels wrap; sidebar content can scroll without dropping items.
- Topbar grows with text instead of enforcing a fixed height; header actions and pagination wrap.
- Buttons/inputs have at least 44px height and readable line height.
- Table rows retain all columns, use comfortable padding and horizontal scrolling; cell content is not hidden behind ellipsis. Numeric payment cells remain intact.
- Date controls are wide enough for larger input text and can shrink within narrow mobile layouts.
- Form/detail grids collapse to one column on small screens; very narrow financial-card grids also become one column.
- Dialogs retain vertical scrolling and reserve title space for the existing close button; drawer width fits the viewport.
- Focus styles, text selection, dark-theme colors and existing contrast colors are preserved. No new navigation or hidden content was introduced.

These are typography and directly related spacing changes only. No event handler, permission, data query, API, financial calculation, database model or business rule was changed.

## Files modified

- `website/src/lib/admin/fonts.ts` (new shared loader)
- `website/src/app/admin/layout.tsx`
- `website/src/app/admin/admin.css`
- `website/src/components/admin/layout/shell.tsx` (font classes only)
- `website/src/components/admin/shared/ui.tsx` (dialog font classes only)
- `docs/ADMIN-TYPOGRAPHY.md`

## Validation and limits

Admin typecheck passed. The first sandboxed production build failed because it could not resolve `fonts.googleapis.com`; a permitted network-enabled build then downloaded the fonts and passed, generating all 20 static pages. Whitespace checking passed. No automated tests were created or run.

Source inspection confirms the font classes cover portal boundaries and no ordinary Admin font-size literals below 13px remain. Existing page components, controls, columns and click actions were retained. No production data, credentials, indexes or backend files were modified. No commit or push was made.

Authenticated visual review of every page, real Hindi shaping, all browser sizes, screen readers and 200% zoom remain unverified: no authenticated browser-control session was available. The CSS is designed to reflow and scroll at those sizes, but compilation and asset delivery are not proof of zero clipping. Deployment builds need access to the font provider (or an existing Next font cache); runtime browsers receive the self-hosted assets.

After the final build, the local frontend was restarted. Direct HTTP inspection confirmed the Admin login page and its updated typography stylesheet were served successfully. The self-hosted Inter Latin asset (48,432 bytes) and Noto Sans Devanagari asset (120,232 bytes, with U+0900–097F coverage in its CSS declaration) each returned HTTP 200. This verifies font delivery, not browser shaping or authenticated-page visual acceptance.
