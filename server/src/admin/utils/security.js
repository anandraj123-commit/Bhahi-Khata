import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
  createHmac,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export function equal(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${salt}$${key.toString("hex")}`;
}
export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  const salt =
    parts[0] === "scrypt" && /^[a-f0-9]{32}$/.test(parts[1])
      ? parts[1]
      : "00000000000000000000000000000000";
  const key = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return parts.length === 3 && equal(key.toString("hex"), parts[2]);
}
export const csrfToken = (token, key) =>
  createHmac("sha256", key).update(`admin-csrf:${token}`).digest("hex");
export function cookieToken(header) {
  const value = String(header || "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("dk_admin_session="))
    ?.slice(17);
  return /^[a-f0-9]{64}$/.test(value || "") ? value : null;
}
export const fail = (status, code, message) =>
  Object.assign(new Error(message), { status, code });
export function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
