import { AdminAudit } from "../models/index.js";
export async function audit(
  req,
  action,
  targetType,
  targetId,
  metadata = {},
  session,
  result = "success",
) {
  // Call sites supply an allowlisted set of role/status/count metadata only.
  const record = {
    adminId: req.admin?._id,
    action,
    targetType,
    targetId: targetId ? String(targetId) : undefined,
    result,
    correlationId: req.adminRequestId,
    metadata,
  };
  await AdminAudit.create([record], session ? { session } : {});
}
export const publicAdmin = (user) => ({
  id: String(user._id),
  email: user.email,
  name: user.name,
  role: user.role,
  active: user.active,
  lastLoginAt: user.lastLoginAt || null,
  createdAt: user.createdAt,
});
