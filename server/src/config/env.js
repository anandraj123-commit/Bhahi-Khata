export const env = process.env;
const allowedModes = ["development", "testing", "production"];
if (!allowedModes.includes(env.APP_MODE))
  throw new Error("APP_MODE must be development, testing, or production");
const expectedNodeEnv = { development: "development", testing: "test", production: "production" }[env.APP_MODE];
if (env.NODE_ENV !== expectedNodeEnv)
  throw new Error(`APP_MODE=${env.APP_MODE} requires NODE_ENV=${expectedNodeEnv}`);
const environmentDatabase = {
  development: "digital_khata_development",
  testing: "digital_khata_testing",
  production: "digital_khata_production",
}[env.APP_MODE];
if (env.MONGODB_DB_NAME !== environmentDatabase)
  throw new Error(`MONGODB_DB_NAME must be ${environmentDatabase} for APP_MODE=${env.APP_MODE}`);

if (!env.MONGODB_URI) throw new Error("MONGODB_URI is required");
let mongoUri;
try {
  mongoUri = new URL(env.MONGODB_URI);
} catch {
  throw new Error("MONGODB_URI must be a valid MongoDB connection URI");
}
if (!["mongodb:", "mongodb+srv:"].includes(mongoUri.protocol))
  throw new Error("MONGODB_URI must use mongodb:// or mongodb+srv://");
let uriDatabase;
try {
  uriDatabase = decodeURIComponent(mongoUri.pathname.replace(/^\/+|\/+$/g, ""));
} catch {
  throw new Error("MONGODB_URI contains an invalid database path");
}
if (uriDatabase && uriDatabase !== environmentDatabase)
  throw new Error(`MONGODB_URI database path must be ${environmentDatabase} for APP_MODE=${env.APP_MODE}`);

const secret = env.JWT_SECRET;
if (!secret || secret.length < 32)
  throw new Error("JWT_SECRET must contain at least 32 characters");

const cashfreeClientId = env.CASHFREE_CLIENT_ID || "";
const cashfreeClientSecret = env.CASHFREE_CLIENT_SECRET || "";
const cashfreeWebhookSecret = env.CASHFREE_WEBHOOK_SECRET || "";
const cashfreeWebhookUrl = env.CASHFREE_WEBHOOK_URL || "";
const cashfreeApiVersion = env.CASHFREE_API_VERSION || "2026-01-01";
const expectedCashfreeEnvironment = env.APP_MODE === "production" ? "production" : "sandbox";
if (!env.CASHFREE_ENVIRONMENT)
  throw new Error("CASHFREE_ENVIRONMENT is required");
if (env.CASHFREE_ENVIRONMENT !== expectedCashfreeEnvironment)
  throw new Error(`APP_MODE=${env.APP_MODE} requires CASHFREE_ENVIRONMENT=${expectedCashfreeEnvironment}`);
const cashfreeEnvironment = env.CASHFREE_ENVIRONMENT;
if (!["sandbox", "production"].includes(cashfreeEnvironment))
  throw new Error("CASHFREE_ENVIRONMENT must be sandbox or production");
if (!/^\d{4}-\d{2}-\d{2}$/.test(cashfreeApiVersion))
  throw new Error("CASHFREE_API_VERSION must be a date version such as 2026-01-01");

for (const name of ["CASHFREE_CHECKOUT_ENABLED", "CASHFREE_LIVE_PAYMENTS_APPROVED", "ANDROID_BILLING_POLICY_CONFIRMED", "SUBSCRIPTION_NATIVE_CHECKOUT_READY", "SUBSCRIPTION_TAX_POLICY_CONFIRMED", "SUBSCRIPTION_PUSH_ENABLED"])
  if (env[name] !== undefined && !["true", "false"].includes(env[name]))
    throw new Error(`${name} must be true or false`);
const checkoutRequested = env.CASHFREE_CHECKOUT_ENABLED === "true";
const cashfreeLivePaymentsApproved = env.CASHFREE_LIVE_PAYMENTS_APPROVED === "true";
if (checkoutRequested && (!cashfreeClientId || !cashfreeClientSecret || !cashfreeWebhookSecret))
  throw new Error("Cashfree checkout requires client credentials and a webhook secret");
if (cashfreeEnvironment === "production" && checkoutRequested && !cashfreeLivePaymentsApproved)
  throw new Error("Live Cashfree payments require explicit approval");
if (cashfreeEnvironment === "production" && cashfreeLivePaymentsApproved && env.SUBSCRIPTION_TAX_POLICY_CONFIRMED !== "true")
  throw new Error("Live checkout requires explicit subscription tax-policy confirmation");
if (cashfreeEnvironment === "production" && cashfreeLivePaymentsApproved && env.ANDROID_BILLING_POLICY_CONFIRMED !== "true")
  throw new Error("Live checkout requires confirmed Android billing eligibility");
if (checkoutRequested && env.SUBSCRIPTION_NATIVE_CHECKOUT_READY !== "true")
  throw new Error("Checkout requires a compatible native payment integration");
if (checkoutRequested) {
  let webhookUrl;
  try { webhookUrl = new URL(cashfreeWebhookUrl); } catch {
    throw new Error("Checkout requires a valid public Cashfree webhook URL");
  }
  if (
    webhookUrl.protocol !== "https:" ||
    webhookUrl.pathname.replace(/\/+$/, "") !== "/api/v1/payments/webhook" ||
    webhookUrl.username || webhookUrl.password || webhookUrl.search || webhookUrl.hash
  )
    throw new Error("Cashfree webhook URL must be HTTPS and target /api/v1/payments/webhook");
}
const checkoutEnabled = checkoutRequested && (cashfreeEnvironment !== "production" || cashfreeLivePaymentsApproved);

const taxBps = Number(env.SUBSCRIPTION_TAX_BPS || 0);
if (!Number.isInteger(taxBps) || taxBps < 0 || taxBps > 10000)
  throw new Error("SUBSCRIPTION_TAX_BPS must be an integer from 0 to 10000");
const paymentReconciliationMaxAttempts = Number(env.PAYMENT_RECONCILIATION_MAX_ATTEMPTS || 8);
if (!Number.isSafeInteger(paymentReconciliationMaxAttempts) || paymentReconciliationMaxAttempts < 1 || paymentReconciliationMaxAttempts > 32)
  throw new Error("PAYMENT_RECONCILIATION_MAX_ATTEMPTS must be an integer from 1 to 32");
if (env.SUBSCRIPTION_TAX_INCLUSIVE !== undefined && !["true", "false"].includes(env.SUBSCRIPTION_TAX_INCLUSIVE))
  throw new Error("SUBSCRIPTION_TAX_INCLUSIVE must be true or false");
if (env.SUBSCRIPTION_REMINDER_TIME && !/^([01]\d|2[0-3]):[0-5]\d$/.test(env.SUBSCRIPTION_REMINDER_TIME))
  throw new Error("SUBSCRIPTION_REMINDER_TIME must use HH:MM");
const reminderTimezone = env.SUBSCRIPTION_REMINDER_TIMEZONE || "Asia/Kolkata";
try { new Intl.DateTimeFormat("en", { timeZone: reminderTimezone }).format(new Date()); }
catch { throw new Error("SUBSCRIPTION_REMINDER_TIMEZONE is invalid"); }
export const subscriptionConfig = Object.freeze({
  appMode: env.APP_MODE,
  checkoutEnabled,
  nativeCheckoutReady: env.SUBSCRIPTION_NATIVE_CHECKOUT_READY === "true",
  cashfreeClientId,
  cashfreeClientSecret,
  cashfreeWebhookSecret,
  cashfreeWebhookUrl,
  cashfreeApiVersion,
  cashfreeEnvironment,
  cashfreeLivePaymentsApproved,
  taxBps,
  taxInclusive: env.SUBSCRIPTION_TAX_INCLUSIVE === "true",
  paymentReconciliationMaxAttempts,
  pushEnabled: env.SUBSCRIPTION_PUSH_ENABLED === "true",
  reminderTime: env.SUBSCRIPTION_REMINDER_TIME || "10:00",
  reminderTimezone,
});
export const jwtKey = new TextEncoder().encode(secret);
