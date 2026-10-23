import mongoose from "mongoose";
import { randomBytes } from "node:crypto";
import { AdminUser, AdminSession } from "../models/index.js";
import { COOKIE, SESSION_MS } from "../config/index.js";
import {
  digest,
  fail,
  verifyPassword,
  csrfToken,
} from "../utils/security.js";
import { audit, publicAdmin } from "./audit.js";
export function sessionCookie(res, token, production, maxAge = SESSION_MS) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: production,
    sameSite: "strict",
    path: "/admin",
    maxAge,
  });
}
export async function verifyCredentials(admin, password) {
  if (!(await verifyPassword(password, admin?.passwordHash)) || !admin?.active)
    throw fail(
      401,
      "ADMIN_INVALID_CREDENTIALS",
      "Email or password is incorrect",
    );
}
export async function issueSession(admin, req, res, session) {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  await AdminSession.create(
    [
      {
        tokenHash: digest(token),
        adminId: admin._id,
        version: admin.sessionVersion,
        expiresAt: new Date(now.getTime() + SESSION_MS),
        lastSeenAt: now,
        reauthenticatedAt: now,
      },
    ],
    session ? { session } : {},
  );
  return { token, csrfToken: csrfToken(token, req.adminConfig.proxySecret) };
}
export async function login(req, res, credentials) {
  const admin = await AdminUser.findOne({ email: credentials.email })
    .select("+passwordHash")
    .lean();
  try {
    await verifyCredentials(
      admin,
      credentials.password,
    );
  } catch (error) {
    await audit(
      { ...req, admin },
      "auth.login",
      "administrator",
      admin?._id,
      {},
      undefined,
      "failure",
    );
    throw error;
  }
  req.admin = admin;
  let issued;
  await mongoose.connection.transaction(async (session) => {
    issued = await issueSession(
      admin, req, res, session,
    );
    await AdminUser.updateOne(
      { _id: admin._id },
      { $set: { lastLoginAt: new Date() } },
      { session },
    );
    await audit(req, "auth.login", "administrator", admin._id, {}, session);
  });
  sessionCookie(res, issued.token, req.adminConfig.production);
  return {
    administrator: publicAdmin(admin),
    csrfToken: issued.csrfToken,
  };
}
