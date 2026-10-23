import { Router } from "express";
import mongoose from "mongoose";
import { AdminUser, AdminSession, AdminControl } from "../models/index.js";
import { permit, recentAuthentication } from "../middleware/security.js";
import {
  filters,
  createAdmin,
  updateAdmin,
  id,
  parse,
} from "../validators/index.js";
import { hashPassword, fail } from "../utils/security.js";
import { audit, publicAdmin } from "../services/audit.js";
const router = Router();
router.use(permit("administrators:manage"));
router.get("/", async (req, res) => {
  const f = parse(filters, req.query);
  const query = f.q
    ? {
        email: {
          $regex: f.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        },
      }
    : {};
  const [rows, total] = await Promise.all([
    AdminUser.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip((f.page - 1) * f.limit)
      .limit(f.limit)
      .maxTimeMS(5000)
      .lean(),
    AdminUser.countDocuments(query).maxTimeMS(5000),
  ]);
  res.json({
    data: rows.map(publicAdmin),
    pagination: { page: f.page, limit: f.limit, total },
  });
});
router.post("/", recentAuthentication, async (req, res) => {
  const input = parse(createAdmin, req.body);
  const passwordHash = await hashPassword(input.password);
  let admin;
  await mongoose.connection.transaction(async (session) => {
    await AdminControl.updateOne(
      { _id: "administrators" },
      { $inc: { revision: 1 } },
      { session },
    );
    [admin] = await AdminUser.create(
      [
        {
          email: input.email,
          name: input.name,
          role: input.role,
          passwordHash,
          active: true,
        },
      ],
      { session },
    );
    await audit(
      req,
      "administrator.create",
      "administrator",
      admin._id,
      { role: input.role },
      session,
    );
  });
  res.status(201).json({ data: publicAdmin(admin) });
});
router.patch("/:id", recentAuthentication, async (req, res) => {
  const target = parse(id, req.params.id);
  const input = parse(updateAdmin, req.body);
  if (String(req.admin._id) === target)
    throw fail(
      409,
      "ADMIN_SELF_CHANGE_DENIED",
      "Another Super Admin must change your role or account status",
    );
  let updated;
  await mongoose.connection.transaction(async (session) => {
    // Serialize all privilege mutations; concurrent demotions cannot remove the last Super Admin.
    await AdminControl.updateOne(
      { _id: "administrators" },
      { $inc: { revision: 1 } },
      { session },
    );
    const previous = await AdminUser.findById(target).session(session).lean();
    if (!previous)
      throw fail(404, "ADMIN_NOT_FOUND", "Administrator not found");
    if (
      previous.active &&
      previous.role === "SUPER_ADMIN" &&
      (input.active === false ||
        (input.role && input.role !== "SUPER_ADMIN")) &&
      (await AdminUser.countDocuments({
        active: true,
        role: "SUPER_ADMIN",
      }).session(session)) <= 1
    )
      throw fail(
        409,
        "ADMIN_LAST_SUPER_ADMIN",
        "At least one active Super Admin is required",
      );
    updated = await AdminUser.findByIdAndUpdate(
      target,
      { $set: input, $inc: { sessionVersion: 1 } },
      { new: true, session },
    ).lean();
    await AdminSession.deleteMany({ adminId: target }, { session });
    await audit(
      req,
      "administrator.update",
      "administrator",
      target,
      {
        previousRole: previous.role,
        role: updated.role,
        active: String(updated.active),
      },
      session,
    );
  });
  res.json({ data: publicAdmin(updated) });
});
export default router;
