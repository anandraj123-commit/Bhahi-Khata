# Automated testing infrastructure removal

Date: 8 November 2026.

The project owner intentionally postponed automated testing until the final development stage. Root `AGENTS.md` records that no automated cases, fixtures, frameworks, coverage requirements or suite execution should be introduced until explicitly requested. Typechecks, syntax checks, import inspection and application builds remain available.

## Removed

- 46 automated case files across mobile, backend, Admin, payments, subscriptions, localization, security and offline functionality.
- 5 directories, counting nested helpers/Admin directories: the root testing tree, its helper directory, the website testing tree and its Admin directory, and the backend Admin testing directory.
- 4 test-only fixture/harness utilities and the Playwright configuration.
- 2 reports: the generated missing-localization-key report and the old subscription validation report. Architecture/security audits remain as historical engineering documentation, with retired commands removed and a clear current-policy notice.
- 6 package scripts: customer-icons, subscription-security, environment, payments, subscriptions and Admin automated runners.
- Direct dependency `@playwright/test`, plus its now-unused `playwright` and `playwright-core` packages. Admin lockfile regenerated with npm; no Playwright package entries remain.
- Obsolete coverage ignore configuration and executable documentation references to removed infrastructure.

No testing CI workflow or other first-party testing-framework configuration was found.

## Preserved

- All application/business-logic source files have the same content hashes as at the start of this cleanup.
- The read-only startup diagnostic remains available. Its shared TypeScript loader was relocated unchanged to `server/scripts/lib/loadTs.cjs`; only the diagnostic's import path changed.
- Runtime environment validation, deployment configurations (including the testing deployment environment), database migrations/index-management commands, authorization and payment security protections remain intact.
- Development, production, lint, typecheck and Android build/export commands remain available.
- Expo/Metro require Jest-named worker/validation utilities and related types transitively. These are build-tool dependencies, not unused project test frameworks, and were retained. Third-party package contents were not indiscriminately stripped.
- Next's optional Playwright peer declaration remains vendor metadata; the optional package is absent.

## Validation performed — no automated suites

- Mobile typecheck: PASS.
- Android export: PASS.
- Admin typecheck: PASS after serial route-type generation.
- Admin production build using the supported Webpack option: PASS.
- Syntax checks: PASS for all 110 backend/plugin JavaScript files.
- Git whitespace check: PASS.
- Final source/configuration scan: no project-owned automated case files, test directories, test-runner configurations or package test scripts remain; no source imports reference removed files.

The first Admin typecheck overlapped a build that regenerated Next's output directory and reported missing generated types; the serial rerun passed. The default Turbopack build failed on restricted Google Fonts access, then on its worker port-binding restriction. The supported Webpack production build completed successfully; the normal build script was preserved. No application source change was made to work around these environment restrictions.

The backend is JavaScript and has no separate compile/build script; it received syntax/import inspection rather than a claimed TypeScript build or service startup. No database or payment service was invoked. Native Android installation and runtime acceptance were not performed by this cleanup.

No production records/configuration, real payments, deployments, commits or pushes were performed. Existing unrelated uncommitted implementation changes were preserved.
