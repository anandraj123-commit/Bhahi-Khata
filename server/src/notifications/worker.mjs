// Dedicated alternative to the in-API scheduler; not an additional scheduler.
import "../config/startupGuard.js";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { log } from "../config/logger.js";
import { startAdminNotificationWorker } from "./publication.js";
if (env.ADMIN_NOTIFICATION_WORKER_ENABLED !== "true")
  throw Error("Notification worker must be explicitly enabled");
let worker;
try {
  mongoose.set("autoCreate", false);
  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.MONGODB_DB_NAME,
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 10000,
  });
  const exists = await mongoose.connection.db
    .listCollections({ name: "adminnotifications" }, { nameOnly: true })
    .hasNext();
  if (!exists) throw Error("Notification provisioning required");
  worker = startAdminNotificationWorker(log);
} catch {
  log.error(
    { code: "NOTIFICATION_WORKER_START_FAILED" },
    "Notification worker unavailable; check provisioning and configuration",
  );
  await mongoose.disconnect();
  process.exitCode = 1;
}
if (worker) {
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 30000);
    deadline.unref();
    await worker.stop();
    await mongoose.disconnect();
    clearTimeout(deadline);
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
