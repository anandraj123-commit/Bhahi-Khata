import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import {
  AdminUser,
  AdminSession,
  AdminPasswordReset,
  AdminAudit,
} from "../models/index.js";
import { digest, fail, hashPassword } from "../utils/security.js";
import { password as passwordValidator } from "../validators/index.js";
import { sendAdminPasswordReset } from "./email.js";

const RESET_MS = 30 * 60 * 1000;

function safeMailFailure(error) {
  // SMTP errors can contain server responses and addresses. Keep diagnostics to
  // a short allowlisted transport code and a coarse category only.
  const code = [
    "EAUTH",
    "ECONNECTION",
    "ETIMEDOUT",
    "ESOCKET",
    "EENVELOPE",
    "EMESSAGE",
  ].includes(error?.code)
    ? error.code
    : undefined;
  const category =
    error?.message === "Admin email delivery is not configured"
      ? "configuration"
      : error?.message === "Admin password reset origin is not trusted"
        ? "origin_configuration"
        : code === "EAUTH"
          ? "smtp_authentication"
          : code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ESOCKET"
            ? "smtp_connection"
            : code === "EENVELOPE"
              ? "smtp_recipient"
              : "smtp_delivery";
  return { category, ...(code ? { code } : {}) };
}

export async function requestAdminPasswordReset(email, req) {
  const admin = await AdminUser.findOne({ email, active: true }).lean();
  if (!admin) return;

  const token = randomBytes(32).toString("hex");
  const tokenHash = digest(token);
  await mongoose.connection.transaction(async (session) => {
    await AdminPasswordReset.deleteMany({ adminId: admin._id }, { session });
    await AdminPasswordReset.create(
      [
        {
          tokenHash,
          adminId: admin._id,
          expiresAt: new Date(Date.now() + RESET_MS),
        },
      ],
      { session },
    );
  });

  // Do not make the response depend on mailbox delivery or reveal account existence.
  void (async () => {
    try {
      await sendAdminPasswordReset(admin.email, token);
    } catch (error) {
      req.log?.warn(
        {
          requestId: req.adminRequestId,
          ...safeMailFailure(error),
        },
        "Admin password reset email delivery failed",
      );
      await AdminPasswordReset.deleteOne({ tokenHash }).catch(() => {});
      await AdminAudit.create({
        adminId: admin._id,
        action: "auth.password_reset_requested",
        targetType: "administrator",
        targetId: String(admin._id),
        result: "failure",
        correlationId: req.adminRequestId,
      }).catch(() => {});
      return;
    }
    await AdminAudit.create({
        adminId: admin._id,
        action: "auth.password_reset_requested",
        targetType: "administrator",
        targetId: String(admin._id),
        result: "success",
        correlationId: req.adminRequestId,
    }).catch(() => {
      req.log?.warn(
        { requestId: req.adminRequestId },
        "Admin password reset audit write failed",
      );
    });
  })();
}

export async function resetAdminPassword(token, newPassword) {
  passwordValidator.parse(newPassword);
  const passwordHash = await hashPassword(newPassword);
  await mongoose.connection.transaction(async (session) => {
    const reset = await AdminPasswordReset.findOneAndDelete({
      tokenHash: digest(token),
      expiresAt: { $gt: new Date() },
    }).session(session);
    if (!reset)
      throw fail(
        400,
        "ADMIN_PASSWORD_RESET_INVALID",
        "This reset link is invalid or expired. Request a new one.",
      );
    const admin = await AdminUser.findOneAndUpdate(
      { _id: reset.adminId, active: true },
      { $set: { passwordHash }, $inc: { sessionVersion: 1 } },
      { new: true, session },
    ).lean();
    if (!admin)
      throw fail(
        400,
        "ADMIN_PASSWORD_RESET_INVALID",
        "This reset link is invalid or expired. Request a new one.",
      );
    await Promise.all([
      AdminSession.deleteMany({ adminId: admin._id }, { session }),
      AdminPasswordReset.deleteMany({ adminId: admin._id }, { session }),
      AdminAudit.create(
        [
          {
            adminId: admin._id,
            action: "auth.password_reset_completed",
            targetType: "administrator",
            targetId: String(admin._id),
            result: "success",
          },
        ],
        { session },
      ),
    ]);
  });
}
