import { Router } from "express";
import mongoose from "mongoose";
import { AdminUser, AdminSession } from "../models/index.js";
import { recentAuthentication, loginLimit } from "../middleware/security.js";
import {
  parse,
  changePassword,
  profile,
  id,
} from "../validators/index.js";
import {
  hashPassword,
} from "../utils/security.js";
import { audit, publicAdmin } from "../services/audit.js";
import { issueSession, sessionCookie } from "../services/auth.js";
const router = Router();
router.get("/", async (req, res) => {
  const sessions = await AdminSession.find({
    adminId: req.admin._id,
    version: req.admin.sessionVersion,
    expiresAt: { $gt: new Date() },
  })
    .select("_id createdAt lastSeenAt expiresAt")
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json({
    data: {
      administrator: publicAdmin(req.admin),
      sessions: sessions.map((s) => ({
        id: String(s._id),
        current: String(s._id) === String(req.adminSession._id),
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
      })),
    },
  });
});
router.patch("/profile", async (req, res) => {
  const input = parse(profile, req.body);
  await mongoose.connection.transaction(async (session) => {
    await AdminUser.updateOne(
      { _id: req.admin._id },
      { $set: input },
      { session },
    );
    await audit(
      req,
      "profile.update",
      "administrator",
      req.admin._id,
      {},
      session,
    );
  });
  res.json({ data: { success: true } });
});
router.post("/password", recentAuthentication, async (req, res) => {
  const input = parse(changePassword, req.body);
  const passwordHash = await hashPassword(input.newPassword);
  await mongoose.connection.transaction(async (session) => {
    await AdminUser.updateOne(
      { _id: req.admin._id },
      { $set: { passwordHash }, $inc: { sessionVersion: 1 } },
      { session },
    );
    await AdminSession.deleteMany({ adminId: req.admin._id }, { session });
    await audit(
      req,
      "password.change",
      "administrator",
      req.admin._id,
      {},
      session,
    );
  });
  sessionCookie(res, "", req.adminConfig.production, 0);
  res.json({ data: { success: true } });
});
router.delete("/sessions/:id", recentAuthentication, async (req, res) => {
  const target = parse(id, req.params.id);
  await mongoose.connection.transaction(async (session) => {
    await AdminSession.deleteOne(
      { _id: target, adminId: req.admin._id },
      { session },
    );
    await audit(req, "session.revoke", "session", target, {}, session);
  });
  if (target === String(req.adminSession._id))
    sessionCookie(res, "", req.adminConfig.production, 0);
  res.json({ data: { success: true } });
});
export default router;
