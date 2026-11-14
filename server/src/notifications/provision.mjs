// Explicit metadata/provisioning command. Never imports API startup, workers or models.
import "../config/startupGuard.js";
import mongoose from "mongoose";
import { env } from "../config/env.js";
export const indexes = {
  notificationmedia: [
    {
      name: "notification_media_environment",
      key: { appMode: 1, createdAt: 1 },
    },
  ],
  devices: [
    { name: "notification_device_ownership", key: { token: 1, shopId: 1 } },
  ],
  adminnotifications: [
    {
      name: "notification_inbox_eligibility",
      key: { appMode: 1, status: 1, displayOn: -1, _id: -1 },
    },
    {
      name: "notification_due",
      key: { appMode: 1, status: 1, state: 1, displayOn: 1 },
    },
    {
      name: "notification_admin_listing",
      key: { appMode: 1, createdAt: -1, _id: -1 },
    },
  ],
  notifications: [
    {
      name: "notification_campaign_recipient",
      key: { campaignId: 1, shopId: 1, recipientUserId: 1 },
    },
    {
      name: "notification_receipts_due",
      key: { campaignMode: 1, receiptState: 1, receiptNextAt: 1, _id: 1 },
    },
    { name: "notification_inbox", key: { shopId: 1, createdAt: -1, _id: -1 } },
    { name: "notification_delivery", key: { campaignId: 1, pushState: 1 } },
    {
      name: "notification_dispatch",
      key: {
        campaignMode: 1,
        pushState: 1,
        pushNextAt: 1,
        createdAt: 1,
        _id: 1,
      },
    },
  ],
};
try {
  const args = process.argv.slice(2);
  const apply = args[0] === "--apply";
  if (
    !["--check", "--apply"].includes(args[0]) ||
    (apply
      ? args.length !== 3 ||
        args[1] !== "--confirm-db" ||
        args[2] !== env.MONGODB_DB_NAME
      : args.length !== 1)
  )
    throw Error(
      "Use --check, or --apply --confirm-db with the exact selected database name",
    );
  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.MONGODB_DB_NAME,
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 5000,
  });
  const db = mongoose.connection.db;
  if (db.databaseName !== env.MONGODB_DB_NAME) throw Error("Database mismatch");
  const hello = await db.command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid")
    throw Error("Replica-set or sharded transactions required");
  // Require existing application prerequisites; never provision unrelated collections.
  const prerequisites = {};
  for (const name of [
    "notifications",
    "shops",
    "users",
    "devices",
    "adminaudits",
  ])
    prerequisites[name] = await db
      .listCollections({ name }, { nameOnly: true })
      .hasNext();
  if (apply && Object.values(prerequisites).some((v) => !v))
    throw Error(
      "Application prerequisites missing; provision the existing application first",
    );
  const results = [];
  for (const [name, specs] of Object.entries(indexes)) {
    let exists = await db
      .listCollections({ name }, { nameOnly: true })
      .hasNext();
    if (!exists && apply) {
      try {
        await db.createCollection(name);
      } catch (e) {
        if (e.code !== 48) throw e;
      }
      exists = true;
    }
    let existing = exists
      ? await db.collection(name).listIndexes().toArray()
      : [];
    for (const spec of specs) {
      const same = existing.find(
        (i) =>
          JSON.stringify(i.key) === JSON.stringify(spec.key) &&
          !i.partialFilterExpression &&
          !i.sparse &&
          !i.hidden &&
          !i.collation &&
          !i.unique,
      );
      if (!same && existing.some((i) => i.name === spec.name))
        throw Error("Index name conflict; manual review required");
      if (!same && apply) {
        await db.collection(name).createIndex(spec.key, { name: spec.name });
        existing = await db.collection(name).listIndexes().toArray();
      }
      results.push({
        collection: name,
        index: same?.name || spec.name,
        present: !!same || apply,
        created: apply && !same,
      });
    }
  }
  console.log(
    JSON.stringify({
      mode: env.APP_MODE,
      action: apply ? "provision" : "read-only",
      transactionsSupported: true,
      prerequisites,
      indexes: results,
    }),
  );
  if (
    !apply &&
    (results.some((r) => !r.present) ||
      Object.values(prerequisites).some((v) => !v))
  )
    process.exitCode = 2;
} catch (e) {
  // Driver errors can contain credentials/hostnames; output only controlled diagnostic fields.
  console.error(
    JSON.stringify({
      code: "NOTIFICATION_PROVISIONING_INCOMPLETE",
      errorName: e.name,
      driverCode: typeof e.code === "number" ? e.code : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
