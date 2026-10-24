import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import mongoose from "mongoose";
import { configureTestEnvironment, fixture } from "./fixture.mjs";
import { AdminSession, AdminUser, AdminAudit } from "../models/index.js";
import { Customer, Entry, PaymentTransaction, ShopSubscription } from "../../models.js";
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
test("customer reads enforce authentication and customer permission", async () => {
  assert.equal((await request("/customers")).status, 401);
  assert.equal((await request("/customers", { session: supportSession })).status, 403);
  assert.equal((await request("/shops/" + f.shops[0]._id + "/customers", { session: supportSession })).status, 403);
});
test("customer list uses registered-shop relationships and preserves lifecycle states", async () => {
  const r = await request(`/customers?shopId=${f.shops[0]._id}`, { session: adminSession });
  assert.equal(r.status, 200);
  assert.equal(r.value.pagination.total, 4);
  assert.equal(r.value.summary.total, 4);
  assert.equal(r.value.summary.active, 2);
  assert.equal(r.value.summary.disabled, 1);
  assert.equal(r.value.summary.removed, 1);
  assert.deepEqual(new Set(r.value.data.map((row) => row.status)), new Set(["active", "disabled", "removed"]));
  assert.ok(r.value.data.every((row) => row.shopId === String(f.shops[0]._id)));
  assert.ok(r.value.data.every((row) => !("phone" in row) && !("address" in row) && !("openingPaise" in row)));
  assert.ok(!r.value.data.some((row) => row.customerId.startsWith("tombstone-") || row.customerId.startsWith("orphan-")));
  assert.ok(r.value.data.some((row) => row.customerId.startsWith("legacy-") && row.status === "active"));
  const empty = await request(`/customers?shopId=${f.shops[0]._id}&q=no-matching-customer`, { session: adminSession });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.value.data, []);
  assert.equal(empty.value.pagination.total, 0);
  assert.equal(empty.value.summary.total, 4);
});
test("customer pagination is bounded and stable; search supports name, identifier and shop", async () => {
  const first = await request(`/customers?shopId=${f.shops[0]._id}&limit=1`, { session: superSession });
  const second = await request(`/customers?shopId=${f.shops[0]._id}&limit=1&page=2`, { session: superSession });
  assert.equal(first.value.pagination.total, 4);
  assert.equal(first.value.pagination.pages, 4);
  assert.equal(first.value.data.length, 1);
  assert.notEqual(first.value.data[0]._id, second.value.data[0]._id);
  assert.equal((await request(`/customers?q=Customer%20Active%20${f.run}`, { session: adminSession })).value.pagination.total, 1);
  assert.equal((await request(`/customers?q=active-${f.run}`, { session: adminSession })).value.pagination.total, 1);
  assert.equal((await request(`/customers?q=Admin%20Test%20${f.run}%2000`, { session: adminSession })).value.pagination.total, 4);
  assert.equal((await request(`/customers?limit=101`, { session: adminSession })).status, 400);
  assert.equal((await request(`/customers?status=unknown`, { session: adminSession })).status, 400);
});
test("shop customer list is isolated and customer detail is projected", async () => {
  const list = await request(`/shops/${f.shops[0]._id}/customers?limit=100`, { session: adminSession });
  assert.equal(list.status, 200);
  assert.equal(list.value.data.length, 4);
  const row = list.value.data.find((item) => item.status === "removed");
  const detail = await request(`/customers/${row._id}`, { session: superSession });
  assert.equal(detail.status, 200);
  assert.equal(detail.value.data.status, "removed");
  assert.equal(detail.value.data.shopId, String(f.shops[0]._id));
  assert.deepEqual(Object.keys(detail.value.data).sort(), ["_id", "createdAt", "customerId", "name", "shopId", "shopName", "status", "updatedAt"].sort());
  assert.equal((await request(`/customers/${new mongoose.Types.ObjectId()}`, { session: adminSession })).status, 404);
  assert.equal((await request(`/shops/${new mongoose.Types.ObjectId()}/customers`, { session: adminSession })).status, 404);
});
test("customer shop selector returns bounded real shop options", async () => {
  const r = await request(`/customer-shops?q=${f.run}%2000`, { session: adminSession });
  assert.equal(r.status, 200);
  assert.equal(r.value.data.length, 1);
  assert.equal(r.value.data[0].id, String(f.shops[0]._id));
  assert.equal(r.value.pagination.total, 1);
});
test("customer financial summary and period statement reconcile with mobile ledger rules", async () => {
  const customer = await Customer.create({
    shopId: f.shops[10]._id,
    clientId: `financial-${f.run}`,
    name: `Financial customer ${f.run}`,
    nameFolded: `financial customer ${f.run}`,
    openingPaise: 10000,
    openingAdvancePaise: 3000,
    openingDate: "2026-01-01",
    status: true,
    disabled: false,
    removed: false,
  });
  const entries = [
    ["credit", 5000, "2026-01-02", "credit-1"],
    ["payment", 4000, "2026-01-03", "payment-1"],
    ["payment", 6000, "2026-01-04", "payment-2"],
    ["payment", 5000, "2026-01-05", "payment-3"],
    ["credit", 2000, "2026-01-06", "credit-2"],
    ["refund", 500, "2026-01-07", "refund-1"],
    ["payment", 99900, "2026-01-08", "deleted-payment"],
  ];
  await Entry.create(entries.map(([type, amountPaise, date, clientId], index) => ({
    shopId: customer.shopId,
    customerClientId: customer.clientId,
    type,
    amountPaise,
    date,
    clientId: `${clientId}-${f.run}`,
    ...(index === 4 ? { resolutionVersion: 2 } : {}),
    ...(index === 6 ? { deletedAt: new Date("2026-01-09T00:00:00Z") } : {}),
  })));
  const beforeCustomer = await Customer.findById(customer._id).lean();
  const beforeEntries = await Entry.find({ shopId: customer.shopId, customerClientId: customer.clientId }).lean();
  assert.equal((await request(`/customers/${customer._id}/financial-summary`, { session: supportSession })).status, 403);
  const summary = await request(`/customers/${customer._id}/financial-summary`, { session: adminSession });
  assert.equal(summary.status, 200);
  assert.deepEqual(
    ["outstandingPaise", "availableAdvancePaise", "totalUdhariPaise", "totalReceivedPaise", "totalUdhariRecoveredPaise", "totalAdvanceDepositedPaise", "totalAdvanceRefundedPaise"].map((key) => summary.value.data[key]),
    [0, 500, 17000, 18000, 15000, 6000, 500],
  );
  assert.equal(summary.value.data.currentNetBalancePaise, -500);
  const statement = await request(`/customers/${customer._id}/statement?from=2026-01-03&to=2026-01-05`, { session: superSession });
  assert.equal(statement.status, 200);
  assert.deepEqual(
    [statement.value.data.openingBalancePaise, statement.value.data.closingBalancePaise, statement.value.data.transactionCount, statement.value.data.totalMoneyReceivedPaise],
    [12000, -3000, 3, 15000],
  );
  const page = await request(`/customers/${customer._id}/transactions?limit=2`, { session: adminSession });
  assert.equal(page.status, 200);
  assert.equal(page.value.pagination.total, 7);
  assert.equal(page.value.data.length, 2);
  assert.equal(page.value.openingEntries.length, 3);
  const tombstone = await request(`/customers/${customer._id}/transactions?status=voided`, { session: adminSession });
  assert.equal(tombstone.value.pagination.total, 1);
  assert.equal(tombstone.value.data[0].status, "voided");
  const resolved = await request(`/customers/${customer._id}/transactions?status=conflict_resolved`, { session: adminSession });
  assert.equal(resolved.value.pagination.total, 1);
  const filtered = await request(`/customers/${customer._id}/transactions?type=payment&from=2026-01-03&to=2026-01-05`, { session: adminSession });
  assert.equal(filtered.value.pagination.total, 3);
  assert.ok((await AdminAudit.countDocuments({ targetId: String(customer._id), action: { $in: ["customer.financial_summary.read", "customer.transactions.read", "customer.statement.read"] } })) >= 5);
  assert.deepEqual(await Customer.findById(customer._id).lean(), beforeCustomer);
  assert.deepEqual(await Entry.find({ shopId: customer.shopId, customerClientId: customer.clientId }).lean(), beforeEntries);
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
test("admin payment rows include the purchased plan, Cashfree references and subscription dates", async () => {
  const transaction = await PaymentTransaction.findOne({ shopId: f.shops[0]._id, gatewayPaymentId: `pay_${f.run}` });
  const startsAt = new Date("2026-02-01T00:00:00.000Z");
  const expiresAt = new Date("2026-03-01T00:00:00.000Z");
  await ShopSubscription.create({
    shopId: f.shops[0]._id,
    planId: f.plan._id,
    planCode: f.plan.code,
    planSnapshot: { code: f.plan.code, name: f.plan.name },
    status: "active",
    startsAt,
    expiresAt,
    sourcePaymentId: transaction._id,
  });
  const result = await request(`/payments?shopId=${f.shops[0]._id}`, { session: adminSession });
  assert.equal(result.status, 200);
  const payment = result.value.data.find((item) => item.gatewayPaymentId === `pay_${f.run}`);
  assert.ok(payment);
  assert.equal(payment.planCode, f.plan.code);
  assert.equal(payment.durationMonths, 1);
  assert.equal(payment.gatewayOrderId, `order_${f.run}`);
  assert.equal(payment.amountMinor, 10000);
  assert.equal(new Date(payment.subscriptionStartsAt).toISOString(), startsAt.toISOString());
  assert.equal(new Date(payment.subscriptionExpiresAt).toISOString(), expiresAt.toISOString());
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
  assert.equal(
    (await request(`/administrators/${f.superAdmin._id}`, {
      session: superSession,
      method: "PATCH",
      body: { role: "SUPPORT" },
    })).status,
    403,
  );
  assert.equal((await request("/auth/reauth", {
    session: superSession,
    method: "POST",
    body: { password: f.password },
  })).status, 200);
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
  assert.equal((await request("/auth/reauth", {
    session: adminSession,
    method: "POST",
    body: { password: f.password },
  })).status, 200);
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

test("plan limits are editable only by authorized administrators and persist with audit", async () => {
  const { SubscriptionPlan } = await import("../../models.js");
  const { AdminUser } = await import("../models/index.js");
  const { hashPassword } = await import("../utils/security.js");
  const currentAdminSession = await signIn(f.admin);
  const currentSuperSession = await signIn(f.superAdmin);
  const [freshSupport] = await AdminUser.create([{
    email: `plan-support-${f.run}@example.test`,
    name: "Plan Support Test",
    role: "SUPPORT",
    passwordHash: await hashPassword(f.password),
    active: true,
  }]);
  const currentSupportSession = await signIn(freshSupport);
  const byCode = Object.fromEntries(f.standardPlans.map((p) => [p.code, p]));
  const patchLimit = async (plan, session, customerLimit, unlimitedCustomers) => {
    const current = await SubscriptionPlan.findById(plan._id).lean();
    return request(`/plans/${plan._id}/customer-limit`, {
      session,
      method: "PATCH",
      body: {
        customerLimit,
        unlimitedCustomers,
        expectedVersion: current.configurationVersion || 1,
      },
    });
  };

  const listed = await request("/plans", { session: currentAdminSession });
  assert.equal(listed.status, 200, JSON.stringify(listed.value));
  const listedCodes = new Set(listed.value.data.map((p) => p.code));
  assert.equal(listedCodes.size, 3);
  for (const code of ["free", "pro", "business"])
    assert.ok(listedCodes.has(code));
  assert.equal(
    (await patchLimit(byCode.free, currentSupportSession, 100, false)).status,
    403,
  );
  assert.equal(
    (await patchLimit(byCode.free, undefined, 100, false)).status,
    401,
  );
  assert.equal((await patchLimit(byCode.free, currentAdminSession, 100, false)).status, 200);
  assert.equal((await patchLimit(byCode.pro, currentSuperSession, 1000, false)).status, 200);
  assert.equal((await patchLimit(byCode.business, currentAdminSession, 5000, false)).status, 200);
  assert.equal((await patchLimit(byCode.free, currentAdminSession, null, true)).status, 200);
  assert.equal((await patchLimit(byCode.pro, currentAdminSession, null, true)).status, 200);

  for (const [customerLimit, unlimitedCustomers] of [
    [0, false],
    [-2, false],
    [1.5, false],
    [null, false],
    [500, true],
  ]) {
    assert.equal(
      (await patchLimit(byCode.free, currentAdminSession, customerLimit, unlimitedCustomers)).status,
      400,
    );
  }

  const stored = await SubscriptionPlan.find({ code: { $in: ["free", "pro", "business"] } })
    .sort({ displayOrder: 1 })
    .lean();
  assert.equal(stored[0].unlimitedCustomers, true);
  assert.equal(stored[1].unlimitedCustomers, true);
  assert.equal(stored[2].customerLimit, 5000);
  assert.equal(stored[2].unlimitedCustomers, false);
  const audit = await AdminAudit.find({
    action: "plan.customer_limit.update",
    targetId: String(byCode.business._id),
  }).lean();
  assert.ok(audit.some((row) => row.metadata?.previousLimit === "unlimited" && row.metadata?.newLimit === "5000"));
});

test("duration pricing is protected, independently editable, audited, and leaves purchased snapshots unchanged", async () => {
  const { PaymentOrder, SubscriptionPlan } = await import("../../models.js");
  const { quoteSubscription } = await import("../../services/subscriptionService.js");
  const { hashPassword } = await import("../utils/security.js");
  const supportUser = await AdminUser.create({
    email: `pricing-support-${f.run}@example.test`,
    name: "Pricing Support",
    role: "SUPPORT",
    passwordHash: await hashPassword(f.password),
    active: true,
  });
  const adminSessionForPlanEdit = await signIn(f.superAdmin);
  const supportSessionForPlanEdit = await signIn(supportUser);
  const pro = await SubscriptionPlan.findOne({ code: "pro" }).lean();
  const business = await SubscriptionPlan.findOne({ code: "business" }).lean();
  const free = await SubscriptionPlan.findOne({ code: "free" }).lean();
  const shop = f.shops[13];
  const originalPro = pro;
  const originalBusiness = business;
  const originalFree = free;
  const oldPricingSnapshot = {
    plan: { code: "pro", name: "Pro", customerLimit: 500, unlimitedCustomers: false, configurationVersion: pro.configurationVersion },
    months: 6,
    basePriceMinor: 119400,
    discountPercent: 0,
    discountAmountMinor: 0,
    taxableAmountMinor: 119400,
    taxPercent: 0,
    taxAmountMinor: 0,
    finalAmountMinor: 119400,
    currency: "INR",
    pricingVersion: pro.pricingVersion || 1,
  };
  const order = await PaymentOrder.create({
    shopId: shop._id,
    userId: shop.ownerId,
    appMode: "testing",
    planId: pro._id,
    planCode: "pro",
    durationMonths: 6,
    amountMinor: oldPricingSnapshot.finalAmountMinor,
    currency: "INR",
    pricingSnapshot: oldPricingSnapshot,
    idempotencyKey: `pricing-snapshot-${f.run}`,
    requestHash: `pricing-snapshot-${f.run}`,
    status: "pending",
  });
  const [subscription] = await ShopSubscription.create([{
    shopId: shop._id,
    planId: pro._id,
    planCode: "pro",
    planSnapshot: oldPricingSnapshot.plan,
    pricingSnapshot: oldPricingSnapshot,
    status: "active",
    startsAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 30 * 86400_000),
    durationMonths: 6,
    amountPaidMinor: oldPricingSnapshot.finalAmountMinor,
  }]);
  const restorePlan = async (original) => SubscriptionPlan.updateOne(
    { _id: original._id },
    { $set: {
      name: original.name,
      description: original.description,
      features: original.features || [],
      entitlements: original.entitlements || {},
      monthlyPriceMinor: original.monthlyPriceMinor,
      currency: original.currency,
      customerLimit: original.customerLimit,
      unlimitedCustomers: original.unlimitedCustomers,
      enabled: original.enabled,
      displayOrder: original.displayOrder,
      durations: original.durations || [],
      configurationVersion: original.configurationVersion || 1,
      pricingVersion: original.pricingVersion || 1,
      updatedByAdminId: original.updatedByAdminId,
      createdByAdminId: original.createdByAdminId,
    } },
  );
  const payloadFor = (plan, overrides = {}) => ({
    expectedVersion: plan.configurationVersion || 1,
    name: plan.name,
    description: plan.description || "",
    customerLimit: plan.customerLimit,
    unlimitedCustomers: Boolean(plan.unlimitedCustomers),
    features: plan.features || [],
    entitlements: plan.entitlements || {},
    enabled: plan.enabled,
    displayOrder: plan.displayOrder,
    durations: plan.code === "free" ? [] : plan.durations.map((duration) => ({
      months: duration.months,
      basePriceMinor: duration.basePriceMinor,
      discountPercent: duration.discountPercent,
      taxPercent: duration.taxPercent ?? 0,
      isActive: duration.isActive !== false,
    })),
    ...overrides,
  });
  try {
    const unauthenticated = await request(`/plans/${pro._id}`, {
      method: "PATCH", body: payloadFor(pro),
    });
    assert.equal(unauthenticated.status, 401);
    const unauthorized = await request(`/plans/${pro._id}`, {
      session: supportSessionForPlanEdit, method: "PATCH", body: payloadFor(pro),
    });
    assert.equal(unauthorized.status, 403);
    assert.equal((await request("/plans", { session: supportSessionForPlanEdit })).status, 403);
    const needsReauth = await request(`/plans/${pro._id}`, {
      session: adminSessionForPlanEdit, method: "PATCH", body: payloadFor(pro),
    });
    assert.equal(needsReauth.status, 403);
    const { digest } = await import("../utils/security.js");
    const adminDbSession = await AdminSession.findOne({
      tokenHash: digest(adminSessionForPlanEdit.cookie.split("=")[1]),
    });
    await AdminSession.updateOne(
      { _id: adminDbSession._id },
      { $set: { reauthenticatedAt: new Date(Date.now() - 5 * 60_000) } },
    );
    assert.equal((await request(`/plans/${pro._id}`, {
      session: adminSessionForPlanEdit, method: "PATCH", body: payloadFor(pro),
    })).status, 403, "the exact five-minute boundary is expired");
    await AdminSession.updateOne(
      { _id: adminDbSession._id },
      { $set: { reauthenticatedAt: new Date(Date.now() + 60_000) } },
    );
    assert.equal((await request(`/plans/${pro._id}`, {
      session: adminSessionForPlanEdit, method: "PATCH", body: payloadFor(pro),
    })).status, 403, "future-dated verification is rejected");
    assert.equal((await request("/auth/reauth", {
      session: adminSessionForPlanEdit, method: "POST", body: { password: f.password },
    })).status, 200);
    const refreshedSession = await request("/auth/me", { session: adminSessionForPlanEdit });
    assert.ok(refreshedSession.value.data.reauthenticatedAt);

    const invalidDiscount = payloadFor(pro, {
      durations: payloadFor(pro).durations.map((duration) => duration.months === 1
        ? { ...duration, discountPercent: 100 } : duration),
    });
    assert.equal((await request(`/plans/${pro._id}`, { session: adminSessionForPlanEdit, method: "PATCH", body: invalidDiscount })).status, 400);
    const duplicateMonths = payloadFor(pro, { durations: [payloadFor(pro).durations[0], ...payloadFor(pro).durations.slice(1).map((duration) => ({ ...duration, months: 1 }))] });
    assert.equal((await request(`/plans/${pro._id}`, { session: adminSessionForPlanEdit, method: "PATCH", body: duplicateMonths })).status, 400);
    assert.equal((await request(`/plans/${free._id}`, {
      session: adminSessionForPlanEdit, method: "PATCH", body: payloadFor(free, { enabled: false }),
    })).status, 400);

    const proPayload = payloadFor(pro, {
      durations: payloadFor(pro).durations.map((duration) => duration.months === 6
        ? { ...duration, basePriceMinor: 120000, discountPercent: 20, taxPercent: 5 }
        : duration),
    });
    const updatedPro = await request(`/plans/${pro._id}`, { session: adminSessionForPlanEdit, method: "PATCH", body: proPayload });
    assert.equal(updatedPro.status, 200, JSON.stringify(updatedPro.value));
    const quote = quoteSubscription(await SubscriptionPlan.findById(pro._id).lean(), 6);
    assert.equal(quote.basePriceMinor, 120000);
    assert.equal(quote.discountAmountMinor, 24000);
    assert.equal(quote.taxableAmountMinor, 96000);
    assert.equal(quote.taxAmountMinor, 4800);
    assert.equal(quote.finalAmountMinor, 100800);

    const latestBusiness = await SubscriptionPlan.findOne({ code: "business" }).lean();
    const businessPayload = payloadFor(latestBusiness, {
      durations: payloadFor(latestBusiness).durations.map((duration) => duration.months === 3
        ? { ...duration, basePriceMinor: 155000, discountPercent: 3.5, taxPercent: 8.25 }
        : duration),
    });
    const updatedBusiness = await request(`/plans/${latestBusiness._id}`, { session: adminSessionForPlanEdit, method: "PATCH", body: businessPayload });
    assert.equal(updatedBusiness.status, 200, JSON.stringify(updatedBusiness.value));
    assert.equal(updatedBusiness.value.data.durations.find((duration) => duration.months === 3).taxPercent, 8.25);

    const listed = await request("/plans", { session: adminSessionForPlanEdit });
    assert.deepEqual(listed.value.data.map((plan) => plan.code), ["free", "pro", "business"]);
    assert.equal((await PaymentOrder.findById(order._id).lean()).pricingSnapshot.finalAmountMinor, 119400);
    const afterSubscription = await ShopSubscription.findById(subscription._id).lean();
    assert.equal(afterSubscription.pricingSnapshot.finalAmountMinor, 119400);
    assert.equal(afterSubscription.planSnapshot.customerLimit, 500);
    const auditRows = await AdminAudit.find({ action: "plan.configuration.update", targetId: String(pro._id) }).lean();
    assert.ok(auditRows.some((row) => row.metadata?.previousValues?.includes('"taxPercent":0')));
    assert.ok(auditRows.some((row) => row.metadata?.updatedValues?.includes('"taxPercent":5')));
  } finally {
    await restorePlan(originalPro);
    await restorePlan(originalBusiness);
    await restorePlan(originalFree);
    await PaymentOrder.deleteOne({ _id: order._id });
    await ShopSubscription.deleteOne({ _id: subscription._id });
    await AdminSession.deleteMany({ adminId: supportUser._id });
    await AdminUser.deleteOne({ _id: supportUser._id });
  }
});

test("plan customer limits persist through refresh and existing capacity logic honors live Free limits but keeps paid snapshots", async () => {
  const {
    Customer,
    Entry,
    ShopSubscription,
    SubscriptionPlan,
    SubscriptionUsage,
  } = await import("../../models.js");
  const { reserveCustomerCapacity } = await import("../../services/subscriptionService.js");
  const free = await SubscriptionPlan.findOne({ code: "free" });
  const pro = await SubscriptionPlan.findOne({ code: "pro" });
  // Restore the isolated test plans to the required baseline for this independent test.
  await SubscriptionPlan.updateOne({ _id: free._id }, { $set: { customerLimit: 100, unlimitedCustomers: false } });
  await SubscriptionPlan.updateOne({ _id: pro._id }, { $set: { customerLimit: 1000, unlimitedCustomers: false } });
  const refreshed = await SubscriptionPlan.findById(free._id).lean();
  assert.equal(refreshed.customerLimit, 100);

  const freeShop = f.shops[5];
  await SubscriptionUsage.create({ shopId: freeShop._id, activeCustomers: 99 });
  const customersBefore = await Customer.countDocuments({});
  const entriesBefore = await Entry.countDocuments({});
  await mongoose.connection.transaction((session) =>
    reserveCustomerCapacity({ shopId: freeShop._id, session }),
  );
  await assert.rejects(
    mongoose.connection.transaction((session) =>
      reserveCustomerCapacity({ shopId: freeShop._id, session }),
    ),
    (error) => error.code === "CUSTOMER_LIMIT_REACHED",
  );

  const paidShop = f.shops[6];
  await ShopSubscription.create({
    shopId: paidShop._id,
    planId: pro._id,
    planCode: "pro",
    planSnapshot: { customerLimit: 500, unlimitedCustomers: false },
    status: "active",
    startsAt: new Date(Date.now() - 60000),
    expiresAt: new Date(Date.now() + 86400000),
  });
  await SubscriptionUsage.create({ shopId: paidShop._id, activeCustomers: 500 });
  await assert.rejects(
    mongoose.connection.transaction((session) =>
      reserveCustomerCapacity({ shopId: paidShop._id, session }),
    ),
    (error) => error.code === "CUSTOMER_LIMIT_REACHED",
  );
  assert.equal(await Customer.countDocuments({}), customersBefore);
  assert.equal(await Entry.countDocuments({}), entriesBefore);
});

test("referral rewards credit both shops exactly once after the configured active-customer threshold", async () => {
  const { Referral, ReferralProgramSettings, WalletAccount, WalletLedgerEntry, Shop } = await import("../../models.js");
  const { attachReferral, qualifyReferralInTransaction } = await import("../../services/referralService.js");
  const referrer = f.shops[23];
  const referred = f.shops[24];
  const referralCode = String(referrer._id).slice(-10).toUpperCase();
  await Shop.updateOne({ _id: referrer._id }, { $set: { referralCode } });
  await ReferralProgramSettings.updateOne(
    { _id: "default" },
    { $set: {
      enabled: true,
      rewardAmountMinor: 12500,
      referrerRewardAmountMinor: 12500,
      referredRewardAmountMinor: 7500,
      minimumCustomers: 2,
      revision: 7,
    } },
    { upsert: true },
  );
  await mongoose.connection.transaction((session) => attachReferral({
    referralCode,
    referredShopId: referred._id,
    referredOwnerId: referred.ownerId,
    session,
  }));
  const suffix = String(referred._id).slice(-8);
  for (let i = 0; i < 2; i++) {
    await Customer.create([{
      shopId: referred._id,
      clientId: `referral-customer-${suffix}-${i}`,
      name: `Referral customer ${i}`,
      nameFolded: `referral customer ${i}`,
      status: true,
      disabled: false,
      removed: false,
    }]);
  }
  await mongoose.connection.transaction((session) => qualifyReferralInTransaction(referred._id, session));
  await mongoose.connection.transaction((session) => qualifyReferralInTransaction(referred._id, session));
  const referral = await Referral.findOne({ referredShopId: referred._id }).lean();
  assert.equal(referral.status, "rewarded");
  assert.equal(referral.referrerRewardAmountMinor, 12500);
  assert.equal(referral.referredRewardAmountMinor, 7500);
  assert.equal((await WalletAccount.findOne({ shopId: referrer._id }).lean()).balanceMinor, 12500);
  assert.equal((await WalletAccount.findOne({ shopId: referred._id }).lean()).balanceMinor, 7500);
  const entries = await WalletLedgerEntry.find({ referralId: referral._id }).lean();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.amountMinor).sort((a, b) => a - b), [7500, 12500]);
});

test("referral program settings are permission protected, reauthenticated, versioned and audited", async () => {
  const { AdminAudit, AdminUser } = await import("../models/index.js");
  const { hashPassword } = await import("../utils/security.js");
  const referralAdminSession = superSession;
  const [referralSupport] = await AdminUser.create([{
    email: `referral-support-${f.run}@example.test`, name: "Referral Support",
    role: "SUPPORT", passwordHash: await hashPassword(f.password), active: true,
  }]);
  const referralSupportSession = await signIn(referralSupport);
  const initial = await request("/referrals/settings", { session: referralAdminSession });
  assert.equal(initial.status, 200);
  assert.equal((await request("/referrals/settings", { session: referralSupportSession })).status, 403);
  const { digest } = await import("../utils/security.js");
  await AdminSession.updateOne(
    { tokenHash: digest(referralAdminSession.cookie.split("=")[1]) },
    { $set: { reauthenticatedAt: new Date(0) } },
  );
  const unauthorized = await request("/referrals/settings", {
    session: referralAdminSession,
    method: "PATCH",
    body: {
      expectedVersion: initial.value.data.revision,
      enabled: true,
      referrerRewardAmountMinor: 7000,
      referredRewardAmountMinor: 3000,
      minimumCustomers: 1,
    },
  });
  assert.equal(unauthorized.status, 403);
  assert.equal((await request("/auth/reauth", { session: referralAdminSession, method: "POST", body: { password: f.password } })).status, 200);
  const saved = await request("/referrals/settings", {
    session: referralAdminSession,
    method: "PATCH",
    body: {
      expectedVersion: initial.value.data.revision,
      enabled: true,
      referrerRewardAmountMinor: 7000,
      referredRewardAmountMinor: 3000,
      minimumCustomers: 3,
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.data.referrerRewardAmountMinor, 7000);
  assert.equal(saved.value.data.referredRewardAmountMinor, 3000);
  assert.equal(saved.value.data.minimumCustomers, 3);
  assert.ok(await AdminAudit.exists({ adminId: f.superAdmin._id, action: "referrals.settings.update", targetId: "default" }));
  const restored = await request("/referrals/settings", {
    session: referralAdminSession,
    method: "PATCH",
    body: {
      expectedVersion: saved.value.data.revision,
      enabled: initial.value.data.enabled,
      referrerRewardAmountMinor: initial.value.data.referrerRewardAmountMinor || 5000,
      referredRewardAmountMinor: initial.value.data.referredRewardAmountMinor || 5000,
      minimumCustomers: initial.value.data.minimumCustomers,
    },
  });
  assert.equal(restored.status, 200);
});
