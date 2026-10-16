import mongoose from "mongoose";
import { env } from "./env.js";
import { log } from "./logger.js";

function safeMessage(value) {
  if (typeof value !== "string") return undefined;
  return value
    .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, "<redacted MongoDB URI>")
    .replace(/\b(password|passwd|pwd|secret|token)\s*[:=]\s*[^,;\s]+/gi, "$1=<redacted>")
    .slice(0, 300);
}

function safeCode(value) {
  return typeof value === "string" && /^[A-Z0-9_-]{1,40}$/i.test(value)
    ? value
    : typeof value === "number"
      ? value
      : undefined;
}

export function databaseErrorContext(error) {
  const servers = error?.reason?.servers;
  const hasCauseDetails = error?.cause?.name || error?.cause?.code || error?.cause?.message;
  const serverErrors = servers instanceof Map
    ? [...servers.entries()].map(([address, server]) => ({
        address: String(address).slice(0, 160),
        ...(server.error?.name ? { errorName: String(server.error.name).slice(0, 60) } : {}),
        ...(safeCode(server.error?.code) !== undefined ? { errorCode: safeCode(server.error.code) } : {}),
        ...(safeMessage(server.error?.message) ? { message: safeMessage(server.error.message) } : {}),
      }))
    : [];
  return {
    errorName: typeof error?.name === "string" ? error.name.slice(0, 60) : "Error",
    ...(safeCode(error?.code) !== undefined ? { errorCode: safeCode(error.code) } : {}),
    ...(safeMessage(error?.message) ? { message: safeMessage(error.message) } : {}),
    ...(typeof error?.reason?.type === "string" ? { topologyType: error.reason.type } : {}),
    ...(servers instanceof Map ? { topologyServerCount: servers.size } : {}),
    ...(hasCauseDetails ? {
      cause: {
        ...(typeof error.cause.name === "string" ? { errorName: error.cause.name.slice(0, 60) } : {}),
        ...(safeCode(error.cause.code) !== undefined ? { errorCode: safeCode(error.cause.code) } : {}),
        ...(safeMessage(error.cause.message) ? { message: safeMessage(error.cause.message) } : {}),
      },
    } : {}),
    ...(serverErrors.length ? { servers: serverErrors } : {}),
  };
}

export async function connectDatabase() {
  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.MONGODB_DB_NAME,
    autoIndex: false,
    maxPoolSize: Number(env.MONGO_POOL_SIZE) || 20,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 30000,
  });
  if (mongoose.connection.name !== env.MONGODB_DB_NAME) {
    await mongoose.disconnect();
    throw new Error("Connected MongoDB database does not match MONGODB_DB_NAME");
  }
  log.info({ database: mongoose.connection.name }, "MongoDB connected");
}
