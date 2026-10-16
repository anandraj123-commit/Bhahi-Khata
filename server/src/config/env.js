import "dotenv/config";

export const env = process.env;
const secret = env.JWT_SECRET;
if (!secret || secret.length < 32)
  throw new Error("JWT_SECRET must contain at least 32 characters");
if (!env.MONGODB_URI) throw new Error("MONGODB_URI is required");
if (!env.MONGODB_DB_NAME) throw new Error("MONGODB_DB_NAME is required");
const inferredMode =
  env.NODE_ENV === "production"
    ? "production"
    : env.NODE_ENV === "test"
      ? "testing"
      : "development";
env.APP_MODE ||= inferredMode;
if (!["development", "testing", "production"].includes(env.APP_MODE))
  throw new Error("APP_MODE must be development, testing, or production");
if (env.APP_MODE === "production" && env.NODE_ENV !== "production")
  throw new Error("NODE_ENV must be production when APP_MODE=production");
const environmentDatabase = {
  development: "digital_khata_development",
  testing: "digital_khata_testing",
  production: "digital_khata_production",
}[env.APP_MODE];
if (env.MONGODB_DB_NAME !== environmentDatabase)
  throw new Error(`MONGODB_DB_NAME must be ${environmentDatabase} for APP_MODE=${env.APP_MODE}`);

const razorpayKeyId = env.RAZORPAY_KEY_ID || "";
const razorpayKeySecret = env.RAZORPAY_KEY_SECRET || "";
const razorpayWebhookSecret = env.RAZORPAY_WEBHOOK_SECRET || "";
const razorpayWebhookUrl = env.RAZORPAY_WEBHOOK_URL || "";
if (razorpayKeyId) {
  const expectedPattern = env.APP_MODE === "production" ? /^rzp_live_[A-Za-z0-9]+$/ : /^rzp_test_[A-Za-z0-9]+$/;
  if (!expectedPattern.test(razorpayKeyId))
    throw new Error(`Razorpay key mode does not match APP_MODE=${env.APP_MODE}`);
}

for (const name of ["RAZORPAY_CHECKOUT_ENABLED", "ANDROID_BILLING_POLICY_CONFIRMED", "SUBSCRIPTION_NATIVE_CHECKOUT_READY", "SUBSCRIPTION_TAX_POLICY_CONFIRMED", "SUBSCRIPTION_PUSH_ENABLED"])
  if (env[name] !== undefined && !["true", "false"].includes(env[name]))
    throw new Error(`${name} must be true or false`);
const checkoutEnabled = env.RAZORPAY_CHECKOUT_ENABLED === "true";
if (checkoutEnabled && (!razorpayKeyId || !razorpayKeySecret || !razorpayWebhookSecret))
  throw new Error("Razorpay checkout requires credentials and a webhook secret");
if (checkoutEnabled && env.SUBSCRIPTION_TAX_POLICY_CONFIRMED !== "true")
  throw new Error("Checkout requires explicit subscription tax-policy confirmation");
if (checkoutEnabled && env.ANDROID_BILLING_POLICY_CONFIRMED !== "true")
  throw new Error("Checkout requires explicit Android billing-policy confirmation");
if (checkoutEnabled && env.SUBSCRIPTION_NATIVE_CHECKOUT_READY !== "true")
  throw new Error("Checkout requires a compatible native payment integration");
if (checkoutEnabled) {
  let webhookUrl;
  try { webhookUrl = new URL(razorpayWebhookUrl); } catch {
    throw new Error("Checkout requires a valid public Razorpay webhook URL");
  }
  if (
    webhookUrl.protocol !== "https:" ||
    webhookUrl.pathname.replace(/\/+$/, "") !== "/api/v1/payments/webhook" ||
    webhookUrl.username || webhookUrl.password || webhookUrl.search || webhookUrl.hash
  )
    throw new Error("Razorpay webhook URL must be HTTPS and target /api/v1/payments/webhook");
}

const taxBps = Number(env.SUBSCRIPTION_TAX_BPS || 0);
if (!Number.isInteger(taxBps) || taxBps < 0 || taxBps > 10000)
  throw new Error("SUBSCRIPTION_TAX_BPS must be an integer from 0 to 10000");
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
  razorpayKeyId,
  razorpayKeySecret,
  razorpayWebhookSecret,
  razorpayWebhookUrl,
  taxBps,
  taxInclusive: env.SUBSCRIPTION_TAX_INCLUSIVE === "true",
  pushEnabled: env.SUBSCRIPTION_PUSH_ENABLED === "true",
  reminderTime: env.SUBSCRIPTION_REMINDER_TIME || "10:00",
  reminderTimezone,
});
export const jwtKey = new TextEncoder().encode(secret);
