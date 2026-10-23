// Run from server/: node src/admin/scripts/provision.mjs --indexes | --bootstrap
// Uses the same configured connection lifecycle as the existing backend, never app.listen().
import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase } from "../../config/database.js";
import { Customer } from "../../models.js";
import { adminConfig } from "../config/index.js";
import {
  adminModels,
  AdminUser,
  AdminControl,
  AdminAudit,
} from "../models/index.js";
import { createAdmin } from "../validators/index.js";
import { hashPassword } from "../utils/security.js";
import { customerAdminIndexes } from "../services/customers.js";
try {
  const mode = process.argv[2];
  if (!["--indexes", "--bootstrap"].includes(mode))
    throw new Error("Use --indexes or --bootstrap explicitly");
  adminConfig();
  const input =
    mode === "--bootstrap"
      ? createAdmin.parse({
          email: process.env.ADMIN_BOOTSTRAP_EMAIL,
          name: process.env.ADMIN_BOOTSTRAP_NAME,
          password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
          role: "SUPER_ADMIN",
        })
      : null;
  delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const passwordHash = input ? await hashPassword(input.password) : null;
  if (input) input.password = "";
  await connectDatabase();
  for (const model of adminModels) {
    const exists = await mongoose.connection.db
      .listCollections({ name: model.collection.collectionName }, { nameOnly: true })
      .hasNext();
    if (!exists) await model.createCollection();
    await model.createIndexes();
  }
  if (mode === "--indexes")
    for (const [keys, options] of customerAdminIndexes)
      await Customer.collection.createIndex(keys, options);
  if (input) {
    await mongoose.connection.transaction(async (session) => {
      if (await AdminUser.countDocuments().session(session))
        throw new Error("Administrators already exist");
      // The marker serializes concurrent bootstrap attempts. If an operator
      // intentionally removed all admin users, retaining the marker must not
      // permanently prevent recovery.
      await AdminControl.updateOne(
        { _id: "bootstrap" },
        { $setOnInsert: { revision: 1 } },
        { upsert: true, session },
      );
      await AdminControl.updateOne(
        { _id: "administrators" },
        { $setOnInsert: { revision: 1 } },
        { upsert: true, session },
      );
      const [admin] = await AdminUser.create(
        [{ ...input, password: undefined, passwordHash, active: true }],
        { session },
      );
      await AdminAudit.create(
        [
          {
            adminId: admin._id,
            action: "administrator.bootstrap",
            targetType: "administrator",
            targetId: String(admin._id),
            result: "success",
          },
        ],
        { session },
      );
    });
    console.log(
      "Super Admin provisioned. Sign in with the provisioned email and password.",
    );
  } else
    console.log(
      "Admin-owned collections and indexes prepared. Existing collections unchanged.",
    );
} catch {
  console.error(
    "Provisioning failed. Check protected credentials, admin configuration, connection, and whether bootstrap already completed. No secrets are printed.",
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
