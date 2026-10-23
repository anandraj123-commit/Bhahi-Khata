import { randomBytes } from "node:crypto";
import {
  adminConfig,
  effectivePermissions,
  IDLE_MS,
  REAUTH_MS,
} from "../config/index.js";
import { AdminUser, AdminSession, AdminAttempt } from "../models/index.js";
import {
  equal,
  cookieToken,
  digest,
  csrfToken,
  fail,
} from "../utils/security.js";
export function trustedProxy(req, res, next) {
  req.adminRequestId = randomBytes(12).toString("hex");
  res.set("X-Request-Id", req.adminRequestId);
  res.set("Cache-Control", "no-store");
  const config = adminConfig();
  req.adminConfig = config;
  if (
    !equal(req.get("x-admin-proxy-key"), config.proxySecret) ||
    !config.origins.includes(req.get("x-admin-origin"))
  )
    throw fail(403, "ADMIN_ORIGIN_DENIED", "Administrative access denied");
  if (config.production && !req.secure)
    throw fail(403, "ADMIN_HTTPS_REQUIRED", "HTTPS is required");
  next();
}
export async function authenticate(req, res, next) {
  const token = cookieToken(req.headers.cookie);
  if (!token) throw fail(401, "ADMIN_SESSION_REQUIRED", "Please sign in");
  const now = new Date();
  const session = await AdminSession.findOneAndUpdate(
    {
      tokenHash: digest(token),
      expiresAt: { $gt: now },
      lastSeenAt: { $gt: new Date(now.getTime() - IDLE_MS) },
    },
    { $set: { lastSeenAt: now } },
    { new: true },
  ).lean();
  const admin = session && (await AdminUser.findById(session.adminId).lean());
  if (!admin?.active || session.version !== admin.sessionVersion)
    throw fail(
      401,
      "ADMIN_SESSION_EXPIRED",
      "Your session has expired. Please sign in again.",
    );
  req.admin = admin;
  req.adminSession = session;
  req.adminToken = token;
  req.adminPermissions = effectivePermissions(admin, session);
  if (
    !["GET", "HEAD"].includes(req.method) &&
    !equal(
      req.get("x-admin-csrf"),
      csrfToken(token, req.adminConfig.proxySecret),
    )
  )
    throw fail(
      403,
      "ADMIN_CSRF_INVALID",
      "Please refresh the page and try again",
    );
  next();
}
export const permit = (permission) => (req, res, next) => {
  if (!req.adminPermissions.includes(permission))
    throw fail(
      403,
      "ADMIN_PERMISSION_DENIED",
      "You do not have permission to access this feature",
    );
  next();
};
export function recentAuthentication(req, res, next) {
  if (
    !req.adminSession.reauthenticatedAt ||
    Date.now() - req.adminSession.reauthenticatedAt.getTime() > REAUTH_MS
  )
    throw fail(
      403,
      "ADMIN_REAUTH_REQUIRED",
      "Confirm your password in Security settings first",
    );
  next();
}
export async function loginLimit(req, res, next) {
  const identity = digest(
    String(req.admin?._id || req.body?.email || "")
      .toLowerCase()
      .trim(),
  );
  const bucket = Math.floor(Date.now() / 900000);
  let attempt;
  try {
    attempt = await AdminAttempt.findOneAndUpdate(
      { _id: `login:${identity}:${bucket}` },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt: new Date((bucket + 2) * 900000) },
      },
      { upsert: true, new: true },
    ).lean();
  } catch (error) {
    if (error.code === 11000)
      throw fail(
        429,
        "ADMIN_RATE_LIMITED",
        "Too many attempts. Try again later.",
      );
    throw error;
  }
  if (attempt.count > 10) {
    res.set("Retry-After", "900");
    throw fail(
      429,
      "ADMIN_RATE_LIMITED",
      "Too many attempts. Try again later.",
    );
  }
  next();
}
export function adminError(error, req, res, next) {
  if (res.headersSent) return next(error);
  const validation =
    error.name === "ZodError" || error.type === "entity.parse.failed";
  const status = validation
    ? 400
    : error.code === 11000
      ? 409
      : [400, 401, 403, 404, 409, 413, 429, 503].includes(error.status)
        ? error.status
        : 500;
  const code = validation
    ? "ADMIN_VALIDATION_FAILED"
    : error.code === 11000
      ? "ADMIN_CONFLICT"
      : typeof error.code === "string" && /^ADMIN_[A-Z_]+$/.test(error.code)
        ? error.code
        : "ADMIN_INTERNAL_ERROR";
  if (status >= 500)
    req.log?.error(
      { requestId: req.adminRequestId, code },
      "Admin request failed",
    );
  res
    .status(status)
    .json({
      error: {
        code,
        message: validation
          ? "Check the supplied fields and try again"
          : status >= 500
            ? "The administration service is unavailable. Please try again."
            : code === "ADMIN_CONFLICT"
              ? "That record already exists"
              : error.message,
      },
      requestId: req.adminRequestId,
    });
}
