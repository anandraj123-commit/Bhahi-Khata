import "./config/startupGuard.js";
import mongoose from "mongoose";
import { env, subscriptionConfig } from "./config/env.js";
import { log, safeErrorContext } from "./config/logger.js";
import { connectDatabase, databaseErrorContext } from "./config/database.js";
import { createApp } from "./app.js";
import { ensureCustomerLifecycleDefaults, ensureCustomerMobileIndex, ensureIndexes, ensureReferralIndexes } from "./models.js";
import { startReminderWorker } from "./reminders.js";
import { ensureSubscriptionPlans } from "./services/subscriptionService.js";
import { startSubscriptionReminderWorker } from "./subscriptionReminders.js";
import { startPaymentReconciliationWorker } from "./paymentReconciliation.js";

try {
  await connectDatabase();
} catch (error) {
  log.fatal(
    { phase: "mongodb-connection", database: env.MONGODB_DB_NAME, ...databaseErrorContext(error) },
    "MongoDB connection failed; API was not started",
  );
  process.exit(1);
}

if (process.argv.includes("--indexes")) {
  try {
    await ensureIndexes();
    log.info("MongoDB indexes ensured");
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    log.fatal(safeErrorContext(error), "MongoDB index initialization failed");
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

if (process.argv.includes("--check-db")) {
  log.info({ database: mongoose.connection.name }, "MongoDB connection check succeeded");
  await mongoose.disconnect();
  process.exit(0);
}

try {
  await ensureReferralIndexes();
  await ensureCustomerLifecycleDefaults();
  await ensureCustomerMobileIndex();
} catch (error) {
  log.fatal(safeErrorContext(error), "Customer compatibility migration failed; API was not started");
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}

try {
  await ensureSubscriptionPlans();
} catch (error) {
  log.fatal(
    { phase: "subscription-plan-initialization", database: env.MONGODB_DB_NAME, ...safeErrorContext(error) },
    "Subscription plan initialization failed; API was not started",
  );
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
}

if (subscriptionConfig.checkoutEnabled) {
  try {
    await ensureIndexes();
  } catch (error) {
    log.fatal(
      { phase: "index-initialization", database: env.MONGODB_DB_NAME, ...safeErrorContext(error) },
      "MongoDB index initialization failed; API was not started",
    );
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

if (env.NODE_ENV !== "production" && env.DEV_OTP_ENABLED !== "true")
  log.warn("Development OTP disabled; configure Twilio Verify");
const app = createApp();
const port = Number(env.PORT) || 4000;
const server = app.listen(port, "0.0.0.0", () =>
  log.info({ port }, "Digital Khata API listening"),
);
server.on("error", (error) => {
  log.fatal(safeErrorContext(error), "HTTP server failed");
  void mongoose
    .disconnect()
    .catch(() => {})
    .finally(() => process.exit(1));
});
startReminderWorker(log);
startSubscriptionReminderWorker(log);
startPaymentReconciliationWorker(log);
async function shutdown(signal) {
  log.info({ signal }, "shutting down");
  server.close(async () => {
    try {
      await mongoose.disconnect();
      process.exit(0);
    } catch (error) {
      log.error(safeErrorContext(error), "MongoDB disconnect failed during shutdown");
      process.exit(1);
    }
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
