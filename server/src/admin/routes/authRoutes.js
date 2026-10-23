import { Router } from "express";
import mongoose from "mongoose";
import { credentials, reauth, parse } from "../validators/index.js";
import { authenticate, loginLimit } from "../middleware/security.js";
import { login, verifyCredentials, sessionCookie } from "../services/auth.js";
import { audit, publicAdmin } from "../services/audit.js";
import { AdminUser, AdminSession } from "../models/index.js";
import { csrfToken } from "../utils/security.js";
import { rateLimit } from "express-rate-limit";
import {
  passwordResetCompletion,
  passwordResetRequest,
} from "../validators/index.js";
import {
  requestAdminPasswordReset,
  resetAdminPassword,
} from "../services/passwordReset.js";
const router = Router();
const recoveryRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({
      error: {
        code: "ADMIN_RATE_LIMITED",
        message: "Too many recovery attempts. Try again later.",
      },
    }),
});
router.post("/login", loginLimit, async (req, res) =>
  res.json({ data: await login(req, res, parse(credentials, req.body)) }),
);
router.post("/forgot-password", recoveryRateLimit, async (req, res) => {
  const input = parse(passwordResetRequest, req.body);
  await requestAdminPasswordReset(input.email, req);
  res.status(202).json({
    data: {
      message:
        "If an active administrator account matches that email, a reset link will be sent.",
    },
  });
});
router.post("/reset-password", recoveryRateLimit, async (req, res) => {
  const input = parse(passwordResetCompletion, req.body);
  await resetAdminPassword(input.token, input.newPassword);
  res.json({ data: { success: true } });
});
router.use(authenticate);
router.get("/me", (req, res) =>
  res.json({
    data: {
      administrator: publicAdmin(req.admin),
      permissions: req.adminPermissions,
      csrfToken: csrfToken(req.adminToken, req.adminConfig.proxySecret),
      expiresAt: req.adminSession.expiresAt,
      reauthenticatedAt: req.adminSession.reauthenticatedAt || null,
    },
  }),
);
router.post("/logout", async (req, res) => {
  await mongoose.connection.transaction(async (session) => {
    await AdminSession.deleteOne({ _id: req.adminSession._id }, { session });
    await audit(
      req,
      "auth.logout",
      "administrator",
      req.admin._id,
      {},
      session,
    );
  });
  sessionCookie(res, "", req.adminConfig.production, 0);
  res.json({ data: { success: true } });
});
router.post("/reauth", loginLimit, async (req, res) => {
  const input = parse(reauth, req.body);
  const admin = await AdminUser.findById(req.admin._id)
    .select("+passwordHash")
    .lean();
  await verifyCredentials(admin, input.password);
  const reauthenticatedAt = new Date();
  await AdminSession.updateOne(
    { _id: req.adminSession._id },
    { $set: { reauthenticatedAt } },
  );
  await audit(req, "auth.reauthenticate", "administrator", req.admin._id);
  res.json({ data: { success: true, reauthenticatedAt } });
});
export default router;
