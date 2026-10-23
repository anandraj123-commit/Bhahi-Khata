# Subscription and Cashfree payment configuration

The API uses `APP_MODE` and `MONGODB_DB_NAME` together. The checked-in `.env.example` is development-only and contains empty secret placeholders. Store credentials in the untracked server environment file or deployment secret store; never put Cashfree secrets in the mobile app, website bundle, or logs.

## Cashfree checkout

Checkout is disabled by default. To test, use Cashfree sandbox credentials and set `CASHFREE_ENVIRONMENT=sandbox`, `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `CASHFREE_WEBHOOK_SECRET`, and a public HTTPS `CASHFREE_WEBHOOK_URL` ending in `/api/v1/payments/webhook`. Then enable `CASHFREE_CHECKOUT_ENABLED=true` and `SUBSCRIPTION_NATIVE_CHECKOUT_READY=true` only after building and installing the native app. Sandbox checkout requires the webhook secret as well as API credentials. Cashfree API calls use the configured `CASHFREE_API_VERSION` (default `2026-01-01`).

The mobile integration uses `react-native-cashfree-pg-sdk` 2.5.1 and requires an Expo development/native build; Expo Go does not include its native module. Android uses React Native autolinking. iOS builds include the Cashfree UPI app query schemes from `app.json`. Checkout requests carry an idempotency key, but only Cashfree's server API and signed webhooks can verify a payment or activate a subscription. The app SDK callback only triggers a status reconciliation.

Keep `CASHFREE_ENVIRONMENT=sandbox` for testing. Production checkout requires `CASHFREE_LIVE_PAYMENTS_APPROVED=true`, an explicit merchant decision, HTTPS webhook configuration, a reviewed tax policy (`SUBSCRIPTION_TAX_POLICY_CONFIRMED=true`), and confirmed Android distribution billing eligibility (`ANDROID_BILLING_POLICY_CONFIRMED=true`). The app currently uses Cashfree external checkout; Google Play distribution may require enrollment in and compliance with its India alternative billing/user-choice program. Do not enable live payments until that distribution review is complete.

Cashfree webhook requests are verified against the exact raw request body and timestamp using `X-Webhook-Signature` and `X-Webhook-Timestamp`. Events are deduplicated, and the backend fetches current order/payment status from Cashfree before changing the subscription. Payment records and subscription history are read-only in the Admin Panel.

## Plans, pricing, and entitlements

Plan seeds are inserted only when a plan code is absent; they do not overwrite database pricing or limits. Prices are integer paise. Discount is rounded to the nearest paise, with half paise rounded upward. `SUBSCRIPTION_TAX_BPS` and `SUBSCRIPTION_TAX_INCLUSIVE` configure quotes; tax policy must be reviewed before production checkout is enabled. Every order stores the quoted plan, discount, tax, currency, and amount snapshot. Paid subscriptions use that purchased plan snapshot, so later Admin plan edits do not silently alter active paid terms. The Free fallback uses the current Free plan configuration.

Subscription months use UTC calendar arithmetic and clamp to the last day of a shorter target month. Same-plan purchases extend the current paid period. Business-to-Pro purchases are scheduled after current Business access ends. Pro-to-Business immediate upgrades remain unavailable until a safe upgrade-credit calculation is configured. Free is the effective plan whenever no paid period is active. Expiry does not delete customers or ledgers.

## Notifications and history

The mobile app schedules local reminders before expiry when notification permission is granted. Cached subscription details and payment history use the existing encrypted SQLCipher database. An optional backend worker can use the existing Expo Push path when `SUBSCRIPTION_PUSH_ENABLED=true`. Gateway references appear in payment history; the project does not generate tax invoices.
