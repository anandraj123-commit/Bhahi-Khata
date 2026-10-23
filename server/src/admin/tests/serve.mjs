// Browser-test harness only. Never deploy this file or point it at production.
import mongoose from "mongoose";
import { writeFile } from "node:fs/promises";
import { configureTestEnvironment, fixture } from "./fixture.mjs";
configureTestEnvironment();
const { connectDatabase } = await import("../../config/database.js");
await connectDatabase();
const f = await fixture();
const { createApp } = await import("../../app.js");
const server = createApp().listen(4100, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
await writeFile(
  "/tmp/dk-admin-browser-fixture.json",
  JSON.stringify({
    email: f.superAdmin.email,
    password: f.password,
    supportEmail: f.support.email,
    proxySecret: process.env.ADMIN_PROXY_SECRET,
    run: f.run,
    shopId: String(f.shops[0]._id),
  }),
  { mode: 0o600 },
);
console.log(
  "Admin browser test fixtures ready on localhost:4100; credentials are in a private temporary file.",
);
const shutdown = () =>
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
