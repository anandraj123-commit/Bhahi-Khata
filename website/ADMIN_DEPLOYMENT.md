# Digital Khata administration deployment

The administration interface lives at `/admin` in the existing Next.js website. Deploy the `website/` directory as the Next.js project root. Use Node.js 22.13 or newer in the 22.x line for the tested toolchain. Public site pages use their existing routes.

## Website environment

Set server-only variables in the website host's protected environment settings:

- `EXPRESS_ADMIN_API_URL`: the HTTPS origin and path for the existing Express admin API, for example `https://api.example.com/api/v1/admin`.
- `ADMIN_FRONTEND_ORIGIN`: the exact deployed website origin, for example `https://app.example.com`.
- `ADMIN_PROXY_SECRET`: a private random value with at least 32 characters. Generate one with `openssl rand -hex 32`. Keep it in the server environment; do not prefix it with `NEXT_PUBLIC_`.

The Next.js route handler proxies administrator requests to Express. The browser session remains in a `Secure` (in production), `HttpOnly`, `SameSite=Strict` cookie scoped to `/admin`; privileged tokens are never stored in browser storage.

## Existing Express environment

Keep the existing Express API and MongoDB connection. Configure these additional server-only settings:

- `ADMIN_TRUSTED_ORIGINS`: a comma-separated allowlist of exact HTTPS website origins.
- `ADMIN_PROXY_SECRET`: the same private value configured for the website proxy.
- `TRUST_PROXY=true` only when Express is behind a trusted TLS-terminating proxy and its forwarded protocol headers are overwritten by that proxy.
- `ADMIN_SMTP_HOST`, `ADMIN_SMTP_PORT`, `ADMIN_SMTP_USER`, `ADMIN_SMTP_PASSWORD`, and `ADMIN_EMAIL_FROM` to enable the administrator password reset email. Use port `587` with STARTTLS or `465` with TLS. For Gmail, use a Google App Password, never the normal account password.
- `ADMIN_PASSWORD_RESET_ORIGIN` optionally selects the trusted website origin placed in reset links. If omitted, the first origin in `ADMIN_TRUSTED_ORIGINS` is used.

Use a different proxy secret in each environment. Store it in the host's secret manager. Production rejects non-HTTPS admin origins and requests.

For local Gmail SMTP, configure the sender account's App Password in `server/.env` and set `ADMIN_EMAIL_FROM` to that Gmail address. Keep the mail password only in the backend environment. Configure the matching `ADMIN_PASSWORD_RESET_ORIGIN` as `http://localhost:3000` for local development. After deploying the updated admin backend, run `node src/admin/scripts/provision.mjs --indexes` once so the one-time reset-token expiry index is present.

Example local backend mail settings:

```env
ADMIN_SMTP_HOST=smtp.gmail.com
ADMIN_SMTP_PORT=587
ADMIN_SMTP_USER=your-sender@gmail.com
ADMIN_SMTP_PASSWORD=your-google-app-password
ADMIN_EMAIL_FROM=Digital Khata Admin <your-sender@gmail.com>
ADMIN_PASSWORD_RESET_ORIGIN=http://localhost:3000
```

Use a Google App Password only when the sender account permits it; do not use your normal Gmail password. For production, use a dedicated transactional mail sender and store its credentials in the backend host's secret manager.

## Provisioning

After deploying the Express code and creating its admin-owned indexes, run this command once against the intended environment:

```sh
cd server
node src/admin/scripts/provision.mjs --indexes
```

To bootstrap the first Super Admin, supply `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_NAME`, and a unique `ADMIN_BOOTSTRAP_PASSWORD` (14–128 characters) through protected process environment input, then run:

```sh
node src/admin/scripts/provision.mjs --bootstrap
```

The command does not run automatically at API startup. It refuses to bootstrap while any administrator record exists, records the action, and never prints the supplied password. If all admin-user records were intentionally removed, it can provision a replacement even when the bootstrap marker remains. Sign in with the provisioned email and password. The website does not provide public administrator registration.

## Build and deploy

Run `npm ci`, `npm run typecheck`, `npm run lint`, and `npm run build` from `website/`. Configure the Vercel project root as `website/`; Vercel's standard Next.js build and start settings work. Configure the website and Express secret variables before deployment, allow the website origin in `ADMIN_TRUSTED_ORIGINS`, and deploy the existing Express service separately. Never connect the browser directly to MongoDB.

Subscription and payment pages are read-only. Account suspension, refunds, entitlement changes, and manual plan activation are not exposed. Verified payment revenue is shown by currency, for the configured backend app mode, net of recorded refunds. “Active shops” means the linked owner account exists and is not disabled; it is not a measure of recent shop activity. Historical active-shop trends are unavailable because that activity history is not stored.

Browser and database integration tests use only the temporary local MongoDB fixture harness under `website/tests/admin` and `server/src/admin/tests`; those commands are for development only and are not part of the production build.
