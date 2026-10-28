// Explicit administrator recovery command. Run from server/ after setting
// ADMIN_RESET_EMAIL and ADMIN_RESET_PASSWORD in protected environment input.
// Production requires the additional --confirm-production flag.
import "../../config/startupGuard.js";
import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { connectDatabase } from "../../config/database.js";
import { AdminUser, AdminSession, AdminAudit } from "../models/index.js";
import { credentials, password as passwordValidator } from "../validators/index.js";
import { hashPassword } from "../utils/security.js";

try {
  const input = credentials.parse({
    email: process.env.ADMIN_RESET_EMAIL,
    password: process.env.ADMIN_RESET_PASSWORD,
  });
  passwordValidator.parse(input.password);
  const confirmProduction = process.argv.includes("--confirm-production");
  delete process.env.ADMIN_RESET_PASSWORD;

  if (env.APP_MODE === "production" && !confirmProduction)
    throw new Error("Production reset requires explicit confirmation");

  const passwordHash = await hashPassword(input.password);
  await connectDatabase();

  await mongoose.connection.transaction(async (session) => {
    const admin = await AdminUser.findOne({ email: input.email })
      .session(session)
      .lean();
    if (!admin?.active) throw new Error("Active administrator not found");

    await AdminUser.updateOne(
      { _id: admin._id },
      { $set: { passwordHash }, $inc: { sessionVersion: 1 } },
      { session },
    );
    await AdminSession.deleteMany({ adminId: admin._id }, { session });
    await AdminAudit.create(
      [
        {
          adminId: admin._id,
          action: "administrator.password_reset",
          targetType: "administrator",
          targetId: String(admin._id),
          result: "success",
          metadata: { method: "explicit_backend_recovery_command" },
        },
      ],
      { session },
    );
  });

  console.log(
    "Administrator password reset. Existing sessions were revoked.",
  );
} catch {
  console.error(
    "Password reset failed. Check protected credentials, database connection, target account, and production confirmation. No secrets are printed.",
  );
  process.exitCode = 1;
} finally {
  delete process.env.ADMIN_RESET_PASSWORD;
  await mongoose.disconnect();
}
