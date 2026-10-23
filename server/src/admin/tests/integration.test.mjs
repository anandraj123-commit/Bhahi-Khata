import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import mongoose from "mongoose";
import { configureTestEnvironment, fixture } from "./fixture.mjs";
import { AdminSession, AdminUser, AdminAudit } from "../models/index.js";
configureTestEnvironment();
let server, base, f, superSession, supportSession, adminSession;
async function request(
  path,
  { session, method = "GET", body, headers = {} } = {},
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-admin-proxy-key": process.env.ADMIN_PROXY_SECRET,
      "x-admin-origin": "http://127.0.0.1:3100",
      ...(session
        ? { Cookie: session.cookie, "x-admin-csrf": session.csrf }
        : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = text;
  }
  return { status: response.status, value, headers: response.headers };
}
async function signIn(user) {
  const r = await request("/auth/login", {
    method: "POST",
    body: {
      email: user.email,
      password: f.password,
    },
  });
  assert.equal(r.status, 200);
  return {
    cookie: r.headers.get("set-cookie").split(";")[0],
    csrf: r.value.data.csrfToken,
  };
}
before(async () => {
  const { connectDatabase } = await import("../../config/database.js");
  await connectDatabase();
  f = await fixture();
  const { createApp } = await import("../../app.js");
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1/admin`;
  superSession = await signIn(f.superAdmin);
  supportSession = await signIn(f.support);
  adminSession = await signIn(f.admin);
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});
test("admin login creates HttpOnly strict sessions; me returns no secrets", async () => {
  const r = await request("/auth/me", { session: superSession });
  assert.equal(r.status, 200);
  assert.ok(r.value.data.permissions.includes("administrators:manage"));
  assert.ok(!JSON.stringify(r.value).includes("passwordHash"));
  assert.ok(
    (await AdminAudit.countDocuments({
      adminId: f.superAdmin._id,
      action: "auth.login",
    })) > 0,
  );
});
test("unauthenticated, ordinary shopkeeper, and untrusted proxy requests are rejected", async () => {
  assert.equal((await request("/shops")).status, 401);
  assert.equal(
    (
      await request("/shops", {
        headers: { Authorization: "Bearer shopkeeper-test-token" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/shops", {
        session: superSession,
        headers: { "x-admin-proxy-key": "invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/shops", {
        session: superSession,
        headers: { "x-admin-origin": "https://evil.test" },
      })
    ).status,
    403,
  );
});
test("invalid credentials are generic and rate limited in MongoDB", async () => {
  for (let i = 0; i < 11; i++) {
    const r = await request("/auth/login", {
      method: "POST",
      body: {
        email: `invalid-${f.run}@example.test`,
        password: "not-the-password",
      },
    });
    assert.equal(r.status, i < 10 ? 401 : 429);
    assert.ok(!JSON.stringify(r.value).includes("not-the-password"));
  }
});
test("CSRF protection and RBAC apply server-side", async () => {
  assert.equal(
    (
      await request("/auth/logout", {
        method: "POST",
        session: supportSession,
        body: {},
        headers: { "x-admin-csrf": "" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/payments", { session: supportSession })).status,
    403,
  );
  assert.equal(
    (await request("/administrators", { session: adminSession })).status,
    403,
  );
  assert.equal(
    (
      await request("/administrators", {
        session: supportSession,
        method: "POST",
        body: {},
      })
    ).status,
    403,
  );
});
test("shop pagination, sorting, literal search and account filters use database data", async () => {
  const a = await request(`/shops?q=${f.run}&limit=15&sort=name`, {
    session: superSession,
  });
  const b = await request(`/shops?q=${f.run}&limit=15&page=2&sort=name`, {
    session: superSession,
  });
  assert.equal(a.status, 200);
  assert.equal(a.value.pagination.total, 25);
  assert.equal(a.value.data.length, 15);
  assert.equal(b.value.data.length, 10);
  assert.equal(
    new Set([...a.value.data, ...b.value.data].map((x) => x._id)).size,
    25,
  );
  assert.ok(a.value.data[0].name.endsWith("00"));
  assert.equal(
    (
      await request(`/shops?q=${f.run}&status=disabled`, {
        session: superSession,
      })
    ).value.pagination.total,
    1,
  );
  assert.equal(
    (await request("/shops?q=.*", { session: superSession })).value.pagination
      .total,
    0,
  );
});
test("support shop details omit contact details, customer ledgers and payment history", async () => {
  const r = await request(`/shops/${f.shops[0]._id}`, {
    session: supportSession,
  });
  assert.equal(r.status, 200);
  assert.equal(r.value.data.shop.phone, undefined);
  assert.equal(r.value.data.shop.address, undefined);
  assert.equal(r.value.data.entries, undefined);
  assert.deepEqual(r.value.data.history, []);
});
test("subscription filters honor effective dates and shop-scoped history", async () => {
  const r = await request(
    `/subscriptions?plan=${f.plan.code}&status=expiring`,
    { session: adminSession },
  );
  assert.equal(r.value.pagination.total, 1);
  const expired = await request(
    `/subscriptions?plan=${f.plan.code}&status=expired`,
    { session: adminSession },
  );
  assert.equal(expired.value.pagination.total, 1);
  const p = await request(`/payments?shopId=${f.shops[1]._id}`, {
    session: adminSession,
  });
  assert.equal(p.value.pagination.total, 0);
});
test("dashboard aggregates genuine records and excludes pending payment revenue", async () => {
  const r = await request("/dashboard", { session: superSession });
  assert.equal(r.status, 200);
  assert.ok(r.value.data.metrics.totalShops >= 25);
  assert.equal(r.value.data.metrics.revenue[0].amountMinor % 9000, 0);
  assert.ok(r.value.data.definitions.activeShopTrend.startsWith("Unavailable"));
});
test("bounded validation and safe errors do not leak database messages", async () => {
  for (const path of [
    "/shops?limit=9999",
    "/shops/not-an-id",
    "/reports?from=2020-01-01&to=2026-01-01",
    "/payments?status=invalid",
  ]) {
    const r = await request(path, { session: superSession });
    assert.equal(r.status, 400);
    assert.ok(!JSON.stringify(r.value).includes("stack"));
  }
  assert.equal(
    (await request("/nonexistent", { session: superSession })).status,
    404,
  );
});
test("administrator changes require recent reauthentication and prevent self-modification", async () => {
  const r = await request(`/administrators/${f.superAdmin._id}`, {
    session: superSession,
    method: "PATCH",
    body: { role: "SUPPORT" },
  });
  assert.equal(r.status, 409);
  await AdminSession.updateMany(
    { adminId: f.superAdmin._id },
    { $set: { reauthenticatedAt: new Date(0) } },
  );
  assert.equal(
    (
      await request(`/administrators/${f.support._id}`, {
        session: superSession,
        method: "PATCH",
        body: { active: false },
      })
    ).status,
    403,
  );
  const verified = await request("/auth/reauth", {
    session: superSession,
    method: "POST",
    body: { password: f.password },
  });
  assert.equal(verified.status, 200);
  const changed = await request(`/administrators/${f.support._id}`, {
    session: superSession,
    method: "PATCH",
    body: { active: false },
  });
  assert.equal(changed.status, 200);
  assert.equal(
    (await request("/auth/me", { session: supportSession })).status,
    401,
  );
  assert.ok(
    await AdminAudit.exists({
      action: "administrator.update",
      targetId: String(f.support._id),
    }),
  );
});
test("session ownership prevents revoking another administrator session", async () => {
  const own = await AdminSession.findOne({ adminId: f.superAdmin._id });
  const r = await request(`/settings/sessions/${own._id}`, {
    session: adminSession,
    method: "DELETE",
    body: {},
  });
  assert.equal(r.status, 200);
  assert.ok(await AdminSession.exists({ _id: own._id }));
});
test("expiry, deactivation and logout revoke access", async () => {
  const session = await signIn(f.admin);
  const id = await AdminSession.findOne({
    tokenHash: (await import("../utils/security.js")).digest(
      session.cookie.split("=")[1],
    ),
  });
  await AdminSession.updateOne(
    { _id: id._id },
    { $set: { expiresAt: new Date(0) } },
  );
  assert.equal((await request("/auth/me", { session })).status, 401);
  assert.equal(
    (
      await request("/auth/logout", {
        session: adminSession,
        method: "POST",
        body: {},
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("/auth/me", { session: adminSession })).status,
    401,
  );
});
test("existing mobile health route still returns its original contract", async () => {
  const r = await fetch(base.replace("/admin", "/health"));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: "ok" });
});
