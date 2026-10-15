import mongoose from "mongoose";
import { env } from "./env.js";
import { log } from "./logger.js";

export async function connectDatabase() {
  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.MONGODB_DB_NAME,
    autoIndex: false,
    maxPoolSize: Number(env.MONGO_POOL_SIZE) || 20,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
  });
  if (mongoose.connection.name !== env.MONGODB_DB_NAME) {
    await mongoose.disconnect();
    throw new Error("Connected MongoDB database does not match MONGODB_DB_NAME");
  }
  log.info({ database: mongoose.connection.name }, "MongoDB connected");
}
