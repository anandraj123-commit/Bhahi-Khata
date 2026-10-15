import "dotenv/config";

export const env = process.env;
const secret = env.JWT_SECRET;
if (!secret || secret.length < 32)
  throw new Error("JWT_SECRET must contain at least 32 characters");
if (!env.MONGODB_URI) throw new Error("MONGODB_URI is required");
if (!env.MONGODB_DB_NAME) throw new Error("MONGODB_DB_NAME is required");
export const jwtKey = new TextEncoder().encode(secret);
