import "dotenv/config";
import mongoose from "mongoose";
import { env } from "./config/env.js";
import { log } from "./config/logger.js";
import { connectDatabase } from "./config/database.js";
import { createApp } from "./app.js";
import { ensureIndexes } from "./models.js";
import { startReminderWorker } from "./reminders.js";

await connectDatabase();
if (process.argv.includes("--indexes")) {
  await ensureIndexes();
  log.info("MongoDB indexes ensured");
  await mongoose.disconnect();
  process.exit(0);
}
if (env.NODE_ENV !== "production" && env.DEV_OTP_ENABLED !== "true")
  log.warn("Development OTP disabled; configure Twilio Verify");
const app = createApp();
const port = Number(env.PORT) || 4000;
const server = app.listen(port, "0.0.0.0", () =>
  log.info({ port }, "Digital Khata API listening"),
);
startReminderWorker(log);
async function shutdown(signal) {
  log.info({ signal }, "shutting down");
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
