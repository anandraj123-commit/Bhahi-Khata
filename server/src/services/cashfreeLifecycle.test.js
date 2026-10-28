import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import mongoose from "mongoose";

Object.assign(process.env, {
  NODE_ENV: "test",
  APP_MODE: "testing",
  MONGODB_URI: "mongodb://127.0.0.1:27028/?replicaSet=dkAdminTest",
  MONGODB_DB_NAME: "digital_khata_testing",
  JWT_SECRET: "cashfree-lifecycle-test-secret-long-enough",
  CASHFREE_ENVIRONMENT: "sandbox",
  CASHFREE_API_VERSION: "2026-01-01",
  CASHFREE_CHECKOUT_ENABLED: "true",
  CASHFREE_CLIENT_ID: "isolated-test-client-id",
  CASHFREE_CLIENT_SECRET: "isolated-test-client-secret",
  CASHFREE_WEBHOOK_SECRET: "isolated-test-webhook-secret",
  CASHFREE_WEBHOOK_URL: "https://example.test/api/v1/payments/webhook",
  SUBSCRIPTION_NATIVE_CHECKOUT_READY: "true",
  SUBSCRIPTION_TAX_BPS: "0",
  SUBSCRIPTION_TAX_INCLUSIVE: "false",
  PAYMENT_RECONCILIATION_MAX_ATTEMPTS: "8",
});

let service;
let models;
let plan;
async function cleanCashfreeTestFixtures() {
  const fixtureShops = await models.Shop.find({ name: { $in: ["Isolated payment test", "DK Cashfree lifecycle test"] } }).select("_id ownerId").lean();
  const shopIds = fixtureShops.map((item) => item._id);
  if (shopIds.length) {
    await Promise.all([
      models.PaymentOrder.deleteMany({ shopId: { $in: shopIds } }),
      models.PaymentTransaction.deleteMany({ shopId: { $in: shopIds } }),
      models.ShopSubscription.deleteMany({ shopId: { $in: shopIds } }),
      models.SubscriptionAuditLog.deleteMany({ shopId: { $in: shopIds } }),
      models.SubscriptionUsage.deleteMany({ shopId: { $in: shopIds } }),
      models.WalletAccount.deleteMany({ shopId: { $in: shopIds } }),
      models.WalletLedgerEntry.deleteMany({ shopId: { $in: shopIds } }),
      models.Shop.deleteMany({ _id: { $in: shopIds } }),
      models.User.deleteMany({ _id: { $in: fixtureShops.map((item) => item.ownerId) } }),
    ]);
  }
  await models.SubscriptionPlan.deleteMany({ code: /^cashfree-test-/ });
  await models.PaymentWebhookEvent.deleteMany({ eventId: /^(failure|success)-event-/ });
}
const payments = new Map();
const providerOrderAmounts = new Map();
const transientProviderFailures = new Set();
const originalFetch = globalThis.fetch;

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: "digital_khata_testing" });
  if (mongoose.connection.name !== "digital_khata_testing" || mongoose.connection.port !== 27028)
    throw new Error("Cashfree lifecycle tests require the isolated localhost:27028 testing database");
  models = await import("../models.js");
  await cleanCashfreeTestFixtures();
  for (const model of [
    models.User, models.Shop, models.SubscriptionPlan, models.ShopSubscription,
    models.PaymentOrder, models.PaymentTransaction, models.SubscriptionAuditLog,
    models.SubscriptionUsage,
    models.WalletAccount, models.WalletLedgerEntry,
  ]) {
    await model.createCollection().catch((error) => {
      if (error.codeName !== "NamespaceExists") throw error;
    });
    await model.createIndexes();
  }
  service = await import("./subscriptionService.js");
  const suffix = randomBytes(8).toString("hex");
  plan = await models.SubscriptionPlan.create({
    code: `cashfree-test-${suffix}`,
    name: "Cashfree isolated test",
    monthlyPriceMinor: 9000,
    currency: "INR",
    customerLimit: 80,
    unlimitedCustomers: false,
    enabled: true,
    durations: [{ months: 1, discountPercent: 0 }],
  });
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/pg/orders" && options.method === "POST") {
      const body = JSON.parse(options.body);
      providerOrderAmounts.set(body.order_id, Number(body.order_amount));
      return Response.json({
        order_id: body.order_id,
        cf_order_id: "isolated-cf-order",
        payment_session_id: "isolated-payment-session",
        order_amount: body.order_amount,
        order_currency: body.order_currency,
        order_status: "ACTIVE",
      });
    }
    const match = parsed.pathname.match(/^\/pg\/orders\/([^/]+)(?:\/payments(?:\/([^/]+))?)?$/);
    if (!match) return Response.json({ message: "unexpected test request" }, { status: 500 });
    const orderId = decodeURIComponent(match[1]);
    const paymentId = match[2] ? decodeURIComponent(match[2]) : null;
    if (transientProviderFailures.has(orderId)) {
      transientProviderFailures.delete(orderId);
      throw Object.assign(new Error("synthetic transient provider failure"), { code: "ECONNRESET" });
    }
    const state = payments.get(orderId) || { orderStatus: "ACTIVE", items: [] };
    if (paymentId) return Response.json(state.items.find((item) => String(item.cf_payment_id) === paymentId) || {}, { status: state.items.some((item) => String(item.cf_payment_id) === paymentId) ? 200 : 404 });
    if (parsed.pathname.endsWith("/payments")) return Response.json(state.items);
    return Response.json({
      order_id: orderId,
      order_amount: providerOrderAmounts.get(orderId) ?? 90,
      order_currency: "INR",
      order_status: state.orderStatus,
    });
  };
});

after(async () => {
  globalThis.fetch = originalFetch;
  await cleanCashfreeTestFixtures();
  await mongoose.disconnect();
});

async function createOrder(idempotencyKey, context) {
  let { user, shop } = context || {};
  if (!context) {
    ({ user, shop } = await createOrderContext());
  }
  const result = await service.createSubscriptionOrder({
    shopId: shop._id,
    userId: user._id,
    planCode: plan.code,
    months: 1,
    acceptedPricingVersion: plan.pricingVersion || 1,
    idempotencyKey,
  });
  return { ...result, user, shop };
}

async function createOrderContext() {
  const suffix = randomBytes(8).toString("hex");
  const phone = `+919${String(BigInt(`0x${suffix}`) % 1_000_000_000n).padStart(9, "0")}`;
  const user = await models.User.create({ phone });
  const shop = await models.Shop.create({ ownerId: user._id, name: "DK Cashfree lifecycle test", owner: "Synthetic", phone });
  await models.User.updateOne({ _id: user._id }, { $set: { shopId: shop._id } });
  return { user, shop };
}

function successfulPayment(orderId, id) {
  return {
    cf_payment_id: id,
    order_id: orderId,
    payment_status: "SUCCESS",
    payment_amount: 90,
    payment_currency: "INR",
    payment_group: "upi",
    payment_time: new Date().toISOString(),
  };
}

test("subscription expiry uses UTC calendar months and clamps month ends", () => {
  const clamp = (date, months) => service.addCalendarMonths(new Date(date), months).toISOString();
  assert.equal(clamp("2024-01-31T12:30:00.000Z", 1), "2024-02-29T12:30:00.000Z");
  assert.equal(clamp("2023-01-31T12:30:00.000Z", 1), "2023-02-28T12:30:00.000Z");
  assert.equal(clamp("2024-01-31T12:30:00.000Z", 3), "2024-04-30T12:30:00.000Z");
  assert.equal(clamp("2024-02-29T12:30:00.000Z", 12), "2025-02-28T12:30:00.000Z");
});

test("checkout is server-priced and idempotent, and verified payment activates exactly once", async () => {
  const key = `checkout-${randomBytes(8).toString("hex")}`;
  const first = await createOrder(key);
  const repeated = await createOrder(key, first);
  assert.equal(first.order.amountMinor, 9000);
  assert.equal(String(repeated.order._id), String(first.order._id));
  assert.equal(repeated.repeated, true);
  const gatewayOrderId = first.order.gatewayOrderId;
  payments.set(gatewayOrderId, { orderStatus: "PAID", items: [successfulPayment(gatewayOrderId, `success-${key}`)] });

  const verified = await service.verifyPayment({ shopId: first.shop._id, userId: first.user._id, orderId: first.order._id });
  const repeatedVerification = await service.verifyPayment({ shopId: first.shop._id, userId: first.user._id, orderId: first.order._id });
  assert.equal(verified.status, "paid");
  assert.equal(repeatedVerification.status, "paid");
  assert.equal(await models.PaymentTransaction.countDocuments({ orderId: first.order._id, status: "captured", verificationStatus: "verified" }), 1);
  assert.equal(await models.ShopSubscription.countDocuments({ sourcePaymentId: new mongoose.Types.ObjectId(verified.paymentId) }), 1);

  await assert.rejects(
    service.getPaymentOrderStatus({ shopId: new mongoose.Types.ObjectId(), orderId: first.order._id }),
    (error) => error.status === 404,
  );
});

test("stale pricing acceptance is rejected and Cashfree receives the exact versioned quote", async () => {
  const originalPlan = await models.SubscriptionPlan.findById(plan._id).lean();
  const key = `price-version-${randomBytes(8).toString("hex")}`;
  try {
    await models.SubscriptionPlan.updateOne(
      { _id: plan._id },
      { $set: { durations: [{ months: 1, basePriceMinor: 10000, discountPercent: 10, taxPercent: 5, isActive: true }] }, $inc: { pricingVersion: 1 } },
    );
    const context = await createOrderContext();
    await assert.rejects(
      service.createSubscriptionOrder({
        shopId: context.shop._id,
        userId: context.user._id,
        planCode: plan.code,
        months: 1,
        acceptedPricingVersion: originalPlan.pricingVersion || 1,
        idempotencyKey: `${key}-stale`,
      }),
      (error) => error.code === "SUBSCRIPTION_PRICE_CHANGED" && error.currentPricing.finalAmountMinor === 9450,
    );
    assert.equal(await models.PaymentOrder.countDocuments({ idempotencyKey: `${key}-stale` }), 0);
    const current = await models.SubscriptionPlan.findById(plan._id).lean();
    const accepted = await service.createSubscriptionOrder({
      shopId: context.shop._id,
      userId: context.user._id,
      planCode: plan.code,
      months: 1,
      acceptedPricingVersion: current.pricingVersion,
      idempotencyKey: `${key}-accepted`,
    });
    assert.equal(accepted.order.amountMinor, 9450);
    assert.equal(accepted.order.pricingSnapshot.discountAmountMinor, 1000);
    assert.equal(accepted.order.pricingSnapshot.taxAmountMinor, 450);
    assert.equal(accepted.order.pricingSnapshot.finalAmountMinor, 9450);
  } finally {
    await models.SubscriptionPlan.updateOne({ _id: plan._id }, { $set: {
      durations: originalPlan.durations,
      monthlyPriceMinor: originalPlan.monthlyPriceMinor,
      pricingVersion: originalPlan.pricingVersion || 1,
    } });
    plan = await models.SubscriptionPlan.findById(plan._id);
  }
});

test("pending and failed Cashfree results do not activate a subscription", async () => {
  const key = `pending-${randomBytes(8).toString("hex")}`;
  const { order, shop: testShop, user: testUser } = await createOrder(key);
  payments.set(order.gatewayOrderId, {
    orderStatus: "ACTIVE",
    items: [{ ...successfulPayment(order.gatewayOrderId, `pending-${key}`), payment_status: "PENDING" }],
  });
  const pending = await service.verifyPayment({ shopId: testShop._id, userId: testUser._id, orderId: order._id });
  assert.equal(pending.status, "pending");
  assert.equal(await models.ShopSubscription.countDocuments({ sourcePaymentId: { $exists: true }, shopId: testShop._id }), 0);

  payments.set(order.gatewayOrderId, {
    orderStatus: "ACTIVE",
    items: [{ ...successfulPayment(order.gatewayOrderId, `failed-${key}`), payment_status: "FAILED" }],
  });
  const failed = await service.verifyPayment({ shopId: testShop._id, userId: testUser._id, orderId: order._id });
  assert.equal(failed.status, "pending");
  assert.equal(await models.PaymentTransaction.countDocuments({ orderId: order._id, status: "captured" }), 0);
});

test("pending success webhooks and failed payment webhooks never activate subscriptions", async () => {
  const key = `webhook-non-success-${randomBytes(8).toString("hex")}`;
  const { order, shop: testShop } = await createOrder(key);
  const pending = {
    ...successfulPayment(order.gatewayOrderId, `pending-webhook-${key}`),
    payment_status: "PENDING",
  };
  payments.set(order.gatewayOrderId, { orderStatus: "ACTIVE", items: [pending] });
  await assert.rejects(
    service.processPaymentWebhook({
      eventId: `pending-success-event-${key}`,
      eventType: "PAYMENT_SUCCESS_WEBHOOK",
      orderId: order.gatewayOrderId,
      paymentId: pending.cf_payment_id,
    }),
    { status: 503 },
  );

  const failed = {
    ...successfulPayment(order.gatewayOrderId, `failed-webhook-${key}`),
    payment_status: "FAILED",
  };
  payments.set(order.gatewayOrderId, { orderStatus: "ACTIVE", items: [failed] });
  await service.processPaymentWebhook({
    eventId: `failed-event-${key}`,
    eventType: "PAYMENT_FAILED_WEBHOOK",
    orderId: order.gatewayOrderId,
    paymentId: failed.cf_payment_id,
  });

  assert.equal(await models.ShopSubscription.countDocuments({ shopId: testShop._id }), 0);
  assert.equal(await models.PaymentTransaction.countDocuments({ orderId: order._id, status: "captured" }), 0);
  assert.equal(await models.PaymentTransaction.countDocuments({ orderId: order._id, status: "failed", verificationStatus: "verified" }), 1);
});

test("signed-event service processing is idempotent across duplicate delivery and failure-before-success", async () => {
  const key = `webhook-${randomBytes(8).toString("hex")}`;
  const { order, shop: testShop } = await createOrder(key);
  const failed = {
    ...successfulPayment(order.gatewayOrderId, `failed-webhook-${key}`),
    payment_status: "FAILED",
  };
  const success = successfulPayment(order.gatewayOrderId, `success-webhook-${key}`);
  payments.set(order.gatewayOrderId, { orderStatus: "PAID", items: [failed, success] });
  const failureEvent = { eventId: `failure-event-${key}`, eventType: "PAYMENT_FAILED_WEBHOOK", orderId: order.gatewayOrderId, paymentId: failed.cf_payment_id };
  await service.processPaymentWebhook(failureEvent);
  const successEvent = { eventId: `success-event-${key}`, eventType: "PAYMENT_SUCCESS_WEBHOOK", orderId: order.gatewayOrderId, paymentId: success.cf_payment_id };
  const duplicateResults = await Promise.all([
    service.processPaymentWebhook(successEvent),
    service.processPaymentWebhook(successEvent),
  ]);
  assert.ok(duplicateResults.every((result) => result.payment || result.duplicate));
  assert.equal(await models.ShopSubscription.countDocuments({ sourcePaymentId: { $exists: true }, shopId: testShop._id }), 1);
  assert.equal(await models.PaymentTransaction.countDocuments({ orderId: order._id, gatewayPaymentId: success.cf_payment_id, status: "captured" }), 1);
});

test("a second distinct successful payment for one order is captured for review without another activation", async () => {
  const key = `extra-capture-${randomBytes(8).toString("hex")}`;
  const { order, shop: testShop } = await createOrder(key);
  const first = successfulPayment(order.gatewayOrderId, `first-${key}`);
  const second = successfulPayment(order.gatewayOrderId, `second-${key}`);
  payments.set(order.gatewayOrderId, { orderStatus: "PAID", items: [first, second] });

  await service.processPaymentWebhook({ eventId: `success-event-${key}-1`, eventType: "PAYMENT_SUCCESS_WEBHOOK", orderId: order.gatewayOrderId, paymentId: first.cf_payment_id });
  const original = await models.PaymentTransaction.findOne({ orderId: order._id, gatewayPaymentId: first.cf_payment_id }).lean();
  const originalSubscription = await models.ShopSubscription.findOne({ sourcePaymentId: original._id }).lean();
  await service.processPaymentWebhook({ eventId: `success-event-${key}-2`, eventType: "PAYMENT_SUCCESS_WEBHOOK", orderId: order.gatewayOrderId, paymentId: second.cf_payment_id });
  await service.processPaymentWebhook({ eventId: `success-event-${key}-2-retry`, eventType: "PAYMENT_SUCCESS_WEBHOOK", orderId: order.gatewayOrderId, paymentId: second.cf_payment_id });

  const extra = await models.PaymentTransaction.findOne({ orderId: order._id, gatewayPaymentId: second.cf_payment_id }).lean();
  const subscriptions = await models.ShopSubscription.find({ sourcePaymentOrderId: order._id }).lean();
  assert.equal(subscriptions.length, 1);
  assert.equal(String(subscriptions[0]._id), String(originalSubscription._id));
  assert.equal(String(subscriptions[0].sourcePaymentId), String(original._id));
  assert.equal(extra.status, "captured");
  assert.equal(extra.verificationStatus, "verified");
  assert.equal(extra.reviewStatus, "duplicate_order_capture");
  assert.equal(extra.reviewReason, "additional_successful_payment_for_paid_order");
  assert.equal(await models.SubscriptionAuditLog.countDocuments({ referenceId: `payment-review:${second.cf_payment_id}` }), 1);
  assert.equal(await models.ShopSubscription.countDocuments({ shopId: testShop._id }), 1);
});

test("concurrent distinct success webhooks for one order create one subscription and retain the extra capture for review", async () => {
  const key = `concurrent-extra-${randomBytes(8).toString("hex")}`;
  const { order, shop: testShop } = await createOrder(key);
  const first = successfulPayment(order.gatewayOrderId, `concurrent-first-${key}`);
  const second = successfulPayment(order.gatewayOrderId, `concurrent-second-${key}`);
  payments.set(order.gatewayOrderId, { orderStatus: "PAID", items: [first, second] });
  const results = await Promise.all([
    service.processPaymentWebhook({ eventId: `success-event-${key}-1`, eventType: "PAYMENT_SUCCESS_WEBHOOK", orderId: order.gatewayOrderId, paymentId: first.cf_payment_id }),
    service.processPaymentWebhook({ eventId: `success-event-${key}-2`, eventType: "PAYMENT_SUCCESS_WEBHOOK", orderId: order.gatewayOrderId, paymentId: second.cf_payment_id }),
  ]);
  assert.equal(results.length, 2);
  assert.equal(await models.ShopSubscription.countDocuments({ sourcePaymentOrderId: order._id }), 1);
  assert.equal(await models.PaymentTransaction.countDocuments({ orderId: order._id, status: "captured", verificationStatus: "verified" }), 2);
  assert.equal(await models.PaymentTransaction.countDocuments({ orderId: order._id, reviewStatus: "duplicate_order_capture" }), 1);
  assert.equal(await models.ShopSubscription.countDocuments({ shopId: testShop._id }), 1);
});

test("separate successful payment orders remain valid purchases and renewals", async () => {
  const key = `separate-orders-${randomBytes(8).toString("hex")}`;
  const context = await createOrderContext();
  const first = await createOrder(`${key}-1`, context);
  payments.set(first.order.gatewayOrderId, { orderStatus: "PAID", items: [successfulPayment(first.order.gatewayOrderId, `separate-first-${key}`)] });
  await service.verifyPayment({ shopId: context.shop._id, userId: context.user._id, orderId: first.order._id });
  const firstSubscription = await models.ShopSubscription.findOne({ sourcePaymentOrderId: first.order._id }).lean();

  const second = await createOrder(`${key}-2`, context);
  payments.set(second.order.gatewayOrderId, { orderStatus: "PAID", items: [successfulPayment(second.order.gatewayOrderId, `separate-second-${key}`)] });
  await service.verifyPayment({ shopId: context.shop._id, userId: context.user._id, orderId: second.order._id });
  const secondSubscription = await models.ShopSubscription.findOne({ sourcePaymentOrderId: second.order._id }).lean();
  assert.ok(secondSubscription);
  assert.equal(await models.ShopSubscription.countDocuments({ shopId: context.shop._id }), 2);
  assert.equal(secondSubscription.startsAt.getTime(), firstSubscription.expiresAt.getTime());
  assert.ok(secondSubscription.expiresAt > firstSubscription.expiresAt);
});

test("bounded reconciliation recovers a paid order after a transient verification failure", async () => {
  const key = `recovery-${randomBytes(8).toString("hex")}`;
  const { order, shop: testShop } = await createOrder(key);
  payments.set(order.gatewayOrderId, {
    orderStatus: "PAID",
    items: [successfulPayment(order.gatewayOrderId, `recovery-payment-${key}`)],
  });
  transientProviderFailures.add(order.gatewayOrderId);

  const now = new Date();
  const failedAttempt = await service.reconcilePendingCashfreePayments({ limit: 20, now });
  assert.ok(failedAttempt.attempted >= 1);
  assert.ok(failedAttempt.failed >= 1);
  assert.equal(await models.ShopSubscription.countDocuments({ shopId: testShop._id }), 0);
  const scheduled = await models.PaymentOrder.findById(order._id).lean();
  assert.equal(scheduled.paymentReconciliationAttempts, 1);
  assert.equal(scheduled.paymentReconciliationLastCode, "PAYMENT_PROVIDER_UNAVAILABLE");
  assert.ok(scheduled.paymentReconciliationNextAt > now);

  const tooEarly = await service.reconcilePendingCashfreePayments({ limit: 20, now });
  assert.equal(tooEarly.attempted, 0);

  const recovered = await service.reconcilePendingCashfreePayments({
    limit: 20,
    now: new Date(now.getTime() + 2 * 60_000),
  });
  assert.ok(recovered.attempted >= 1);
  assert.ok(recovered.paid >= 1);
  assert.equal(await models.ShopSubscription.countDocuments({ shopId: testShop._id }), 1);
  assert.equal(await models.PaymentTransaction.countDocuments({ orderId: order._id, status: "captured", verificationStatus: "verified" }), 1);
});

test("reconciliation enforces maximum attempts and payment age while manual verification remains available", async () => {
  const key = `bounded-limits-${randomBytes(8).toString("hex")}`;
  const now = new Date();
  const exhausted = await createOrder(`${key}-attempts`);
  const overExhausted = await createOrder(`${key}-over-attempts`);
  const tooOld = await createOrder(`${key}-age`);
  const eligible = await createOrder(`${key}-eligible`);
  await models.PaymentOrder.updateOne({ _id: exhausted.order._id }, { $set: { paymentReconciliationAttempts: 8, paymentReconciliationNextAt: new Date(now.getTime() - 1000) } });
  await models.PaymentOrder.updateOne({ _id: overExhausted.order._id }, { $set: { paymentReconciliationAttempts: 9, paymentReconciliationNextAt: new Date(now.getTime() - 1000) } });
  await models.PaymentOrder.collection.updateOne(
    { _id: tooOld.order._id },
    { $set: { createdAt: new Date(now.getTime() - 10 * 86400000), paymentReconciliationAttempts: 3, paymentReconciliationNextAt: new Date(now.getTime() - 1000) } },
  );
  await models.PaymentOrder.updateOne({ _id: eligible.order._id }, { $set: { paymentReconciliationAttempts: 3, paymentReconciliationNextAt: new Date(now.getTime() - 1000) } });
  payments.set(eligible.order.gatewayOrderId, { orderStatus: "ACTIVE", items: [] });

  await service.reconcilePendingCashfreePayments({ limit: 50, now });
  assert.equal((await models.PaymentOrder.findById(exhausted.order._id).lean()).paymentReconciliationAttempts, 8);
  assert.equal((await models.PaymentOrder.findById(overExhausted.order._id).lean()).paymentReconciliationAttempts, 9);
  assert.equal((await models.PaymentOrder.findById(tooOld.order._id).lean()).paymentReconciliationAttempts, 3);
  assert.equal((await models.PaymentOrder.findById(eligible.order._id).lean()).paymentReconciliationAttempts, 4);

  payments.set(exhausted.order.gatewayOrderId, { orderStatus: "PAID", items: [successfulPayment(exhausted.order.gatewayOrderId, `manual-recovery-${key}`)] });
  const recovered = await service.verifyPayment({ shopId: exhausted.shop._id, userId: exhausted.user._id, orderId: exhausted.order._id });
  assert.equal(recovered.status, "paid");
  assert.equal(await models.ShopSubscription.countDocuments({ sourcePaymentOrderId: exhausted.order._id }), 1);
});

test("mobile verification, webhook, and reconciliation races activate one subscription", async () => {
  const key = `concurrent-${randomBytes(8).toString("hex")}`;
  const { order, shop: testShop, user: testUser } = await createOrder(key);
  const paid = successfulPayment(order.gatewayOrderId, `concurrent-payment-${key}`);
  payments.set(order.gatewayOrderId, { orderStatus: "PAID", items: [paid] });
  const event = {
    eventId: `success-event-${key}`,
    eventType: "PAYMENT_SUCCESS_WEBHOOK",
    orderId: order.gatewayOrderId,
    paymentId: paid.cf_payment_id,
  };

  await Promise.all([
    service.verifyPayment({ shopId: testShop._id, userId: testUser._id, orderId: order._id }),
    service.processPaymentWebhook(event),
    service.reconcilePendingCashfreePayments({ limit: 50 }),
  ]);

  const verifiedOrder = await models.PaymentOrder.findById(order._id).lean();
  assert.equal(verifiedOrder.status, "paid");
  assert.equal(await models.ShopSubscription.countDocuments({ shopId: testShop._id }), 1);
  assert.equal(await models.PaymentTransaction.countDocuments({ orderId: order._id, status: "captured", verificationStatus: "verified" }), 1);
});

test("canonical plan migration fills only absent pricing fields and is idempotent", async () => {
  await service.ensureSubscriptionPlans();
  const canonicalCodes = ["free", "pro", "business"];
  assert.equal(await models.SubscriptionPlan.countDocuments({ code: { $in: canonicalCodes } }), 3);
  const original = await models.SubscriptionPlan.findOne({ code: "pro" }).lean();
  const originalDurations = original.durations;
  const originalConfigVersion = original.configurationVersion;
  const originalPricingVersion = original.pricingVersion;
  const legacyTax = (await import("../config/env.js")).subscriptionConfig.taxBps / 100;
  await models.SubscriptionPlan.updateOne(
    { _id: original._id },
    {
      $set: {
        durations: [{ months: 1, discountPercent: 12.5, taxPercent: 0, isActive: false }],
      },
      $inc: { configurationVersion: 1 },
    },
  );
  try {
    await service.ensureSubscriptionPlans();
    const migrated = await models.SubscriptionPlan.findById(original._id).lean();
    assert.equal(migrated.durations.length, 4);
    assert.deepEqual(migrated.durations[0], {
      months: 1,
      basePriceMinor: original.monthlyPriceMinor,
      discountPercent: 12.5,
      taxPercent: 0,
      isActive: false,
    });
    assert.equal(migrated.durations[1].taxPercent, legacyTax);
    assert.equal(migrated.durations[1].discountPercent, 0);
    assert.equal(migrated.durations[1].basePriceMinor, original.monthlyPriceMinor * 3);
    const version = migrated.configurationVersion;
    await service.ensureSubscriptionPlans();
    const repeated = await models.SubscriptionPlan.findById(original._id).lean();
    assert.equal(repeated.configurationVersion, version);
    assert.equal(repeated.pricingVersion, originalPricingVersion || 1);
  } finally {
    await models.SubscriptionPlan.updateOne(
      { _id: original._id },
      { $set: {
        durations: originalDurations,
        configurationVersion: originalConfigVersion,
        pricingVersion: originalPricingVersion || 1,
      } },
    );
  }
});

test("wallet-assisted checkout reserves partial funds, captures them only after Cashfree verification, and is idempotent", async () => {
  const { user, shop } = await createOrderContext();
  await models.WalletAccount.create({ shopId: shop._id, balanceMinor: 4500, reservedMinor: 0 });
  const key = `wallet-partial-${randomBytes(8).toString("hex")}`;
  const input = {
    shopId: shop._id, userId: user._id, planCode: plan.code, months: 1,
    acceptedPricingVersion: plan.pricingVersion || 1, idempotencyKey: key, useWallet: true,
  };
  const created = await service.createSubscriptionOrder(input);
  const repeated = await service.createSubscriptionOrder(input);
  assert.equal(created.order.amountMinor, 4500);
  assert.equal(created.order.totalAmountMinor, 9000);
  assert.equal(created.order.walletAppliedMinor, 4500);
  assert.equal(repeated.repeated, true);
  assert.equal((await models.WalletAccount.findOne({ shopId: shop._id }).lean()).reservedMinor, 4500);
  const gatewayOrderId = created.order.gatewayOrderId;
  payments.set(gatewayOrderId, { orderStatus: "PAID", items: [{
    cf_payment_id: `wallet-cash-${key}`, order_id: gatewayOrderId, payment_status: "SUCCESS",
    payment_amount: 45, payment_currency: "INR", payment_group: "upi", payment_time: new Date().toISOString(),
  }] });
  await service.verifyPayment({ shopId: shop._id, userId: user._id, orderId: created.order._id });
  await service.verifyPayment({ shopId: shop._id, userId: user._id, orderId: created.order._id });
  const account = await models.WalletAccount.findOne({ shopId: shop._id }).lean();
  assert.equal(account.balanceMinor, 0);
  assert.equal(account.reservedMinor, 0);
  assert.equal(await models.WalletLedgerEntry.countDocuments({ shopId: shop._id, reason: "subscription_purchase" }), 1);
  const subscription = await models.ShopSubscription.findOne({ shopId: shop._id }).lean();
  assert.equal(subscription.amountPaidMinor, 9000);
  assert.equal(await models.PaymentTransaction.countDocuments({ orderId: created.order._id, amountMinor: 4500, status: "captured" }), 1);
});

test("full wallet purchases activate once without Cashfree and expired partial orders release their reservation", async () => {
  const { user: fullUser, shop: fullShop } = await createOrderContext();
  await models.WalletAccount.create({ shopId: fullShop._id, balanceMinor: 9000, reservedMinor: 0 });
  const full = await service.createSubscriptionOrder({
    shopId: fullShop._id, userId: fullUser._id, planCode: plan.code, months: 1,
    acceptedPricingVersion: plan.pricingVersion || 1, idempotencyKey: `wallet-full-${randomBytes(8).toString("hex")}`, useWallet: true,
  });
  assert.equal(full.order.status, "paid");
  assert.equal(full.order.amountMinor, 0);
  assert.equal(full.order.walletAppliedMinor, 9000);
  assert.equal(await models.ShopSubscription.countDocuments({ shopId: fullShop._id }), 1);
  assert.equal(await models.PaymentTransaction.countDocuments({ shopId: fullShop._id }), 0);
  assert.equal((await models.WalletAccount.findOne({ shopId: fullShop._id }).lean()).balanceMinor, 0);

  const { user, shop } = await createOrderContext();
  await models.WalletAccount.create({ shopId: shop._id, balanceMinor: 2000, reservedMinor: 0 });
  const partial = await service.createSubscriptionOrder({
    shopId: shop._id, userId: user._id, planCode: plan.code, months: 1,
    acceptedPricingVersion: plan.pricingVersion || 1, idempotencyKey: `wallet-expire-${randomBytes(8).toString("hex")}`, useWallet: true,
  });
  payments.set(partial.order.gatewayOrderId, { orderStatus: "EXPIRED", items: [] });
  const status = await service.getPaymentOrderStatus({ shopId: shop._id, orderId: partial.order._id });
  assert.equal(status.status, "failed");
  const afterExpiry = await models.WalletAccount.findOne({ shopId: shop._id }).lean();
  assert.equal(afterExpiry.balanceMinor, 2000);
  assert.equal(afterExpiry.reservedMinor, 0);
});
