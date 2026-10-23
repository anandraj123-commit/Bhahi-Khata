import mongoose from "mongoose";
import { createHash, randomUUID } from "node:crypto";
import {
  Customer,
  PaymentOrder,
  PaymentTransaction,
  Shop,
  ShopSubscription,
  SubscriptionAuditLog,
  SubscriptionPlan,
  SubscriptionUsage,
  User,
} from "../models.js";
import { subscriptionConfig } from "../config/env.js";
import { paymentProvider } from "../providers/paymentProvider.js";
import { cashfreeAmountMinor } from "../providers/cashfree.js";
import { digest } from "../utils/hashing.js";
import { sendSubscriptionPush } from "./subscriptionNotificationService.js";
import {
  calculateDurationPricing,
  normalizePaidPlanDurations,
  SUPPORTED_SUBSCRIPTION_DURATIONS,
} from "./subscriptionPricing.js";

const durations = SUPPORTED_SUBSCRIPTION_DURATIONS;
const defaultDurationPricing = (monthlyPriceMinor) => durations.map((months) => ({
  months,
  basePriceMinor: monthlyPriceMinor * months,
  discountPercent: 0,
  taxPercent: 0,
  isActive: true,
}));
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
    features: [],
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
    features: [],
    enabled: true,
    displayOrder: 1,
    durations: defaultDurationPricing(19900),
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
    features: [],
    enabled: true,
    displayOrder: 2,
    durations: defaultDurationPricing(49900),
  },
];

const serviceError = (message, status, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });

export async function ensureSubscriptionPlans() {
  // The unique code index is needed even while checkout is disabled so a
  // multi-instance startup cannot create duplicate canonical plan records.
  await SubscriptionPlan.createIndexes();
  for (const plan of seededPlans)
    await SubscriptionPlan.updateOne(
      { code: plan.code },
      { $setOnInsert: plan },
      { upsert: true },
    );
  for (const canonical of seededPlans) {
    const plan = await SubscriptionPlan.findOne({ code: canonical.code }).lean();
    if (!plan) throw new Error(`Canonical subscription plan ${canonical.code} could not be initialized`);
    if (plan.code === "free") {
      const correction = {};
      if (plan.enabled !== true) correction.enabled = true;
      if (plan.monthlyPriceMinor !== 0) correction.monthlyPriceMinor = 0;
      if (plan.currency !== "INR") correction.currency = "INR";
      if ((!Number.isSafeInteger(plan.customerLimit) || plan.customerLimit <= 0) && !plan.unlimitedCustomers) correction.customerLimit = 50;
      if (Object.keys(correction).length) {
        const version = Number.isSafeInteger(plan.configurationVersion) ? plan.configurationVersion : 1;
        const versionFilter = Number.isSafeInteger(plan.configurationVersion)
          ? { configurationVersion: version }
          : { configurationVersion: { $exists: false } };
        const result = await SubscriptionPlan.updateOne(
          { _id: plan._id, ...versionFilter },
          { $set: correction, $inc: { configurationVersion: 1 } },
        );
        if (result.modifiedCount !== 1)
          throw new Error("Free plan changed during canonical fallback validation; retry startup");
      }
      continue;
    }
    if (plan.currency !== "INR")
      throw new Error(`Plan ${plan.code} uses a non-INR currency; pricing migration requires review`);
    const hasLegacyTax = (plan.durations || []).length !== durations.length ||
      (plan.durations || []).some((duration) => duration.taxPercent == null);
    if (hasLegacyTax && subscriptionConfig.taxInclusive && subscriptionConfig.taxBps > 0)
      throw new Error("Legacy tax-inclusive plan pricing needs an explicit migration decision before startup");
    const migratedDurations = normalizePaidPlanDurations(plan, subscriptionConfig.taxBps / 100);
    const changed = (plan.durations || []).length !== durations.length ||
      (plan.durations || []).some((duration, index) => {
        const next = migratedDurations[index];
        return duration.months !== next.months ||
          duration.basePriceMinor !== next.basePriceMinor ||
          duration.discountPercent !== next.discountPercent ||
          duration.taxPercent !== next.taxPercent ||
          duration.isActive !== next.isActive;
      }) || !Number.isSafeInteger(plan.pricingVersion);
    if (!changed) continue;
    const version = Number.isSafeInteger(plan.configurationVersion) ? plan.configurationVersion : 1;
    const versionFilter = Number.isSafeInteger(plan.configurationVersion)
      ? { configurationVersion: version }
      : { configurationVersion: { $exists: false } };
    const result = await SubscriptionPlan.updateOne(
      { _id: plan._id, ...versionFilter },
      {
        $set: {
          durations: migratedDurations,
          pricingVersion: Number.isSafeInteger(plan.pricingVersion) ? plan.pricingVersion : 1,
          currency: "INR",
        },
        $inc: { configurationVersion: 1 },
      },
    );
    if (result.modifiedCount !== 1)
      throw new Error(`Plan ${plan.code} changed during pricing migration; retry startup`);
  }
}

export function quoteSubscription(plan, months) {
  if (!plan || !plan.enabled) throw serviceError("Plan is unavailable", 404);
  if (plan.code === "free")
    return {
      durationMonths: 0,
      currency: plan.currency,
      basePriceMinor: 0,
      originalAmountMinor: 0,
      discountPercent: 0,
      discountAmountMinor: 0,
      taxableAmountMinor: 0,
      taxPercent: 0,
      taxRateBps: 0,
      taxInclusive: false,
      taxAmountMinor: 0,
      finalAmountMinor: 0,
    };
  const duration = plan.durations.find((item) => item.months === months);
  if (!duration || duration.isActive === false) throw serviceError("Subscription duration is unavailable", 400);
  const pricing = calculateDurationPricing({
    months,
    basePriceMinor: duration.basePriceMinor ?? plan.monthlyPriceMinor * months,
    discountPercent: duration.discountPercent ?? 0,
    taxPercent: duration.taxPercent ?? subscriptionConfig.taxBps / 100,
    isActive: duration.isActive !== false,
    pricingVersion: plan.pricingVersion || 1,
  });
  return {
    ...pricing,
    originalAmountMinor: pricing.basePriceMinor,
    discountedAmountMinor: pricing.taxableAmountMinor,
    taxInclusive: false,
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
    features: plan.features || [],
    enabled: plan.enabled,
    displayOrder: plan.displayOrder,
    configurationVersion: plan.configurationVersion,
    pricingVersion: plan.pricingVersion || 1,
    durations: plan.durations.filter((duration) => duration.isActive !== false).map((duration) => ({
      ...quoteSubscription(plan, duration.months),
      months: duration.months,
    })),
  };
  if (plan.code === "free") value.durations = [];
  return value;
}

export async function listSubscriptionPlans() {
  const plans = await SubscriptionPlan.find({ code: { $in: ["free", "pro", "business"] }, enabled: true })
    .sort({ displayOrder: 1, _id: 1 })
    .lean();
  return {
    items: plans.map(planOut),
    checkoutEnabled: subscriptionConfig.checkoutEnabled,
    provider: "cashfree",
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
      configurationVersion: plan.configurationVersion || 1,
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
            configurationVersion: scheduledPlan.configurationVersion || 1,
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
    entitlementVersion: plan?.configurationVersion || 1,
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

export function addCalendarMonths(date, months) {
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

export async function createSubscriptionOrder({ shopId, userId, planCode, months, idempotencyKey, acceptedPricingVersion }) {
  if (!idempotencyKey || idempotencyKey.length > 128)
    throw serviceError("A valid Idempotency-Key is required", 400);
  paymentProvider();
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
    if (old.status === "failed") throw serviceError("Checkout order failed; start a new checkout", 409);
    return { order: await prepareCashfreeOrder(old), repeated: true };
  }
  const plan = await SubscriptionPlan.findOne({ code: planCode, enabled: true }).lean();
  if (!plan || plan.code === "free") throw serviceError("Paid plan not found", 404);
  const pricing = quoteSubscription(plan, months);
  if (!Number.isSafeInteger(acceptedPricingVersion))
    throw serviceError("Refresh the plan price before checkout", 428, { code: "SUBSCRIPTION_PRICE_ACCEPTANCE_REQUIRED" });
  if (acceptedPricingVersion !== pricing.pricingVersion)
    throw serviceError("Subscription pricing changed. Review and accept the new total.", 409, {
      code: "SUBSCRIPTION_PRICE_CHANGED",
      currentPricing: {
        planCode: plan.code,
        planName: plan.name,
        ...pricing,
      },
    });
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
          plan: {
            id: String(plan._id),
            code: plan.code,
            name: plan.name,
            description: plan.description,
            monthlyPriceMinor: plan.monthlyPriceMinor,
            currency: plan.currency,
            customerLimit: plan.customerLimit,
            unlimitedCustomers: plan.unlimitedCustomers,
            entitlements: plan.entitlements || {},
            features: plan.features || [],
            configurationVersion: plan.configurationVersion || 1,
            pricingVersion: plan.pricingVersion || 1,
          },
          ...pricing,
          createdAt: new Date().toISOString(),
        },
        idempotencyKey,
        requestHash: hash,
        providerRequestId: randomUUID(),
        status: "created",
        checkoutActive: true,
        checkoutExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        scheduledStartAt: schedule.status === "scheduled" ? schedule.startsAt : null,
      },
    ]);
  } catch (error) {
    if (error.code === 11000) {
      const existing = await PaymentOrder.findOne({ shopId, idempotencyKey }).lean();
      if (existing?.requestHash === hash)
        return { order: await prepareCashfreeOrder(existing), repeated: true };
      throw serviceError("Another subscription checkout is already in progress", 409);
    }
    throw error;
  }
  return { order: await prepareCashfreeOrder(order.toObject()), repeated: false };
}

async function prepareCashfreeOrder(order) {
  if (order.gatewayOrderId && order.paymentSessionId)
    return order;
  if (order.status === "paid") return order;
  let providerRequestId = order.providerRequestId;
  if (!providerRequestId) {
    await PaymentOrder.updateOne(
      { _id: order._id, providerRequestId: { $exists: false } },
      { $set: { providerRequestId: randomUUID() } },
    );
    const current = await PaymentOrder.findById(order._id).lean();
    providerRequestId = current?.providerRequestId;
    if (current) order = current;
  }
  if (!providerRequestId)
    throw serviceError("Checkout order is still being prepared; retry shortly", 409);
  const [user, shop] = await Promise.all([
    User.findById(order.userId).select("phone").lean(),
    Shop.findById(order.shopId).select("owner").lean(),
  ]);
  const customerPhone = String(user?.phone || "").replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(customerPhone))
    throw serviceError("A valid shop owner mobile number is required for checkout", 400);
  const provider = paymentProvider();
  const gateway = await provider.createOrder({
    orderId: `dk_${String(order._id)}`,
    amountMinor: order.amountMinor,
    currency: order.currency,
    customerId: `shop_${String(order.shopId).replaceAll("-", "")}`,
    customerPhone,
    customerName: shop?.owner || undefined,
    idempotencyKey: providerRequestId,
  });
  await PaymentOrder.updateOne(
    { _id: order._id, status: { $ne: "paid" } },
    {
      $set: {
        gatewayOrderId: gateway.id,
        gatewayReferenceId: gateway.cfOrderId || undefined,
        paymentSessionId: gateway.paymentSessionId,
        status: "pending",
      },
    },
  );
  return await PaymentOrder.findById(order._id).lean();
}

function normalizeCashfreePayment(payment) {
  if (!payment || !payment.cf_payment_id || !payment.order_id)
    throw serviceError("Cashfree payment record is incomplete", 409);
  const amountMinor = cashfreeAmountMinor(payment.payment_amount);
  const status = payment.payment_status === "SUCCESS"
    ? "captured"
    : ["FAILED", "USER_DROPPED", "CANCELLED"].includes(payment.payment_status)
      ? "failed"
      : "pending";
  return {
    id: String(payment.cf_payment_id),
    order_id: payment.order_id,
    status,
    gatewayStatus: payment.payment_status,
    amount: amountMinor,
    currency: payment.payment_currency,
    method: payment.payment_group,
    created_at: payment.payment_time,
  };
}

function assertCashfreeOrder(order, providerOrder) {
  const amountMinor = cashfreeAmountMinor(providerOrder?.order_amount);
  if (
    providerOrder?.order_id !== order.gatewayOrderId ||
    providerOrder?.order_status !== "PAID" ||
    amountMinor !== order.amountMinor ||
    providerOrder?.order_currency !== order.currency
  )
    throw serviceError("Payment amount, order or status does not match", 409);
}

async function reconcilePayment({ gatewayPayment, gatewayOrder, order, actorId, session }) {
  assertCashfreeOrder(order, gatewayOrder);
  if (!gatewayPayment || gatewayPayment.order_id !== order.gatewayOrderId)
    throw serviceError("Payment does not match the order", 409);
  if (gatewayPayment.status !== "captured" || gatewayPayment.amount !== order.amountMinor || gatewayPayment.currency !== order.currency)
    throw serviceError("Payment amount or status does not match the order", 409);
  const existing = await PaymentTransaction.findOne({ gatewayPaymentId: gatewayPayment.id }).session(session);
  if (existing && (String(existing.shopId) !== String(order.shopId) || String(existing.orderId) !== String(order._id)))
    throw serviceError("Payment reference is already attached to another order", 409);
  if (existing?.status === "captured" && existing.verificationStatus === "verified")
    return { payment: existing.toObject(), repeated: true };
  const plan = order.pricingSnapshot?.plan;
  if (!plan || plan.code !== order.planCode)
    throw serviceError("Purchased plan snapshot is unavailable", 409);
  const now = new Date();
  const schedule = await getScheduleForPurchase(order.shopId, plan, session, now);
  const expiresAt = addCalendarMonths(schedule.startsAt, order.durationMonths);
  const payment = {
    shopId: order.shopId,
    orderId: order._id,
    provider: "cashfree",
    gatewayPaymentId: gatewayPayment.id,
    gatewayOrderId: gatewayPayment.order_id,
    amountMinor: gatewayPayment.amount,
    currency: gatewayPayment.currency,
    method: gatewayPayment.method,
    status: "captured",
    verificationStatus: "verified",
    gatewayCreatedAt: gatewayPayment.created_at
      ? (typeof gatewayPayment.created_at === "number" ? new Date(gatewayPayment.created_at * 1000) : new Date(gatewayPayment.created_at))
      : undefined,
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
        planId: order.planId,
        planCode: plan.code,
        planSnapshot: { ...plan },
        pricingSnapshot: { ...order.pricingSnapshot },
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

async function activateVerifiedPayment({ shopId, userId, order, gatewayOrder, payment }) {
  assertCashfreeOrder(order, gatewayOrder);
  const gatewayPayment = normalizeCashfreePayment(payment);
  if (gatewayPayment.status !== "captured" || gatewayPayment.amount !== order.amountMinor || gatewayPayment.currency !== order.currency)
    throw serviceError("Payment amount or status does not match the order", 409);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const current = await PaymentOrder.findOne({ _id: order._id, shopId }).session(session);
      if (!current) throw serviceError("Payment order not found", 404);
      if (current.status !== "paid")
        result = await reconcilePayment({ gatewayPayment, gatewayOrder, order: current, actorId: userId || null, session });
      else {
        const committed = await PaymentTransaction.findOne({ orderId: current._id, status: "captured", verificationStatus: "verified" }).session(session);
        if (!committed) throw serviceError("Paid order has no verified transaction", 409);
        result = { payment: committed.toObject(), repeated: true };
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      const committed = await PaymentTransaction.findOne({ shopId, gatewayPaymentId: gatewayPayment.id, orderId: order._id, status: "captured", verificationStatus: "verified" }).lean();
      if (committed) result = { payment: committed, repeated: true };
      else throw error;
    } else throw error;
  } finally { await session.endSession(); }
  await notifyPaymentSuccess(shopId, gatewayPayment.id);
  return { status: "paid", paymentId: String(result.payment._id), subscription: await getCurrentSubscription(shopId) };
}

async function inspectCashfreeOrder(order, userId = null) {
  if (!order.gatewayOrderId) return { id: String(order._id), status: "pending", amountMinor: order.amountMinor, currency: order.currency };
  const provider = paymentProvider({ forVerification: true });
  const [gatewayOrder, payments] = await Promise.all([
    provider.fetchOrder(order.gatewayOrderId),
    provider.fetchOrderPayments(order.gatewayOrderId),
  ]);
  const successful = payments.find((payment) => payment.payment_status === "SUCCESS");
  if (gatewayOrder.order_status === "PAID" && successful) {
    const result = await activateVerifiedPayment({ shopId: order.shopId, userId, order, gatewayOrder, payment: successful });
    return { id: String(order._id), status: "paid", amountMinor: order.amountMinor, currency: order.currency, paymentId: result.paymentId, subscription: result.subscription };
  }
  if (["EXPIRED", "TERMINATED"].includes(gatewayOrder.order_status) && order.status !== "paid") {
    await PaymentOrder.updateOne({ _id: order._id, shopId: order.shopId, status: { $ne: "paid" } }, { $set: { status: "failed", checkoutActive: false } });
    order.status = "failed";
  }
  return {
    id: String(order._id),
    status: order.status === "created" ? "pending" : order.status,
    amountMinor: order.amountMinor,
    currency: order.currency,
    gatewayOrderId: order.gatewayOrderId,
  };
}

export async function verifyPayment({ shopId, userId, orderId }) {
  const order = await PaymentOrder.findOne({ _id: orderId, shopId }).lean();
  if (!order) throw serviceError("Payment order not found", 404);
  if (order.status === "paid") {
    const payment = await PaymentTransaction.findOne({ orderId: order._id, status: "captured", verificationStatus: "verified" }).lean();
    return { status: "paid", paymentId: payment ? String(payment._id) : null, subscription: await getCurrentSubscription(shopId) };
  }
  return inspectCashfreeOrder(order, userId);
}

export async function getPaymentOrderStatus({ shopId, orderId }) {
  const order = await PaymentOrder.findOne({ _id: orderId, shopId }).lean();
  if (!order) throw serviceError("Payment order not found", 404);
  if (order.status === "paid") {
    const payment = await PaymentTransaction.findOne({ orderId: order._id, status: "captured", verificationStatus: "verified" }).lean();
    return { id: String(order._id), status: "paid", amountMinor: order.amountMinor, currency: order.currency, paymentId: payment ? String(payment._id) : null };
  }
  return inspectCashfreeOrder(order);
}

export async function getPaymentAttemptStatus({ shopId, idempotencyKey }) {
  const order = await PaymentOrder.findOne({ shopId, idempotencyKey }).select("_id").lean();
  if (!order) throw serviceError("Payment attempt not found", 404);
  return getPaymentOrderStatus({ shopId, orderId: String(order._id) });
}

const paymentReconciliationBackoffMinutes = [1, 5, 15, 60, 240, 720, 1440, 2880];
const PAYMENT_RECONCILIATION_MAX_ATTEMPTS = paymentReconciliationBackoffMinutes.length;

/** Bounded recovery for paid orders whose app callback and webhook were missed. */
export async function reconcilePendingCashfreePayments({ limit = 20, now = new Date() } = {}) {
  const boundedLimit = Math.min(50, Math.max(1, Number.isSafeInteger(limit) ? limit : 20));
  const recentCutoff = new Date(now.getTime() - 7 * 86400000);
  const candidates = await PaymentOrder.find({
    status: { $in: ["created", "pending"] },
    gatewayOrderId: { $type: "string" },
    createdAt: { $gte: recentCutoff },
    $or: [
      { paymentReconciliationAttempts: { $lt: PAYMENT_RECONCILIATION_MAX_ATTEMPTS } },
      { paymentReconciliationAttempts: { $exists: false } },
    ],
    $and: [{
      $or: [
        { paymentReconciliationNextAt: { $exists: false } },
        { paymentReconciliationNextAt: null },
        { paymentReconciliationNextAt: { $lte: now } },
      ],
    }],
  })
    .sort({ paymentReconciliationNextAt: 1, createdAt: 1, _id: 1 })
    .limit(boundedLimit)
    .select("_id shopId status createdAt paymentReconciliationAttempts paymentReconciliationNextAt")
    .lean();
  const result = { scanned: candidates.length, attempted: 0, paid: 0, pending: 0, failed: 0, skipped: 0 };
  for (const candidate of candidates) {
    const attempts = candidate.paymentReconciliationAttempts ?? 0;
    const delayMinutes = paymentReconciliationBackoffMinutes[attempts];
    if (delayMinutes === undefined) { result.skipped += 1; continue; }
    const due = candidate.paymentReconciliationNextAt;
    const claim = await PaymentOrder.findOneAndUpdate(
      {
        _id: candidate._id,
        status: { $in: ["created", "pending"] },
        $and: [
          {
            $or: [
              { paymentReconciliationAttempts: attempts },
              ...(candidate.paymentReconciliationAttempts == null
                ? [{ paymentReconciliationAttempts: { $exists: false } }]
                : []),
            ],
          },
          {
            $or: [
              { paymentReconciliationNextAt: { $exists: false } },
              { paymentReconciliationNextAt: null },
              { paymentReconciliationNextAt: { $lte: now } },
            ],
          },
        ],
        ...(due ? { paymentReconciliationNextAt: due } : {}),
      },
      {
        $inc: { paymentReconciliationAttempts: 1 },
        $set: { paymentReconciliationNextAt: new Date(now.getTime() + delayMinutes * 60000) },
      },
      { new: true },
    ).lean();
    if (!claim) { result.skipped += 1; continue; }
    result.attempted += 1;
    try {
      const status = await inspectCashfreeOrder(claim);
      if (status.status === "paid") result.paid += 1;
      else if (status.status === "failed") result.failed += 1;
      else result.pending += 1;
      await PaymentOrder.updateOne(
        { _id: claim._id },
        { $unset: { paymentReconciliationLastCode: 1 } },
      );
    } catch (error) {
      const code = typeof error?.code === "string" && /^[A-Z0-9_-]{1,40}$/i.test(error.code)
        ? error.code
        : "PAYMENT_RECONCILIATION_FAILED";
      await PaymentOrder.updateOne(
        { _id: claim._id, status: { $in: ["created", "pending"] } },
        { $set: { paymentReconciliationLastCode: code } },
      );
      result.failed += 1;
    }
  }
  return result;
}

export async function processPaymentWebhook({ eventId, eventType, orderId, paymentId }) {
  const order = await PaymentOrder.findOne({ gatewayOrderId: orderId }).lean();
  if (!order) return { ignored: true };
  const paymentEvent = await mongoose.model("PaymentWebhookEvent").findOne({ eventId }).lean();
  if (paymentEvent?.status === "processed") return { duplicate: true };
  const provider = paymentProvider({ forVerification: true });
  const [gatewayOrder, remotePayment] = await Promise.all([
    provider.fetchOrder(order.gatewayOrderId),
    provider.fetchPayment({ orderId: order.gatewayOrderId, paymentId }),
  ]);
  const normalized = normalizeCashfreePayment(remotePayment);
  if (normalized.order_id !== order.gatewayOrderId)
    throw serviceError("Webhook payment does not match the order", 409);
  const successEvent = eventType === "PAYMENT_SUCCESS_WEBHOOK";
  const failureEvent = ["PAYMENT_FAILED_WEBHOOK", "PAYMENT_USER_DROPPED_WEBHOOK"].includes(eventType);
  if (!successEvent && !failureEvent) return { ignored: true };
  if (successEvent && (normalized.status !== "captured" || gatewayOrder.order_status !== "PAID"))
    throw serviceError("Cashfree payment is not yet verifiably paid", 503);
  if (failureEvent && normalized.status !== "failed") return { ignored: true };

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const WebhookEvent = mongoose.model("PaymentWebhookEvent");
      const repeated = await WebhookEvent.findOne({ eventId }).session(session);
      if (repeated?.status === "processed") { result = { duplicate: true }; return; }
      if (!repeated) await WebhookEvent.create([{ eventId, eventType }], { session });
      const currentOrder = await PaymentOrder.findOne({ _id: order._id, shopId: order.shopId }).session(session);
      if (!currentOrder) throw serviceError("Payment order not found", 404);
      if (successEvent) {
        result = await reconcilePayment({ gatewayPayment: normalized, gatewayOrder, order: currentOrder, actorId: null, session });
      } else {
        const existing = await PaymentTransaction.findOne({ gatewayPaymentId: normalized.id }).session(session);
        if (existing && (String(existing.shopId) !== String(currentOrder.shopId) || String(existing.orderId) !== String(currentOrder._id)))
          throw serviceError("Payment reference is already attached to another order", 409);
        if (currentOrder.status !== "paid" && existing?.status !== "captured") {
          const record = {
            shopId: currentOrder.shopId,
            orderId: currentOrder._id,
            provider: "cashfree",
            gatewayPaymentId: normalized.id,
            gatewayOrderId: normalized.order_id,
            amountMinor: normalized.amount ?? currentOrder.amountMinor,
            currency: normalized.currency || currentOrder.currency,
            method: normalized.method,
            status: "failed",
            verificationStatus: "verified",
            gatewayCreatedAt: normalized.created_at ? new Date(normalized.created_at) : undefined,
            verifiedAt: new Date(),
          };
          if (existing) { existing.set(record); await existing.save({ session }); }
          else await PaymentTransaction.create([record], { session });
          await SubscriptionAuditLog.create([{
            shopId: currentOrder.shopId,
            previousPlan: null,
            newPlan: null,
            eventType: "payment_failed",
            referenceId: `payment-failed:${normalized.id}`,
            actorType: "gateway",
            occurredAt: new Date(),
            metadata: { paymentOrderId: String(currentOrder._id) },
          }], { session });
        }
        result = { failed: currentOrder.status !== "paid" };
      }
      await WebhookEvent.updateOne({ eventId }, { $set: { status: "processed", processedAt: new Date() } }, { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const duplicateEvent = await mongoose.model("PaymentWebhookEvent").findOne({ eventId }).lean();
      const committed = await PaymentTransaction.findOne({ shopId: order.shopId, gatewayPaymentId: normalized.id, orderId: order._id }).lean();
      if (duplicateEvent?.status === "processed" || committed) return { duplicate: true };
    }
    throw error;
  } finally { await session.endSession(); }
  if (successEvent && result?.payment) await notifyPaymentSuccess(order.shopId, normalized.id);
  if (failureEvent && result?.failed) await notifyPaymentFailure(order.shopId, normalized.id);
  return result;
}
