# Digital-Khata backend

## Start the backend

Run commands from `server/`. Each command loads exactly one backend environment file; there is no `.env` fallback.

```bash
# Development: .env.development
npm run dev

# Testing: .env.testing
npm run start:testing

# Production: .env.production
npm run start:production
```

The Node.js startup guard checks that the selected file, `APP_MODE`, `NODE_ENV`, database name, and Cashfree environment agree. Conflicting exported variables cause startup to fail with the variable name only. `APP_MODE` is explicit and is never inferred from `NODE_ENV`.

## Environment isolation

| File | `APP_MODE` | `NODE_ENV` | MongoDB database | Cashfree |
|---|---|---|---|---|
| `.env.development` | `development` | `development` | `digital_khata_development` | Sandbox |
| `.env.testing` | `testing` | `test` | `digital_khata_testing` | Sandbox |
| `.env.production` | `production` | `production` | `digital_khata_production` | Live |

MongoDB connects with the explicitly configured `MONGODB_DB_NAME`. A database name embedded in `MONGODB_URI` must either be absent or match that environment's required database. Development and testing cannot select the production database through either setting.

Cashfree mode is mandatory in each file. Development and testing require Sandbox; production requires Live. Existing checkout approvals, webhook requirements, tax settings, native-checkout readiness, and other payment validations remain active. Production checkout is not implicitly enabled.

The current `.env.production` is deliberately incomplete because production MongoDB, JWT, and Live Cashfree credentials were not available during this change. Supply the real production values through your approved secret-management process before starting production. Startup is expected to fail until required values, including a 32-character JWT secret, are set.

## Configure secrets safely

Use the corresponding untracked `.env.*` file for local development. For deployed environments, prefer a secret manager that creates or mounts the selected environment file with restricted permissions before starting the process. The startup guard rejects values that conflict with the selected file, so do not combine several environment files or rely on a second file as an override. Never put Cashfree credentials, MongoDB URIs, or JWT secrets in the mobile app, frontend bundle, checked-in examples, or logs. Do not reuse JWT secrets between environments.

Use the matching sanitized `.env.<mode>.example` as a key inventory. Add missing application-specific settings to the selected real file, preserving its `APP_MODE`, `NODE_ENV`, `MONGODB_DB_NAME`, and `CASHFREE_ENVIRONMENT` values. `.env` is not loaded or required. The real `.env.*` files are ignored by Git; only sanitized example files are intended to be tracked.

To verify the selected mode without starting Express or connecting to MongoDB, use the equivalent Node command from `server/`:

```bash
node --env-file=.env.development --import=./src/config/startupGuard.js --input-type=module -e 'import { env, subscriptionConfig } from "./src/config/env.js"; console.log({ appMode: env.APP_MODE, database: env.MONGODB_DB_NAME, cashfree: subscriptionConfig.cashfreeEnvironment })'
```

Substitute `.env.testing` or `.env.production` to inspect the other configuration. This prints no credentials. It does not establish database or Cashfree connectivity. Configuration errors name the invalid setting without printing its value.

## Deployment notes

Deploy development, testing, and production as separate processes with separate database credentials and access policies. Ensure the configured MongoDB URI grants access only to its corresponding database/environment. For the supplied Dockerfile, mount or materialize `.env.production` into `/app/.env.production` at runtime; it is intentionally not copied into the image. Production secrets should be delivered by a managed secret store or restricted mounted file, never copied into the repository or container image. Do not enable Live checkout until the existing billing, tax, webhook, and native checkout confirmations have been reviewed.

Backend mode selection does not change the React Native app's API endpoint. The mobile client continues to use its existing `EXPO_PUBLIC_API_URL` (or build-time equivalent); configure that independently for each app build/deployment.

## Tests and utilities

`npm run test:env` tests environment selection and validation without connecting to services. `npm run test:payments` runs the existing payment provider, pricing, and lifecycle tests; inspect their isolated test-database prerequisites before running. The `indexes:<mode>` scripts use the corresponding environment file and startup checks.

For local administrator scripts, first provide the matching explicit environment file and startup guard, for example:

```bash
node --env-file=.env.development --import=./src/config/startupGuard.js src/admin/scripts/provision.mjs
```
