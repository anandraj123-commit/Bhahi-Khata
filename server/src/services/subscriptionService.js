import mongoose from "mongoose";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  Customer,
  PaymentOrder,
  PaymentTransaction,
  ShopSubscription,
  SubscriptionAuditLog,
  SubscriptionPlan,
  SubscriptionUsage,
} from "../models.js";
import { subscriptionConfig } from "../config/env.js";
import { paymentProvider } from "../providers/paymentProvider.js";
import { digest } from "../utils/hashing.js";
import { sendSubscriptionPush } from "./subscriptionNotificationService.js";

const durations = [1, 3, 6, 12];
const seededPlans = [
  {
    code: "free",
    name: "Free",
    description: "Essential customer and ledger management",
    monthlyPriceMinor: 0,
    currency: "INR",
    customerLimit: 50,
    unlimitedCustomers: false,
    entitlements: {},
    enabled: true,
    displayOrder: 0,
    durations: [],
  },
  {
    code: "pro",
    name: "Pro",
    description: "For growing shops",
    monthlyPriceMinor: 19900,
    currency: "INR",
    customerLimit: 500,
    unlimitedCustomers: false,
    entitlements: {},
    enabled: true,
    displayOrder: 1,
    durations: durations.map((months) => ({
      months,
      discountPercent: ({ 1: 0, 3: 5, 6: 10, 12: 20 })[months],
    })),
  },
  {
    code: "business",
    name: "Business",
    description: "Unlimited customer management",
    monthlyPriceMinor: 49900,
    currency: "INR",
    customerLimit: null,
    unlimitedCustomers: true,
    entitlements: {},
    enabled: true,
    displayOrder: 2,
    durations: durations.map((months) => ({
      months,
      discountPercent: ({ 1: 0, 3: 5, 6: 10, 12: 20 })[months],
    })),
  },
];

const serviceError = (message, status, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });

export async function ensureSubscriptionPlans() {
  for (const plan of seededPlans)
    await SubscriptionPlan.updateOne(
      { code: plan.code },
      { $setOnInsert: plan },
      { upsert: true },
    );
}

function roundRatio(numerator, denominator) {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

export function quoteSubscription(plan, months) {
  if (!plan || !plan.enabled) throw serviceError("Plan is unavailable", 404);
  if (plan.code === "free")
    return {
      durationMonths: 0,
      currency: plan.currency,
      originalAmountMinor: 0,
      discountPercent: 0,
      discountAmountMinor: 0,
      taxRateBps: 0,
      taxInclusive: subscriptionConfig.taxInclusive,
      taxAmountMinor: 0,
      finalAmountMinor: 0,
    };
  const duration = plan.durations.find((item) => item.months === months);
  if (!duration) throw serviceError("Subscription duration is unavailable", 400);
  const originalAmountMinor = plan.monthlyPriceMinor * months;
  const discountAmountMinor = roundRatio(
    originalAmountMinor * duration.discountPercent,
    100,
  );
  const discountedAmountMinor = originalAmountMinor - discountAmountMinor;
  const taxAmountMinor = subscriptionConfig.taxInclusive
    ? roundRatio(
        discountedAmountMinor * subscriptionConfig.taxBps,
        10000 + subscriptionConfig.taxBps,
      )
    : roundRatio(discountedAmountMinor * subscriptionConfig.taxBps, 10000);
  return {
    durationMonths: months,
    currency: plan.currency,
    originalAmountMinor,
    discountPercent: duration.discountPercent,
    discountAmountMinor,
    discountedAmountMinor,
    taxRateBps: subscriptionConfig.taxBps,
    taxInclusive: subscriptionConfig.taxInclusive,
    taxAmountMinor,
    finalAmountMinor: subscriptionConfig.taxInclusive
      ? discountedAmountMinor
      : discountedAmountMinor + taxAmountMinor,
  };
}

function planOut(plan) {
  const value = {
    id: String(plan._id),
    code: plan.code,
    name: plan.name,
    description: plan.description,
    monthlyPriceMinor: plan.monthlyPriceMinor,
    currency: plan.currency,
    customerLimit: plan.customerLimit,
    unlimitedCustomers: plan.unlimitedCustomers,
    entitlements: plan.entitlements || {},
    enabled: plan.enabled,
    displayOrder: plan.displayOrder,
    configurationVersion: plan.configurationVersion,
    durations: plan.durations.map((duration) => ({
      ...quoteSubscription(plan, duration.months),
      months: duration.months,
    })),
  };
  if (plan.code === "free") value.durations = [];
  return value;
}

export async function listSubscriptionPlans() {
  const plans = await SubscriptionPlan.find({ enabled: true })
    .sort({ displayOrder: 1, _id: 1 })
    .lean();
  return {
    items: plans.map(planOut),
    checkoutEnabled: subscriptionConfig.checkoutEnabled,
    provider: "razorpay",
    lastUpdatedAt: plans.reduce(
      (latest, plan) => Math.max(latest, new Date(plan.updatedAt || 0).getTime()),
      0,
    ) || null,
  };
}

async function currentRows(shopId, now = new Date(), session) {
  const query = ShopSubscription.find({
    shopId,
    status: { $in: ["active", "scheduled"] },
    $or: [
      {
        startsAt: { $lte: now },
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $gt: now } },
        ],
      },
      { status: "scheduled", startsAt: { $gt: now } },
    ],
  }).sort({ startsAt: 1, createdAt: -1 });
  if (session) query.session(session);
  const rows = await query.lean();
  const active = rows
    .filter((row) => ["active", "scheduled"].includes(row.status) && row.startsAt <= now && (!row.expiresAt || row.expiresAt > now))
    .sort((a, b) => b.startsAt - a.startsAt)[0] || null;
  const scheduled = rows
    .filter((row) => row.status === "scheduled" && row.startsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt)[0] || null;
  return { active, scheduled };
}

async function freePlan(session) {
  const query = SubscriptionPlan.findOne({ code: "free" });
  if (session) query.session(session);
  return query.lean();
}

export async function getCurrentSubscription(shopId, now = new Date()) {
  const [{ active, scheduled }, fallback, customers] = await Promise.all([
    currentRows(shopId, now),
    freePlan(),
    Customer.countDocuments({ shopId, deletedAt: { $exists: false }, status: { $ne: false }, disabled: { $ne: true }, removed: { $ne: true } }),
  ]);
  const effective = active || {
    _id: null,
    shopId,
    planCode: "free",
    planSnapshot: fallback,
    status: "active",
    startsAt: null,
    expiresAt: null,
    durationMonths: 0,
    isFallback: true,
  };
  const plan = effective.planSnapshot || fallback;
  const remainingMs = effective.expiresAt
    ? Math.max(0, effective.expiresAt.getTime() - now.getTime())
    : null;
  const scheduledPlan = scheduled?.planSnapshot || null;
  const verifiedAt = now.toISOString();
  const subscription = {
    shopId: String(shopId),
    id: effective._id ? String(effective._id) : null,
    plan: plan && {
      code: effective.planCode || plan.code,
      name: plan.name,
      customerLimit: plan.customerLimit,
      unlimitedCustomers: plan.unlimitedCustomers,
      entitlements: plan.entitlements || {},
    },
    status: "active",
    startsAt: effective.startsAt?.toISOString?.() || null,
    expiresAt: effective.expiresAt?.toISOString?.() || null,
    durationMonths: effective.durationMonths || 0,
    amountPaidMinor: effective.amountPaidMinor ?? null,
    remainingMilliseconds: remainingMs,
    remainingDays: remainingMs === null ? null : Math.ceil(remainingMs / 86400000),
    remainingHours: remainingMs === null ? null : Math.ceil(remainingMs / 3600000),
    isFallback: Boolean(effective.isFallback),
    scheduled: scheduled
      ? {
          id: String(scheduled._id),
          plan: scheduledPlan && {
            code: scheduled.planCode,
            name: scheduledPlan.name,
            customerLimit: scheduledPlan.customerLimit,
            unlimitedCustomers: scheduledPlan.unlimitedCustomers,
            entitlements: scheduledPlan.entitlements || {},
          },
          startsAt: scheduled.startsAt.toISOString(),
          expiresAt: scheduled.expiresAt?.toISOString?.() || null,
          durationMonths: scheduled.durationMonths,
        }
      : null,
    customerUsage: {
      used: customers,
      limit: plan?.customerLimit ?? null,
      unlimited: Boolean(plan?.unlimitedCustomers),
      remaining: plan?.unlimitedCustomers || plan?.customerLimit == null
        ? null
        : Math.max(0, plan.customerLimit - customers),
    },
    verifiedAt,
    lastSyncedAt: verifiedAt,
  };
  return subscription;
}

async function notifyPaymentSuccess(shopId, paymentId) {
  try {
    const payment = await PaymentTransaction.findOne({ shopId, gatewayPaymentId: paymentId }).lean();
    if (!payment) return;
    const subscription = await ShopSubscription.findOne({ shopId, sourcePaymentId: payment._id }).lean();
    if (!subscription) return;
    const planName = subscription.planSnapshot?.name || subscription.planCode;
    const body = subscription.status === "scheduled"
      ? `Payment confirmed. Your ${planName} plan starts ${subscription.startsAt.toLocaleDateString("en-IN")}.`
      : `Your ${planName} subscription is active.`;
    await sendSubscriptionPush({
      shopId,
      subscriptionId: subscription._id,
      notificationType: "payment_success",
      deduplicationKey: `payment:${paymentId}:success`,
      title: "Digital-Khata payment confirmed",
      body,
    });
  } catch { /* Notification delivery never changes payment success. */ }
}

async function notifyPaymentFailure(shopId, paymentId) {
  try {
    await sendSubscriptionPush({
      shopId,
      notificationType: "payment_failure",
      deduplicationKey: `payment:${paymentId}:failure`,
      title: "Digital-Khata payment update",
      body: "Your subscription payment was not completed. You can retry when online.",
    });
  } catch { /* Notification delivery never changes payment state. */ }
}

export async function getSubscriptionHistory({ shopId, limit = 30, cursor }) {
  const filter = { shopId };
  if (cursor && !mongoose.isValidObjectId(cursor)) throw serviceError("Invalid subscription history cursor", 400);
  if (cursor) filter._id = { $lt: cursor };
  const rows = await ShopSubscription.find(filter)
    .sort({ _id: -1 })
    .limit(Math.min(100, Math.max(1, limit)) + 1)
    .lean();
  const more = rows.length > limit;
  if (more) rows.pop();
  return {
    items: rows.map((row) => {
      const now = Date.now();
      const startsAtMs = row.startsAt?.getTime?.() ?? null;
      const expiresAtMs = row.expiresAt?.getTime?.() ?? null;
      const status = startsAtMs !== null && startsAtMs > now
        ? row.status
        : expiresAtMs !== null && expiresAtMs <= now && ["active", "scheduled"].includes(row.status)
          ? "expired"
          : row.status === "scheduled" ? "active" : row.status;
      const remainingMilliseconds = status === "active" && expiresAtMs !== null
        ? Math.max(0, expiresAtMs - now)
        : null;
      const startsInMilliseconds = status === "scheduled" && startsAtMs !== null
        ? Math.max(0, startsAtMs - now)
        : null;
      return {
        id: String(row._id),
        plan: row.planSnapshot,
        status,
        startsAt: row.startsAt?.toISOString?.() || null,
        expiresAt: row.expiresAt?.toISOString?.() || null,
        durationMonths: row.durationMonths,
        amountPaidMinor: row.amountPaidMinor ?? null,
        sourcePaymentId: row.sourcePaymentId ? String(row.sourcePaymentId) : null,
        remainingMilliseconds,
        remainingDays: remainingMilliseconds === null ? null : Math.ceil(remainingMilliseconds / 86400000),
        startsInMilliseconds,
        startsInDays: startsInMilliseconds === null ? null : Math.ceil(startsInMilliseconds / 86400000),
        createdAt: row.createdAt.toISOString(),
      };
    }),
    nextCursor: more ? String(rows.at(-1)._id) : null,
  };
}

export async function getSubscriptionUsage(shopId) {
  const current = await getCurrentSubscription(shopId);
  return current.customerUsage;
}

export async function listPaymentHistory({ shopId, limit = 30, cursor }) {
  const filter = { shopId };
  if (cursor && !mongoose.isValidObjectId(cursor)) throw serviceError("Invalid payment history cursor", 400);
  if (cursor) filter._id = { $lt: cursor };
  const rows = await PaymentOrder.find(filter)
    .sort({ _id: -1 })
    .limit(Math.min(100, Math.max(1, limit)) + 1)
    .lean();
  const more = rows.length > limit;
  if (more) rows.pop();
  const ids = rows.map((row) => row._id);
  const transactions = await PaymentTransaction.find({ shopId, orderId: { $in: ids } })
    .sort({ verifiedAt: -1, _id: -1 })
    .lean();
  const paymentPriority = (status) =>
    ["refunded", "partially_refunded"].includes(status) ? 3 : status === "captured" ? 2 : status === "failed" ? 1 : 0;
  const byOrder = new Map();
  for (const payment of transactions) {
    const key = String(payment.orderId);
    const current = byOrder.get(key);
    if (!current || paymentPriority(payment.status) > paymentPriority(current.status))
      byOrder.set(key, payment);
  }
  return {
    items: rows.map((row) => {
      const payment = byOrder.get(String(row._id));
      return {
        id: String(row._id),
        planCode: row.planCode,
        durationMonths: row.durationMonths,
        pricing: row.pricingSnapshot,
        amountMinor: row.amountMinor,
        currency: row.currency,
        status: payment?.status || (row.status === "created" ? "pending" : row.status),
        gatewayOrderId: row.gatewayOrderId || null,
        gatewayPaymentId: payment?.gatewayPaymentId || null,
        method: payment?.method || null,
        refundedAmountMinor: payment?.refundedAmountMinor ?? (payment?.status === "refunded" ? payment.amountMinor : 0),
        createdAt: row.createdAt.toISOString(),
        refunded: payment?.status === "refunded" || payment?.status === "partially_refunded",
      };
    }),
    nextCursor: more ? String(rows.at(-1)._id) : null,
  };
}

export async function reserveCustomerCapacity({ shopId, session }) {
  const now = new Date();
  const { active } = await currentRows(shopId, now, session);
  const plan = active?.planSnapshot || (await freePlan(session));
  if (plan?.unlimitedCustomers || plan?.customerLimit == null) {
    await SubscriptionUsage.updateOne(
      { shopId },
      { $inc: { activeCustomers: 1 }, $setOnInsert: { shopId } },
      { upsert: true, session },
    );
    return;
  }
  const usage = await SubscriptionUsage.findOne({ shopId }).session(session);
  if (!usage) throw new Error("Customer capacity was not initialized");
  const updated = await SubscriptionUsage.findOneAndUpdate(
    { shopId, activeCustomers: { $lt: plan.customerLimit } },
    { $inc: { activeCustomers: 1 } },
    { new: true, session },
  );
  if (!updated)
    throw serviceError("Customer limit reached. Upgrade your plan to add customers.", 409, {
      code: "CUSTOMER_LIMIT_REACHED",
      limit: plan.customerLimit,
    });
}

export async function ensureCustomerUsage(shopId) {
  const existing = await SubscriptionUsage.findOne({ shopId }).lean();
  if (existing) return existing;
  const activeCustomers = await Customer.countDocuments({ shopId, deletedAt: { $exists: false }, status: { $ne: false }, disabled: { $ne: true }, removed: { $ne: true } });
  try {
    const [created] = await SubscriptionUsage.create([{ shopId, activeCustomers }]);
    return created.toObject();
  } catch (error) {
    if (error.code !== 11000) throw error;
    return SubscriptionUsage.findOne({ shopId }).lean();
  }
}

export async function releaseCustomerCapacity({ shopId, session }) {
  await SubscriptionUsage.updateOne(
    { shopId, activeCustomers: { $gt: 0 } },
    { $inc: { activeCustomers: -1 } },
    { session },
  );
}

function addCalendarMonths(date, months) {
  // Clamp to the final day of the target month (Jan 31 + 1 month = Feb 28/29).
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

async function getScheduleForPurchase(shopId, plan, session, now) {
  const { active, scheduled } = await currentRows(shopId, now, session);
  if (scheduled) {
    if (scheduled.planCode === plan.code && scheduled.expiresAt)
      return { startsAt: scheduled.expiresAt, status: "scheduled", renewalOf: scheduled._id, previousPlan: active?.planSnapshot || scheduled.planSnapshot };
    throw serviceError("A future subscription is already scheduled", 409);
  }
  if (!active) return { startsAt: now, status: "active", renewalOf: null, previousPlan: null };
  if (active.planCode === plan.code)
    return { startsAt: active.expiresAt > now ? active.expiresAt : now, status: "scheduled", renewalOf: active._id, previousPlan: active.planSnapshot };
  if (active.planCode === "pro" && plan.code === "business")
    throw serviceError("Immediate upgrades are unavailable until upgrade-credit pricing is configured", 409);
  if (active.planCode === "business" && plan.code === "pro")
    return { startsAt: active.expiresAt, status: "scheduled", renewalOf: active._id, previousPlan: active.planSnapshot };
  throw serviceError("This plan change is not available", 409);
}

export async function createSubscriptionOrder({ shopId, userId, planCode, months, idempotencyKey }) {
  if (!idempotencyKey || idempotencyKey.length > 128)
    throw serviceError("A valid Idempotency-Key is required", 400);
  const hash = digest(JSON.stringify({ planCode, months }));
  const now = new Date();
  await PaymentOrder.updateMany(
    {
      shopId,
      status: { $in: ["created", "pending"] },
      checkoutActive: true,
      checkoutExpiresAt: { $lte: now },
    },
    { $set: { checkoutActive: false, status: "failed" } },
  );
  const old = await PaymentOrder.findOne({ shopId, idempotencyKey }).lean();
  if (old) {
    if (old.requestHash !== hash) throw serviceError("Idempotency key was used for a different purchase", 409);
    if (old.checkoutExpiresAt && old.checkoutExpiresAt <= now && old.status !== "paid")
      throw serviceError("Checkout order expired; start a new checkout", 409);
    if (!old.gatewayOrderId)
      throw serviceError("Checkout order is still being prepared; retry shortly", 409);
    return { order: old, keyId: subscriptionConfig.razorpayKeyId };
  }
  const provider = paymentProvider();
  const plan = await SubscriptionPlan.findOne({ code: planCode, enabled: true }).lean();
  if (!plan || plan.code === "free") throw serviceError("Paid plan not found", 404);
  const pricing = quoteSubscription(plan, months);
  const schedule = await getScheduleForPurchase(shopId, plan, null, new Date());
  let order;
  try {
    [order] = await PaymentOrder.create([
      {
        shopId,
        userId,
        appMode: subscriptionConfig.appMode,
        planId: plan._id,
        planCode,
        durationMonths: months,
        amountMinor: pricing.finalAmountMinor,
        currency: pricing.currency,
        pricingSnapshot: {
          plan: { id: String(plan._id), code: plan.code, name: plan.name, monthlyPriceMinor: plan.monthlyPriceMinor, customerLimit: plan.customerLimit, unlimitedCustomers: plan.unlimitedCustomers },
          ...pricing,
          createdAt: new Date().toISOString(),
        },
        idempotencyKey,
        requestHash: hash,
        status: "created",
        checkoutActive: true,
        checkoutExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        scheduledStartAt: schedule.status === "scheduled" ? schedule.startsAt : null,
      },
    ]);
  } catch (error) {
    if (error.code === 11000) {
      const existing = await PaymentOrder.findOne({ shopId, idempotencyKey }).lean();
      if (existing?.requestHash === hash && existing.gatewayOrderId)
        return { order: existing, keyId: subscriptionConfig.razorpayKeyId };
      if (existing?.requestHash === hash)
        throw serviceError("Checkout order is still being prepared; retry shortly", 409);
      throw serviceError("Another subscription checkout is already in progress", 409);
    }
    throw error;
  }
  let gateway;
  try {
    gateway = await provider.createOrder({
      amountMinor: pricing.finalAmountMinor,
      currency: pricing.currency,
      receipt: `dk_${String(shopId).slice(-10)}_${Date.now()}`,
      notes: { shopId: String(shopId), planCode, durationMonths: String(months) },
    });
  } catch (error) {
    await PaymentOrder.updateOne({ _id: order._id, shopId }, { $set: { status: "failed", checkoutActive: false } });
    throw error;
  }
  order.gatewayOrderId = gateway.id;
  await order.save();
  return { order, keyId: subscriptionConfig.razorpayKeyId };
}

async function reconcilePayment({ gatewayPayment, order, actorId, session }) {
  if (!gatewayPayment || gatewayPayment.order_id !== order.gatewayOrderId)
    throw serviceError("Payment does not match the order", 409);
  if (gatewayPayment.status !== "captured" || gatewayPayment.amount !== order.amountMinor || gatewayPayment.currency !== order.currency)
    throw serviceError("Payment amount or status does not match the order", 409);
  const existing = await PaymentTransaction.findOne({ gatewayPaymentId: gatewayPayment.id }).session(session);
  if (existing?.status === "captured" && existing.verificationStatus === "verified")
    return { payment: existing.toObject(), repeated: true };
  const plan = await SubscriptionPlan.findById(order.planId).session(session).lean();
  if (!plan) throw serviceError("Purchased plan is no longer available", 409);
  const now = new Date();
  const schedule = await getScheduleForPurchase(order.shopId, plan, session, now);
  const expiresAt = addCalendarMonths(schedule.startsAt, order.durationMonths);
  const payment = {
    shopId: order.shopId,
    orderId: order._id,
    provider: "razorpay",
    gatewayPaymentId: gatewayPayment.id,
    gatewayOrderId: gatewayPayment.order_id,
    amountMinor: gatewayPayment.amount,
    currency: gatewayPayment.currency,
    method: gatewayPayment.method,
    status: "captured",
    verificationStatus: "verified",
    gatewayCreatedAt: gatewayPayment.created_at ? new Date(gatewayPayment.created_at * 1000) : undefined,
    verifiedAt: now,
  };
  let paymentDoc = existing;
  if (paymentDoc) {
    paymentDoc.set(payment);
    await paymentDoc.save({ session });
  } else {
    [paymentDoc] = await PaymentTransaction.create([payment], { session });
  }
  const status = schedule.startsAt > now ? "scheduled" : "active";
  const [subscription] = await ShopSubscription.create(
    [
      {
        shopId: order.shopId,
        planId: plan._id,
        planCode: plan.code,
        planSnapshot: {
          code: plan.code,
          name: plan.name,
          monthlyPriceMinor: plan.monthlyPriceMinor,
          currency: plan.currency,
          customerLimit: plan.customerLimit,
          unlimitedCustomers: plan.unlimitedCustomers,
          entitlements: plan.entitlements || {},
        },
        status,
        startsAt: schedule.startsAt,
        expiresAt,
        durationMonths: order.durationMonths,
        sourcePaymentId: paymentDoc._id,
        renewalOf: schedule.renewalOf,
        activatedAt: status === "active" ? now : undefined,
        amountPaidMinor: order.amountMinor,
      },
    ],
    { session },
  );
  order.status = "paid";
  order.checkoutActive = false;
  order.verifiedAt = now;
  await order.save({ session });
  await SubscriptionAuditLog.create(
    [
      {
        shopId: order.shopId,
        previousPlan: schedule.previousPlan || null,
        newPlan: subscription.planSnapshot,
        eventType: status === "active" ? "subscription_activated" : "subscription_scheduled",
        referenceId: `payment:${paymentDoc._id}`,
        actorType: actorId ? "shopkeeper" : "gateway",
        ...(actorId ? { actorId } : {}),
        occurredAt: now,
        metadata: { durationMonths: order.durationMonths, amountMinor: order.amountMinor },
      },
    ],
    { session },
  );
  return { payment: paymentDoc.toObject(), subscription: subscription.toObject(), repeated: false };
}

export async function verifyPayment({ shopId, userId, orderId, paymentId, signature }) {
  const provider = paymentProvider({ forVerification: true });
  const order = await PaymentOrder.findOne({ _id: orderId, shopId });
  if (!order) throw serviceError("Payment order not found", 404);
  const expected = createHmac("sha256", subscriptionConfig.razorpayKeySecret)
    .update(`${order.gatewayOrderId}|${paymentId}`)
    .digest();
  let provided;
  try { provided = Buffer.from(signature, "hex"); } catch { provided = Buffer.alloc(0); }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
    throw serviceError("Payment signature is invalid", 400);
  const gatewayPayment = await provider.fetchPayment(paymentId);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const current = await PaymentOrder.findOne({ _id: order._id, shopId }).session(session);
      if (!current) throw serviceError("Payment order not found", 404);
      result = await reconcilePayment({ gatewayPayment, order: current, actorId: userId, session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const committed = await PaymentTransaction.findOne({ shopId, gatewayPaymentId: paymentId }).lean();
      if (committed && String(committed.orderId) === String(order._id)) {
        await notifyPaymentSuccess(shopId, paymentId);
        return { status: "paid", paymentId: String(committed._id), subscription: await getCurrentSubscription(shopId) };
      }
    }
    throw error;
  } finally { await session.endSession(); }
  await notifyPaymentSuccess(shopId, result.payment.gatewayPaymentId);
  return { status: "paid", paymentId: String(result.payment._id), subscription: await getCurrentSubscription(shopId) };
}

export async function getPaymentOrderStatus({ shopId, orderId }) {
  let order = await PaymentOrder.findOne({ _id: orderId, shopId });
  if (!order) throw serviceError("Payment order not found", 404);
  if (order.status !== "paid" && order.gatewayOrderId) {
    const provider = paymentProvider({ forVerification: true });
    const payments = await provider.fetchOrderPayments(order.gatewayOrderId);
    const captured = payments.find((payment) => payment.status === "captured");
    if (captured) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          order = await PaymentOrder.findOne({ _id: order._id, shopId }).session(session);
          if (!order) throw serviceError("Payment order not found", 404);
          if (order.status !== "paid")
            await reconcilePayment({ gatewayPayment: captured, order, actorId: null, session });
        });
      } catch (error) {
        if (error.code !== 11000) throw error;
        const committed = await PaymentTransaction.findOne({
          shopId,
          gatewayPaymentId: captured.id,
          orderId: order._id,
          status: "captured",
          verificationStatus: "verified",
        }).lean();
        if (!committed) throw error;
      } finally { await session.endSession(); }
      order = await PaymentOrder.findOne({ _id: orderId, shopId });
      if (order?.status === "paid") await notifyPaymentSuccess(shopId, captured.id);
    }
  }
  return {
    id: String(order._id),
    status: order.status === "created" ? "pending" : order.status,
    amountMinor: order.amountMinor,
    currency: order.currency,
  };
}

export async function processPaymentWebhook({ eventId, eventType, payment }) {
  const order = await PaymentOrder.findOne({ gatewayOrderId: payment.order_id }).lean();
  if (!order) return { ignored: true };
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const repeated = await mongoose.model("PaymentWebhookEvent").findOne({ eventId }).session(session);
      if (repeated?.status === "processed") { result = { duplicate: true }; return; }
      if (!repeated)
        await mongoose.model("PaymentWebhookEvent").create([{ eventId, eventType }], { session });
      const currentOrder = await PaymentOrder.findOne({ _id: order._id }).session(session);
      if (eventType === "payment.captured" || eventType === "order.paid") {
        result = await reconcilePayment({ gatewayPayment: payment, order: currentOrder, actorId: null, session });
      } else if (eventType === "payment.failed") {
        if (payment.order_id !== currentOrder.gatewayOrderId)
          throw serviceError("Payment does not match the order", 409);
        const existingPayment = await PaymentTransaction.findOne({ gatewayPaymentId: payment.id }).session(session);
        if (!existingPayment) {
          await PaymentTransaction.create([{
            shopId: currentOrder.shopId,
            orderId: currentOrder._id,
            provider: "razorpay",
            gatewayPaymentId: payment.id,
            gatewayOrderId: payment.order_id,
            amountMinor: Number.isSafeInteger(payment.amount) ? payment.amount : currentOrder.amountMinor,
            currency: payment.currency || currentOrder.currency,
            method: payment.method,
            status: "failed",
            verificationStatus: "verified",
            gatewayCreatedAt: payment.created_at ? new Date(payment.created_at * 1000) : undefined,
            verifiedAt: new Date(),
          }], { session });
        }
        if (currentOrder.status !== "paid") {
          currentOrder.status = "failed";
          currentOrder.checkoutActive = false;
          await currentOrder.save({ session });
          await SubscriptionAuditLog.create([{
            shopId: currentOrder.shopId,
            previousPlan: null,
            newPlan: null,
            eventType: "payment_failed",
            referenceId: `payment-failed:${payment.id}`,
            actorType: "gateway",
            occurredAt: new Date(),
            metadata: { paymentOrderId: String(currentOrder._id) },
          }], { session });
        }
        result = {
          failed: currentOrder.status !== "paid" && existingPayment?.status !== "captured",
        };
      } else if (["payment.refunded", "refund.processed"].includes(eventType)) {
        const transaction = await PaymentTransaction.findOne({ gatewayPaymentId: payment.id }).session(session);
        if (transaction) {
          const refundedAmountMinor = payment.amount_refunded;
          if (
            !Number.isSafeInteger(refundedAmountMinor) ||
            refundedAmountMinor < 0 ||
            refundedAmountMinor > transaction.amountMinor ||
            payment.currency !== transaction.currency ||
            payment.order_id !== transaction.gatewayOrderId
          )
            throw serviceError("Refund amount or payment does not match the transaction", 409);
          // Razorpay webhook payloads are event-time snapshots and can arrive
          // out of order. Cumulative refunded amount is monotonic, so an older
          // snapshot must never reduce the amount already reconciled.
          const reconciledRefundAmount = Math.max(
            transaction.refundedAmountMinor || 0,
            refundedAmountMinor,
          );
          transaction.refundedAmountMinor = reconciledRefundAmount;
          transaction.status = reconciledRefundAmount === 0
            ? "captured"
            : reconciledRefundAmount >= transaction.amountMinor
              ? "refunded"
              : "partially_refunded";
          transaction.refundReferences.addToSet(eventId);
          await transaction.save({ session });
          currentOrder.status = transaction.status;
          await currentOrder.save({ session });
          await SubscriptionAuditLog.create([{ shopId: currentOrder.shopId, eventType: "payment_refund_review_required", referenceId: `refund:${eventId}`, actorType: "gateway", occurredAt: new Date(), metadata: { paymentTransactionId: String(transaction._id), amountRefundedMinor: reconciledRefundAmount } }], { session });
        }
        result = { refunded: Boolean(transaction) };
      } else result = { ignored: true };
      await mongoose.model("PaymentWebhookEvent").updateOne({ eventId }, { $set: { status: "processed", processedAt: new Date() } }, { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const committed = payment?.id
        ? await PaymentTransaction.findOne({ gatewayPaymentId: payment.id }).lean()
        : null;
      if (committed) {
        await mongoose.model("PaymentWebhookEvent").updateOne(
          { eventId },
          { $setOnInsert: { eventId, eventType, status: "processed", processedAt: new Date() } },
          { upsert: true },
        ).catch(() => {});
        if (eventType === "payment.captured")
          await notifyPaymentSuccess(order.shopId, payment.id);
        if (eventType === "payment.failed")
          await notifyPaymentFailure(order.shopId, payment.id);
        return { duplicate: true };
      }
      const duplicateEvent = await mongoose.model("PaymentWebhookEvent").findOne({ eventId }).lean();
      if (duplicateEvent?.status === "processed") return { duplicate: true };
    }
    throw error;
  } finally { await session.endSession(); }
  if (eventType === "payment.captured" && result?.payment)
    await notifyPaymentSuccess(order.shopId, result.payment.gatewayPaymentId);
  if (eventType === "payment.failed" && result?.failed)
    await notifyPaymentFailure(order.shopId, payment.id);
  return result;
}
