import mongoose from "mongoose";
import { log } from "../config/logger.js";
import { schedulePurchase, effectiveStatus } from "./subscriptionTimeline.js";
import { createHash, randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import {
  Customer,
  PaymentOrder,
  PaymentOrderRecovery,
  PaymentTransaction,
  Shop,
  ShopSubscription,
  SubscriptionAuditLog,
  SubscriptionPlan,
  SubscriptionUsage,
  User,
  WalletAccount,
  WalletLedgerEntry,
} from "../models.js";
import { jwtKey, subscriptionConfig } from "../config/env.js";
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
    tier: 0,
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
    tier: 1,
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
    tier: 2,
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
    tier: plan.tier ?? ({ free: 0, pro: 1, business: 2 }[plan.code]),
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
  const query = ShopSubscription.find({ shopId, status: { $in: ["active", "paused", "scheduled"] }, $or: [{ expiresAt: { $gt: now } }, { expiresAt: null }] }).sort({ startsAt: 1, _id: 1 });
  if (session) query.session(session);
  const rows = await query.lean();
  const active = rows.find(row => row.startsAt <= now) || null;
  const future = rows.filter(row => row.startsAt > now);
  return { active, scheduled: future[0] || null, rows, future };
}

async function freePlan(session) {
  const query = SubscriptionPlan.findOne({ code: "free" });
  if (session) query.session(session);
  return query.lean();
}

export async function getCurrentSubscription(shopId, now = new Date()) {
  const [{ active, scheduled, future }, fallback, customers] = await Promise.all([
    currentRows(shopId, now),
    freePlan(),
    Customer.countDocuments({ shopId, deletedAt: { $exists: false }, status: { $ne: false }, disabled: { $ne: true }, removed: { $ne: true }, subscriptionArchived: { $ne: true } }),
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
      archived: await Customer.countDocuments({ shopId, deletedAt: { $exists: false }, subscriptionArchived: true }),
      selectionRequired: !plan?.unlimitedCustomers && plan?.customerLimit != null && customers > plan.customerLimit,
      limit: plan?.customerLimit ?? null,
      unlimited: Boolean(plan?.unlimitedCustomers),
      remaining: plan?.unlimitedCustomers || plan?.customerLimit == null
        ? null
        : Math.max(0, plan.customerLimit - customers),
    },
    verifiedAt,
    lastSyncedAt: verifiedAt,
    entitlementVersion: (await Shop.findById(shopId).select("entitlementRevision").lean())?.entitlementRevision || 0,
    offlineGraceMilliseconds: subscriptionConfig.offlineGraceMilliseconds,
    fallbackPlan: fallback,
    timeline: [active, ...future].filter(Boolean).map(row => ({
      id: String(row._id), plan: { ...row.planSnapshot, code: row.planCode },
      status: effectiveStatus(row, now), startsAt: row.startsAt.toISOString(), expiresAt: row.expiresAt?.toISOString() || null,
      durationMonths: row.durationMonths, remainingMilliseconds: row.remainingMilliseconds ?? null,
      pauseReason: row.pauseReason || null, paymentStatus: "paid",
    })),
    archivedCustomerIds: await Customer.distinct("clientId", { shopId, deletedAt: { $exists: false }, subscriptionArchived: true }),
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
      const status = effectiveStatus(row, now);
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
        segments: row.segments || [],
        pauseReason: row.pauseReason || null,
        preservedMilliseconds: row.remainingMilliseconds ?? null,
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
  const filter = { shopId, appMode: subscriptionConfig.appMode };
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
    .sort({ gatewayCreatedAt: -1, _id: -1 })
    .lean();
  const paymentPriority = (status) =>
    ["refunded", "partially_refunded"].includes(status) ? 3 : status === "captured" ? 2 : 0;
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
        amountMinor: row.totalAmountMinor ?? (row.amountMinor + (row.walletAppliedMinor || 0)),
        cashPaidMinor: row.amountMinor,
        walletAppliedMinor: row.walletAppliedMinor || 0,
        currency: row.currency,
        status: payment?.refundedAmountMinor > 0
          ? (payment.refundedAmountMinor >= payment.amountMinor ? "refunded" : "partially_refunded")
          : payment?.status || (row.status === "created" ? "pending" : row.status),
        orderStatus: row.status,
        attemptStatus: payment?.status || null,
        attempts: transactions.filter(attempt => String(attempt.orderId) === String(row._id)).map(attempt => ({
          id: String(attempt._id), gatewayPaymentId: attempt.gatewayPaymentId,
          status: attempt.status, gatewayStatus: attempt.gatewayStatus,
          refundedAmountMinor: attempt.refundedAmountMinor || 0,
          verifiedAt: attempt.verifiedAt?.toISOString() || null,
        })),
        gatewayOrderId: row.gatewayOrderId || null,
        gatewayPaymentId: payment?.gatewayPaymentId || null,
        method: payment?.method || null,
        refundedAmountMinor: payment?.refundedAmountMinor ?? (payment?.status === "refunded" ? payment.amountMinor : 0),
        createdAt: row.createdAt.toISOString(),
        refunded: payment?.refundedAmountMinor > 0 || payment?.status === "refunded" || payment?.status === "partially_refunded",
      };
    }),
    nextCursor: more ? String(rows.at(-1)._id) : null,
  };
}

export async function getOperationalPlan(shopId, session) {
  const { active } = await currentRows(shopId, new Date(), session);
  return active?.planSnapshot || await freePlan(session);
}

export async function reserveCustomerCapacity({ shopId, session }) {
  await Shop.updateOne({ _id: shopId }, { $inc: { entitlementRevision: 1 } }, { session });
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
  const activeCustomers = await Customer.countDocuments({ shopId, deletedAt: { $exists: false }, status: { $ne: false }, disabled: { $ne: true }, removed: { $ne: true }, subscriptionArchived: { $ne: true } });
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

async function getScheduleForPurchase(shopId, plan, session, now, months = 1) {
  // This shared document serializes every entitlement insertion for a shop.
  if (session) await Shop.updateOne({ _id: shopId }, { $inc: { entitlementRevision: 1 } }, { session });
  const { rows, active } = await currentRows(shopId, now, session);
  if (rows.some(row => !row.expiresAt)) throw serviceError("An existing lifetime entitlement requires review before another purchase.", 409);
  const result = schedulePurchase(rows, { planCode: plan.code, planSnapshot: plan, durationMonths: months, createdAt: now }, now);
  if (session) {
    for (const row of result.rows) {
      const before = rows.find(item => String(item._id) === String(row._id));
      if (row.status === "paused" && before?.status !== "paused") {
        await SubscriptionAuditLog.create([{ shopId, eventType: "subscription_paused", referenceId: `pause:${row._id}:${+now}`, actorType: "system", occurredAt: now, previousPlan: row.planSnapshot, metadata: { remainingMilliseconds: row.remainingMilliseconds, reason: row.pauseReason } }], { session });
      }
      await ShopSubscription.updateOne({ _id: row._id }, { $set: {
        startsAt: row.startsAt, expiresAt: row.expiresAt, status: row.status,
        segments: row.segments, remainingMilliseconds: row.remainingMilliseconds,
        pauseReason: row.pauseReason,
      } }, { session });
    }
  }
  return { ...result.incoming, renewalOf: active?._id, previousPlan: active?.planSnapshot };
}

function previewFingerprint(shopId, plan, months, useWallet, rows, active) {
  return digest(JSON.stringify({ shopId: String(shopId), plan, months, useWallet: useWallet === true,
    active: active?._id || null,
    rows: rows.map(r => [String(r._id), r.startsAt, r.expiresAt, r.status]),
  }));
}
async function previewState(shopId, plan, months, useWallet, session) {
  const query = SubscriptionPlan.findOne({ _id: plan._id, enabled: true });
  if (session) query.session(session);
  const livePlan = await query.lean();
  const { rows, active } = await currentRows(shopId, new Date(), session);
  return previewFingerprint(shopId, livePlan, months, useWallet, rows, active);
}
function signPreview(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + createHmac("sha256", jwtKey).update(body).digest("base64url");
}
async function validatePreview(token, shopId, plan, months, useWallet, session) {
  try {
    const [body, signature, extra] = String(token || "").split(".");
    const expected = createHmac("sha256", jwtKey).update(body || "").digest();
    const provided = Buffer.from(signature || "", "base64url");
    if (extra || expected.length !== provided.length || !timingSafeEqual(expected, provided)) throw new Error();
    const value = JSON.parse(Buffer.from(body, "base64url").toString());
    if (value.expiresAt <= Date.now() || value.state !== await previewState(shopId, plan, months, useWallet, session)) throw new Error();
    return value;
  } catch {
    throw serviceError("Subscription terms changed or preview expired. Review a fresh preview before paying.", 409, { code: "SUBSCRIPTION_PREVIEW_CHANGED" });
  }
}
export async function previewSubscriptionPurchase({ shopId, planCode, months, useWallet = false }) {
  const plan = await SubscriptionPlan.findOne({ code: planCode, enabled: true }).lean();
  const pricing = quoteSubscription(plan, months);
  const now = new Date();
  const { rows, active } = await currentRows(shopId, now);
  if (rows.some(row => !row.expiresAt)) throw serviceError("An existing lifetime entitlement requires review before another purchase.", 409);
  const outcome = schedulePurchase(rows, { planCode, planSnapshot: plan, durationMonths: months }, now);
  const paused = outcome.rows.find(r => r._id?.equals?.(active?._id) && r.status === "paused");
  const message = paused
    ? `${plan.name} will activate after verified payment. Your remaining ${Math.ceil(paused.remainingMilliseconds / 86400000)} days of ${active.planSnapshot.name} will be preserved and resume after higher-tier subscriptions finish.`
    : outcome.incoming.status === "active" ? `${plan.name} will activate after verified payment.`
    : `Your new ${plan.name} subscription will start after the preceding subscription commitments.`;
  return {
    token: signPreview({ state: previewFingerprint(shopId, plan, months, useWallet, rows, active), expiresAt: Date.now() + 10 * 60000, outcome: { message, startsAt: outcome.incoming.startsAt, expiresAt: outcome.incoming.expiresAt, customerLimit: plan.customerLimit } }),
    pricing, message, startsAt: outcome.incoming.startsAt, expiresAt: outcome.incoming.expiresAt,
    customerLimit: plan.customerLimit, unlimitedCustomers: plan.unlimitedCustomers,
    currentCustomerLimit: active?.planSnapshot?.customerLimit ?? null,
    timeline: outcome.ordered.map(r => ({ planCode: r.planCode, status: r.status, startsAt: r.startsAt, expiresAt: r.expiresAt })),
  };
}

export async function createSubscriptionOrder({ shopId, userId, planCode, months, idempotencyKey, acceptedPricingVersion, useWallet = false, previewToken, acknowledgeDuplicateRisk = false }) {
  if (!idempotencyKey || idempotencyKey.length > 128)
    throw serviceError("A valid Idempotency-Key is required", 400);
  // Keep existing distribution, compliance and payment-readiness gates for all
  // paid-plan purchases, including wallet-only purchases.
  paymentProvider();
  const hash = digest(JSON.stringify(useWallet === true ? { planCode, months, useWallet: true } : { planCode, months }));
  const now = new Date();
  // A local checkout deadline is not proof that no money was captured.
  // Reconcile expired attempts with Cashfree; timeouts retain the lock/reference.
  const expiredAttempts = await PaymentOrder.find({ shopId, appMode: subscriptionConfig.appMode,
    status: { $in: ["created", "pending"] }, checkoutActive: true,
    checkoutExpiresAt: { $lte: now },
  }).lean();
  for (const attempt of expiredAttempts) {
    try { await inspectCashfreeOrder(attempt, userId); } catch (error) { if (!acknowledgeDuplicateRisk) throw error; }
  }
  let old = await PaymentOrder.findOne({ shopId, idempotencyKey, appMode: subscriptionConfig.appMode }).lean();
  if (!old) {
    const recovery = await PaymentOrderRecovery.findOne({ shopId, idempotencyKey, appMode: subscriptionConfig.appMode }).lean();
    if (recovery) old = await recoverMissingOrder(shopId, String(recovery._id));
  }
  if (old) {
    if (old.requestHash !== hash) throw serviceError("Idempotency key was used for a different purchase", 409);
    if (old.checkoutExpiresAt && old.checkoutExpiresAt <= now && old.status !== "paid")
      throw serviceError("Checkout order expired; start a new checkout", 409);
    if (old.status === "failed") throw serviceError("Checkout order failed; start a new checkout", 409);
    return { order: await prepareCashfreeOrder(old), repeated: true };
  }
  // Retired checkout slots can still settle later. Keep the warning requirement
  // even after a different order was completed; history must not silently vanish.
  if (!acknowledgeDuplicateRisk) {
    const retained = await PaymentOrder.find({ shopId, appMode: subscriptionConfig.appMode,
      checkoutActive: false, status: { $in: ["created", "pending"] } }).lean();
    for (const previous of retained) {
      let result;
      try { result = await inspectCashfreeOrder(previous, userId); } catch { /* unresolved */ }
      if (!result || result.status === "pending" || result.hasPendingAttempts) throw serviceError(
        "An earlier payment is unresolved. Check its status or acknowledge the duplicate-charge risk before a new purchase.",
        409, { code: "PAYMENT_PENDING" });
    }
  }
  const reservedCheckout = await PaymentOrder.findOne({ shopId, appMode: subscriptionConfig.appMode, checkoutActive: true }).lean();
  if (reservedCheckout) {
    let inspected;
    try { inspected = await inspectCashfreeOrder(reservedCheckout, userId); }
    catch (error) { if (!acknowledgeDuplicateRisk) throw error; }
    if ((inspected?.hasPendingAttempts || (inspected?.status !== "paid" && inspected?.status !== "failed")) && !acknowledgeDuplicateRisk)
      throw serviceError("An earlier payment is unresolved. Check its status or acknowledge the duplicate-charge risk before a new purchase.", 409, { code: "PAYMENT_PENDING" });
    // This releases only the checkout slot, NOT the order, attempt or reserved wallet funds.
    // Late success is still reconciled and fulfilled using the original purchase terms.
    await PaymentOrder.updateOne({ _id: reservedCheckout._id, shopId, checkoutActive: true }, { $set: { checkoutActive: false } });
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
  const confirmedPreview = await validatePreview(previewToken, shopId, plan, months, useWallet);
  const schedule = await getScheduleForPurchase(shopId, plan, null, new Date(), months);
  if (useWallet) {
    const session = await mongoose.startSession();
    let walletOrder;
    let repeatedWalletOrder = false;
    try {
      await session.withTransaction(async () => {
        await Shop.updateOne({ _id: shopId }, { $inc: { entitlementRevision: 1 } }, { session });
        await validatePreview(previewToken, shopId, plan, months, useWallet, session);
        const account = await WalletAccount.findOneAndUpdate(
          { shopId },
          { $setOnInsert: { shopId, balanceMinor: 0, reservedMinor: 0 } },
          { upsert: true, new: true, session },
        ).lean();
        const available = Math.max(0, (account?.balanceMinor || 0) - (account?.reservedMinor || 0));
        // Cashfree does not accept sub-rupee order values; leave at least ₹1
        // for gateway checkout unless the wallet covers the entire purchase.
        const walletAppliedMinor = available >= pricing.finalAmountMinor
          ? pricing.finalAmountMinor
          : Math.min(available, Math.max(0, pricing.finalAmountMinor - 100));
        if (walletAppliedMinor <= 0)
          throw serviceError("There is not enough wallet balance to apply. Add wallet funds or continue without wallet.", 409, { code: "WALLET_BALANCE_INSUFFICIENT" });
        const cashAmountMinor = pricing.finalAmountMinor - walletAppliedMinor;
        const purchasePricing = {
          plan: {
            id: String(plan._id), code: plan.code, tier: plan.tier, name: plan.name, description: plan.description,
            monthlyPriceMinor: plan.monthlyPriceMinor, currency: plan.currency,
            customerLimit: plan.customerLimit, unlimitedCustomers: plan.unlimitedCustomers,
            entitlements: plan.entitlements || {}, features: plan.features || [],
            configurationVersion: plan.configurationVersion || 1, pricingVersion: plan.pricingVersion || 1,
          },
          ...pricing,
          walletAppliedMinor,
          cashPayableMinor: cashAmountMinor,
          createdAt: new Date().toISOString(),
        };
        const now = new Date();
        const currentSchedule = await getScheduleForPurchase(shopId, plan, cashAmountMinor === 0 ? session : null, now, months);
        const fullWallet = cashAmountMinor === 0;
        [walletOrder] = await PaymentOrder.create([{
          shopId, userId, appMode: subscriptionConfig.appMode, planId: plan._id, planCode, durationMonths: months,
          amountMinor: cashAmountMinor, totalAmountMinor: pricing.finalAmountMinor, walletAppliedMinor,
          walletReservationStatus: fullWallet ? "captured" : "reserved", currency: pricing.currency,
          confirmedPreview, pricingSnapshot: purchasePricing, idempotencyKey, requestHash: hash, providerRequestId: randomUUID(),
          status: fullWallet ? "paid" : "created", checkoutActive: !fullWallet,
          checkoutExpiresAt: fullWallet ? undefined : new Date(Date.now() + 2 * 60 * 60 * 1000),
          scheduledStartAt: currentSchedule.status === "scheduled" ? currentSchedule.startsAt : null,
          ...(fullWallet ? { verifiedAt: now } : {}),
        }], { session });
        if (fullWallet) {
          const charged = await WalletAccount.updateOne(
            { shopId, balanceMinor: { $gte: walletAppliedMinor }, $expr: { $gte: [{ $subtract: ["$balanceMinor", "$reservedMinor"] }, walletAppliedMinor] } },
            { $inc: { balanceMinor: -walletAppliedMinor } }, { session },
          );
          if (charged.modifiedCount !== 1) throw serviceError("Wallet balance changed. Refresh and try again.", 409, { code: "WALLET_BALANCE_CHANGED" });
          await WalletLedgerEntry.create([{
            shopId, direction: "debit", amountMinor: walletAppliedMinor, reason: "subscription_purchase",
            idempotencyKey: `subscription:${walletOrder._id}`, orderId: walletOrder._id,
            description: `Subscription purchase: ${plan.name} (${months} months)`,
          }], { session });
          const expiresAt = addCalendarMonths(currentSchedule.startsAt, months);
          const status = currentSchedule.startsAt > now ? "scheduled" : "active";
          const [subscription] = await ShopSubscription.create([{
            shopId, planId: plan._id, planCode, planSnapshot: purchasePricing.plan,
            pricingSnapshot: purchasePricing, status, startsAt: currentSchedule.startsAt, expiresAt,
            durationMonths: months, renewalOf: currentSchedule.renewalOf, sourcePaymentOrderId: walletOrder._id,
            activatedAt: status === "active" ? now : undefined, amountPaidMinor: pricing.finalAmountMinor,
          }], { session });
          await SubscriptionAuditLog.create([{
            shopId, previousPlan: currentSchedule.previousPlan || null, newPlan: subscription.planSnapshot,
            eventType: status === "active" ? "subscription_activated" : "subscription_scheduled",
            referenceId: `wallet-order:${walletOrder._id}`, actorType: "shopkeeper", actorId: userId,
            occurredAt: now, metadata: { durationMonths: months, amountMinor: pricing.finalAmountMinor, walletAppliedMinor },
          }], { session });
        } else {
          const reserved = await WalletAccount.updateOne(
            { shopId, $expr: { $gte: [{ $subtract: ["$balanceMinor", "$reservedMinor"] }, walletAppliedMinor] } },
            { $inc: { reservedMinor: walletAppliedMinor } }, { session },
          );
          if (reserved.modifiedCount !== 1) throw serviceError("Wallet balance changed. Refresh and try again.", 409, { code: "WALLET_BALANCE_CHANGED" });
        }
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const existing = await PaymentOrder.findOne({ shopId, idempotencyKey, appMode: subscriptionConfig.appMode }).lean();
      if (existing?.requestHash !== hash)
        throw serviceError("Another subscription checkout is already in progress", 409);
      walletOrder = existing;
      repeatedWalletOrder = true;
    } finally { await session.endSession(); }
    const walletOrderValue = walletOrder.toObject ? walletOrder.toObject() : walletOrder;
    if (walletOrder.status === "paid")
      return { order: walletOrderValue, repeated: repeatedWalletOrder };
    return { order: await prepareCashfreeOrder(walletOrderValue), repeated: repeatedWalletOrder };
  }
  let order;
  try {
    await mongoose.connection.transaction(async session => {
    await Shop.updateOne({ _id: shopId }, { $inc: { entitlementRevision: 1 } }, { session });
    await validatePreview(previewToken, shopId, plan, months, useWallet, session);
    [order] = await PaymentOrder.create([
      {
        shopId,
        userId,
        appMode: subscriptionConfig.appMode,
        planId: plan._id,
        planCode,
        durationMonths: months,
        amountMinor: pricing.finalAmountMinor,
        totalAmountMinor: pricing.finalAmountMinor,
        currency: pricing.currency,
        pricingSnapshot: {
          plan: {
            id: String(plan._id),
            code: plan.code,
            tier: plan.tier,
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
        confirmedPreview,
        idempotencyKey,
        requestHash: hash,
        providerRequestId: randomUUID(),
        status: "created",
        checkoutActive: true,
        checkoutExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        scheduledStartAt: schedule.status === "scheduled" ? schedule.startsAt : null,
      },
    ], { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const existing = await PaymentOrder.findOne({ shopId, idempotencyKey, appMode: subscriptionConfig.appMode }).lean();
      if (existing?.requestHash === hash)
        return { order: await prepareCashfreeOrder(existing), repeated: true };
      throw serviceError("Another subscription checkout is already in progress", 409);
    }
    throw error;
  }
  return { order: await prepareCashfreeOrder(order.toObject()), repeated: false };
}

async function prepareCashfreeOrder(order) {
  await PaymentOrderRecovery.updateOne({ _id: order._id }, { $setOnInsert: {
    shopId: order.shopId, appMode: order.appMode, idempotencyKey: order.idempotencyKey, snapshot: order,
  } }, { upsert: true });
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
    : ["FAILED", "USER_DROPPED", "CANCELLED", "VOID"].includes(payment.payment_status)
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
  if (["captured", "refunded", "partially_refunded"].includes(existing?.status) && existing.verificationStatus === "verified" && existing.reviewStatus === "duplicate_order_capture") {
    const activated = await findSubscriptionForPaymentOrder(order, session);
    const activationPayment = activated?.sourcePaymentId
      ? await PaymentTransaction.findById(activated.sourcePaymentId).session(session)
      : null;
    return {
      payment: activationPayment?.toObject?.() || activationPayment || existing.toObject(),
      additionalPayment: true,
      additionalPaymentId: String(existing._id),
      repeated: true,
    };
  }
  if (["captured", "refunded", "partially_refunded"].includes(existing?.status) && existing.verificationStatus === "verified") {
    if (!await findSubscriptionForPaymentOrder(order, session))
      throw serviceError("Verified payment entitlement requires recovery review", 409, { code: "PAYMENT_ENTITLEMENT_REVIEW_REQUIRED" });
    return { payment: existing.toObject(), repeated: true };
  }
  const activatedSubscription = await findSubscriptionForPaymentOrder(order, session);
  if (activatedSubscription)
    return recordAdditionalCapturedPayment({ gatewayPayment, order, activatedSubscription, existing, session });
  if (order.walletAppliedMinor > 0 && !["reserved", "captured"].includes(order.walletReservationStatus))
    throw serviceError("Verified payment requires wallet contribution review", 409, { code: "PAYMENT_WALLET_REVIEW_REQUIRED" });
  if (order.walletReservationStatus === "reserved" && order.walletAppliedMinor > 0) {
    const captured = await WalletAccount.updateOne(
      { shopId: order.shopId, reservedMinor: { $gte: order.walletAppliedMinor }, balanceMinor: { $gte: order.walletAppliedMinor } },
      { $inc: { reservedMinor: -order.walletAppliedMinor, balanceMinor: -order.walletAppliedMinor } },
      { session },
    );
    if (captured.modifiedCount !== 1)
      throw serviceError("Reserved wallet funds could not be captured", 409, { code: "WALLET_CAPTURE_FAILED" });
    await WalletLedgerEntry.create([{
      shopId: order.shopId, direction: "debit", amountMinor: order.walletAppliedMinor,
      reason: "subscription_purchase", idempotencyKey: `subscription:${order._id}`,
      orderId: order._id, description: `Subscription purchase: ${order.pricingSnapshot.plan.name} (${order.durationMonths} months)`,
    }], { session });
    order.walletReservationStatus = "captured";
  }
  const plan = order.pricingSnapshot?.plan;
  if (!plan || plan.code !== order.planCode)
    throw serviceError("Purchased plan snapshot is unavailable", 409);
  const now = new Date();
  const schedule = await getScheduleForPurchase(order.shopId, plan, session, now, order.durationMonths);
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
    status: "captured", gatewayStatus: "SUCCESS",
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
        sourcePaymentOrderId: order._id,
        renewalOf: schedule.renewalOf,
        activatedAt: status === "active" ? now : undefined,
        amountPaidMinor: order.totalAmountMinor ?? (order.amountMinor + (order.walletAppliedMinor || 0)),
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

/** Resolve both new order-linked activations and legacy payment-linked records. */
async function findSubscriptionForPaymentOrder(order, session) {
  const directlyLinked = await ShopSubscription.findOne({ sourcePaymentOrderId: order._id }).session(session);
  if (directlyLinked) return directlyLinked;
  const paymentIds = await PaymentTransaction.distinct("_id", {
    orderId: order._id,
    status: "captured",
    verificationStatus: "verified",
  }).session(session);
  if (!paymentIds.length) return null;
  return ShopSubscription.findOne({ sourcePaymentId: { $in: paymentIds } }).session(session);
}

/** Record a verified extra capture without changing the order's activation. */
async function recordAdditionalCapturedPayment({ gatewayPayment, order, activatedSubscription, existing, session }) {
  if (!activatedSubscription.sourcePaymentId || !await PaymentTransaction.exists({ _id: activatedSubscription.sourcePaymentId, orderId: order._id, verificationStatus: "verified", status: "captured" }).session(session))
    throw serviceError("Original capture requires recovery review", 409, { code: "PAYMENT_CAPTURE_REVIEW_REQUIRED" });
  const now = new Date();
  const record = {
    shopId: order.shopId,
    orderId: order._id,
    provider: "cashfree",
    gatewayPaymentId: gatewayPayment.id,
    gatewayOrderId: gatewayPayment.order_id,
    amountMinor: gatewayPayment.amount,
    currency: gatewayPayment.currency,
    method: gatewayPayment.method,
    status: "captured", gatewayStatus: "SUCCESS",
    verificationStatus: "verified",
    reviewStatus: "duplicate_order_capture",
    reviewReason: "additional_successful_payment_for_paid_order",
    gatewayCreatedAt: gatewayPayment.created_at
      ? (typeof gatewayPayment.created_at === "number" ? new Date(gatewayPayment.created_at * 1000) : new Date(gatewayPayment.created_at))
      : undefined,
    verifiedAt: now,
  };
  let payment = existing;
  if (payment) {
    payment.set(record);
    await payment.save({ session });
  } else {
    [payment] = await PaymentTransaction.create([record], { session });
  }
  await SubscriptionAuditLog.updateOne(
    { referenceId: `payment-review:${gatewayPayment.id}` },
    { $setOnInsert: {
      shopId: order.shopId,
      previousPlan: activatedSubscription.planSnapshot || null,
      newPlan: activatedSubscription.planSnapshot || null,
      eventType: "payment_review_required",
      referenceId: `payment-review:${gatewayPayment.id}`,
      actorType: "gateway",
      occurredAt: now,
      metadata: {
        paymentOrderId: String(order._id),
        reason: "additional_successful_payment_for_paid_order",
      },
    } },
    { upsert: true, session },
  );
  const activationPayment = activatedSubscription.sourcePaymentId
    ? await PaymentTransaction.findById(activatedSubscription.sourcePaymentId).session(session)
    : null;
  return {
    payment: activationPayment?.toObject?.() || activationPayment || payment.toObject(),
    additionalPayment: true,
    additionalPaymentId: String(payment._id),
    repeated: true,
  };
}

async function recordAdditionalCaptureAfterDuplicateKey({ order, gatewayPayment }) {
  const session = await mongoose.startSession();
  try {
    let result = null;
    await session.withTransaction(async () => {
      const currentOrder = await PaymentOrder.findById(order._id).session(session);
      if (!currentOrder) return;
      const activatedSubscription = await findSubscriptionForPaymentOrder(currentOrder, session);
      if (!activatedSubscription) return;
      const existing = await PaymentTransaction.findOne({ gatewayPaymentId: gatewayPayment.id }).session(session);
      if (existing && (String(existing.shopId) !== String(currentOrder.shopId) || String(existing.orderId) !== String(currentOrder._id)))
        throw serviceError("Payment reference is already attached to another order", 409);
      result = await recordAdditionalCapturedPayment({ gatewayPayment, order: currentOrder, activatedSubscription, existing, session });
    });
    return result;
  } finally { await session.endSession(); }
}

async function releaseWalletReservation(orderId, shopId) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await PaymentOrder.findOne({ _id: orderId, shopId, appMode: subscriptionConfig.appMode }).session(session);
      if (!order || order.status === "paid") return;
      if (order.walletReservationStatus === "reserved" && order.walletAppliedMinor > 0) {
        const released = await WalletAccount.updateOne(
          { shopId, reservedMinor: { $gte: order.walletAppliedMinor } },
          { $inc: { reservedMinor: -order.walletAppliedMinor } }, { session },
        );
        if (released.modifiedCount !== 1) throw serviceError("Reserved wallet funds could not be released", 409, { code: "WALLET_RELEASE_FAILED" });
        order.walletReservationStatus = "released";
      }
      order.status = "failed";
      order.checkoutActive = false;
      await order.save({ session });
    });
  } finally { await session.endSession(); }
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
      result = await reconcilePayment({ gatewayPayment, gatewayOrder, order: current, actorId: userId || null, session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const committed = await PaymentTransaction.findOne({ shopId, gatewayPaymentId: gatewayPayment.id, orderId: order._id, status: "captured", verificationStatus: "verified" }).lean();
      const entitlement = committed && await ShopSubscription.findOne({ sourcePaymentOrderId: order._id }).lean();
      if (committed && entitlement) result = { payment: committed, repeated: true };
      else {
        result = await recordAdditionalCaptureAfterDuplicateKey({ order, gatewayPayment });
        if (!result) throw error;
      }
    } else throw error;
  } finally { await session.endSession(); }
  if (!result.additionalPayment && result.payment?.reviewStatus !== "duplicate_order_capture")
    await notifyPaymentSuccess(shopId, gatewayPayment.id);
  return { status: "paid", paymentId: String(result.payment._id), subscription: await getCurrentSubscription(shopId) };
}

// Attempt initiation time orders distinct attempts; terminal status for one attempt
// must not be downgraded by a stale concurrent PENDING response.
async function recordOrderObservation(order, gatewayOrder, payment) {
  const at = payment?.payment_time ? new Date(payment.payment_time) : null;
  await PaymentOrder.updateOne({ _id: order._id }, { $set: { paymentReconciliationCheckedAt: new Date() } });
  await PaymentOrder.updateOne({ _id: order._id, ...(gatewayOrder.order_status === "PAID" ? {} : { gatewayOrderStatus: { $ne: "PAID" } }) },
    { $set: { gatewayOrderStatus: gatewayOrder.order_status } });
  if (gatewayOrder.order_status === "ACTIVE")
    await PaymentOrder.updateOne({ _id: order._id, status: "created" }, { $set: { status: "pending" } });
  if (!payment || !at || !Number.isFinite(at.getTime())) return;
  const terminal = normalizeCashfreePayment(payment).status !== "pending";
  await PaymentOrder.updateOne({ _id: order._id, $or: [
    { latestPaymentTime: { $exists: false } },
    { latestPaymentTime: { $lt: at } },
    { latestPaymentTime: at, latestPaymentId: { $lt: String(payment.cf_payment_id) } },
    { latestPaymentTime: at, latestPaymentId: String(payment.cf_payment_id),
      ...(payment.payment_status === "SUCCESS" ? {} : terminal ? { latestPaymentStatus: { $ne: "SUCCESS" } } : { latestPaymentStatus: { $in: ["PENDING", "NOT_ATTEMPTED"] } }) },
  ] }, { $set: { latestPaymentId: String(payment.cf_payment_id),
    latestPaymentStatus: payment.payment_status, latestPaymentTime: at } }, { collation: { locale: "en", numericOrdering: true } });
}

async function recordObservedAttempt(order, payment) {
  const normalized = normalizeCashfreePayment(payment);
  if (normalized.order_id !== order.gatewayOrderId || normalized.amount !== order.amountMinor || normalized.currency !== order.currency)
    throw serviceError("Payment identity or amount does not match", 409);
  if (normalized.status === "captured") return; // Only transactional fulfilment records success.
  const existing = await PaymentTransaction.findOne({ gatewayPaymentId: normalized.id }).lean();
  if (existing && (String(existing.shopId) !== String(order.shopId) || String(existing.orderId) !== String(order._id)))
    throw serviceError("Payment reference is already attached to another order", 409);
  if (["captured", "refunded", "partially_refunded"].includes(existing?.status) || (existing?.status === "failed" && normalized.status === "pending")) return;
  const record = { shopId: order.shopId, orderId: order._id, provider: "cashfree",
    gatewayPaymentId: normalized.id, gatewayOrderId: order.gatewayOrderId,
    amountMinor: normalized.amount, currency: normalized.currency, method: normalized.method,
    status: normalized.status, gatewayStatus: normalized.gatewayStatus, verificationStatus: "verified", verifiedAt: new Date(),
    gatewayCreatedAt: normalized.created_at ? new Date(normalized.created_at) : undefined };
  // Conditional update prevents a concurrent success from being downgraded.
  if (existing) await PaymentTransaction.updateOne({ _id: existing._id, status: { $nin: normalized.status === "pending" ? ["captured", "refunded", "partially_refunded", "failed"] : ["captured", "refunded", "partially_refunded"] } }, { $set: record });
  else {
    try { await PaymentTransaction.create(record); }
    catch (error) {
      if (error.code !== 11000) throw error;
      // Re-read the concurrent insert and apply the same ownership/monotonic guards.
      if (!await PaymentTransaction.exists({ gatewayPaymentId: normalized.id })) throw error;
      return recordObservedAttempt(order, payment);
    }
  }
}

async function recoverMissingOrder(shopId, orderId) {
  const recovery = await PaymentOrderRecovery.findOne({ _id: orderId, shopId, appMode: subscriptionConfig.appMode }).lean();
  if (recovery) {
    const snapshot = recovery.snapshot;
    if (!await Shop.exists({ _id: shopId }))
      throw serviceError("Recovery shop is unavailable", 409, { code: "PAYMENT_RECOVERY_REVIEW_REQUIRED" });
    const fulfilled = await ShopSubscription.exists({ shopId, sourcePaymentOrderId: orderId });
    if (snapshot.walletAppliedMinor > 0 && !fulfilled)
      throw serviceError("Missing wallet-assisted order requires financial review", 409, { code: "PAYMENT_RECOVERY_REVIEW_REQUIRED" });
    // A retained server snapshot supplies immutable price/plan/ownership evidence.
    await PaymentOrder.updateOne({ _id: orderId }, { $setOnInsert: { ...snapshot, checkoutActive: false,
      gatewayOrderId: snapshot.gatewayOrderId || `dk_${orderId}`,
      ...(fulfilled ? { status: "paid", walletReservationStatus: snapshot.walletAppliedMinor ? "captured" : "none" } : {}) } }, { upsert: true, timestamps: false });
    return PaymentOrder.findOne({ _id: orderId, shopId, appMode: subscriptionConfig.appMode }).lean();
  }
  // Legacy deleted orders: inspect Cashfree, but never invent purchase terms from a mobile reference.
  const provider = paymentProvider({ forVerification: true });
  const gatewayId = `dk_${orderId}`;
  const gateway = await provider.fetchOrder(gatewayId);
  if (gateway.order_id !== gatewayId || gateway.customer_details?.customer_id !== `shop_${String(shopId).replaceAll("-", "")}`)
    throw serviceError("Payment order not found", 404);
  const payments = await provider.fetchOrderPayments(gatewayId);
  for (const payment of payments) await recordObservedAttempt({ _id: orderId, shopId, gatewayOrderId: gatewayId,
    amountMinor: cashfreeAmountMinor(gateway.order_amount), currency: gateway.order_currency }, payment);
  const latest = [...payments].sort((a,b) => (Date.parse(b.payment_time || "") || 0) - (Date.parse(a.payment_time || "") || 0) || String(b.cf_payment_id).localeCompare(String(a.cf_payment_id), undefined, { numeric: true }))[0];
  const failed = latest && ["FAILED", "USER_DROPPED", "CANCELLED"].includes(latest.payment_status);
  return { missing: true, id: orderId, gatewayOrderId: gatewayId, orderStatus: gateway.order_status,
    status: gateway.order_status !== "PAID" && failed ? "failed" : "pending",
    latestPaymentStatus: latest?.payment_status,
    latestPaymentId: latest ? String(latest.cf_payment_id) : undefined,
    hasPendingAttempts: payments.some(p => !["FAILED", "USER_DROPPED", "CANCELLED"].includes(p.payment_status)),
    requiresReview: true, retryAllowed: true };
}

async function inspectCashfreeOrder(order, userId = null) {
  await PaymentOrderRecovery.updateOne({ _id: order._id }, { $setOnInsert: {
    shopId: order.shopId, appMode: order.appMode, idempotencyKey: order.idempotencyKey, snapshot: order,
  } }, { upsert: true });
  if (!order.gatewayOrderId) return { id: String(order._id), status: "pending", amountMinor: order.amountMinor, totalAmountMinor: order.totalAmountMinor ?? order.amountMinor, walletAppliedMinor: order.walletAppliedMinor || 0, currency: order.currency };
  const provider = paymentProvider({ forVerification: true });
  const [gatewayOrder, payments] = await Promise.all([
    provider.fetchOrder(order.gatewayOrderId),
    provider.fetchOrderPayments(order.gatewayOrderId),
  ]);
  if (gatewayOrder.order_id !== order.gatewayOrderId ||
      cashfreeAmountMinor(gatewayOrder.order_amount) !== order.amountMinor ||
      gatewayOrder.order_currency !== order.currency)
    throw serviceError("Payment order identity or amount does not match; verification remains unresolved", 409);
  for (const payment of payments) await recordObservedAttempt(order, payment);
  const latest = [...payments].sort((a,b) => (Date.parse(b.payment_time || "") || 0) - (Date.parse(a.payment_time || "") || 0) || String(b.cf_payment_id).localeCompare(String(a.cf_payment_id), undefined, { numeric: true }))[0];
  const latestStatus = latest ? normalizeCashfreePayment(latest).status : "pending";
  await recordOrderObservation(order, gatewayOrder, latest);
  const successful = payments.find((payment) => payment.payment_status === "SUCCESS");
  if (gatewayOrder.order_status === "PAID" && successful) {
    let result;
    for (const payment of payments.filter(item => item.payment_status === "SUCCESS")) {
      const verified = await activateVerifiedPayment({ shopId: order.shopId, userId, order, gatewayOrder, payment });
      result ||= verified;
    }
    return { id: String(order._id), status: "paid", amountMinor: order.amountMinor, totalAmountMinor: order.totalAmountMinor ?? order.amountMinor, walletAppliedMinor: order.walletAppliedMinor || 0, currency: order.currency, paymentId: result.paymentId, subscription: result.subscription };
  }
  if (["EXPIRED", "TERMINATED"].includes(gatewayOrder.order_status) && !successful && !payments.some(p => normalizeCashfreePayment(p).status === "pending") && order.status !== "paid") {
    await releaseWalletReservation(order._id, order.shopId);
    // A verified webhook may have committed while the provider lookup ran.
    // Never overwrite that successful outcome with this stale inspection.
    const finalized = await PaymentOrder.findById(order._id).select('status').lean();
    order.status = finalized?.status || "pending";
  }
  const committedOrder = await PaymentOrder.findById(order._id).select("status").lean();
  if (committedOrder?.status === "paid") order.status = "paid";
  return {
    id: String(order._id),
    status: order.status === "paid" ? "paid" : latestStatus === "failed" && !successful && gatewayOrder.order_status !== "PAID" ? "failed" : order.status === "failed" ? "failed" : "pending",
    orderStatus: gatewayOrder.order_status,
    attemptStatus: latestStatus,
    latestPaymentStatus: latest?.payment_status,
    latestPaymentId: latest ? String(latest.cf_payment_id) : undefined,
    hasPendingAttempts: order.status !== "paid" && payments.some(p => normalizeCashfreePayment(p).status === "pending"),
    retryAllowed: true,
    amountMinor: order.amountMinor,
    totalAmountMinor: order.totalAmountMinor ?? order.amountMinor,
    walletAppliedMinor: order.walletAppliedMinor || 0,
    currency: order.currency,
    gatewayOrderId: order.gatewayOrderId,
  };
}

export async function verifyPayment({ shopId, userId, orderId }) {
  let order = await PaymentOrder.findOne({ _id: orderId, shopId, appMode: subscriptionConfig.appMode }).lean();
  if (!order) order = await recoverMissingOrder(shopId, orderId);
  if (order.missing) return order;
  if (order.status === "paid" && order.amountMinor === 0 && !order.gatewayOrderId) {
    const payment = await PaymentTransaction.findOne({ orderId: order._id, status: "captured", verificationStatus: "verified" }).lean();
    return { status: "paid", paymentId: payment ? String(payment._id) : null, subscription: await getCurrentSubscription(shopId) };
  }
  return inspectCashfreeOrder(order, userId);
}

export async function getPaymentOrderStatus({ shopId, orderId }) {
  let order = await PaymentOrder.findOne({ _id: orderId, shopId, appMode: subscriptionConfig.appMode }).lean();
  if (!order) order = await recoverMissingOrder(shopId, orderId);
  if (order.missing) return order;
  if (order.status === "paid" && order.amountMinor === 0 && !order.gatewayOrderId) {
    const payment = await PaymentTransaction.findOne({ orderId: order._id, status: "captured", verificationStatus: "verified" }).lean();
    return { id: String(order._id), status: "paid", amountMinor: order.amountMinor, totalAmountMinor: order.totalAmountMinor ?? order.amountMinor, walletAppliedMinor: order.walletAppliedMinor || 0, currency: order.currency, paymentId: payment ? String(payment._id) : null };
  }
  return inspectCashfreeOrder(order);
}

export async function getPaymentAttemptStatus({ shopId, idempotencyKey }) {
  const order = await PaymentOrder.findOne({ shopId, idempotencyKey, appMode: subscriptionConfig.appMode }).select("_id").lean();
  if (!order) {
    const recovery = await PaymentOrderRecovery.findOne({ shopId, idempotencyKey, appMode: subscriptionConfig.appMode }).lean();
    if (recovery) return getPaymentOrderStatus({ shopId, orderId: String(recovery._id) });
    throw serviceError("Payment attempt not found", 404);
  }
  return getPaymentOrderStatus({ shopId, orderId: String(order._id) });
}

const paymentReconciliationBackoffMinutes = [1, 5, 15];
const reconciliationLeaseMs = 15 * 60_000;

/** Durable polling: pending results never exhaust a retry budget or age out. */
export async function reconcilePendingCashfreePayments({ limit = 20, now = new Date() } = {}) {
  const boundedLimit = Math.min(50, Math.max(1, Number.isSafeInteger(limit) ? limit : 20));
  const result = { scanned: 0, attempted: 0, paid: 0, pending: 0, failed: 0, skipped: 0, recovered: 0, recoveryFailed: 0 };
  // Deleted orders cannot appear in the primary query. Only trusted server purchase
  // snapshots may recover them; never infer terms from provider/client metadata.
  const missing = await PaymentOrderRecovery.aggregate([
    { $match: { appMode: subscriptionConfig.appMode, $or: [
      { reconciliationNextAt: { $exists: false } }, { reconciliationNextAt: { $lte: now } },
    ] } },
    { $lookup: { from: PaymentOrder.collection.name, localField: "_id", foreignField: "_id", as: "order" } },
    { $match: { order: { $size: 0 } } }, { $sort: { reconciliationNextAt: 1, _id: 1 } }, { $limit: boundedLimit },
  ]);
  for (const recovery of missing) {
    try { await recoverMissingOrder(recovery.shopId, recovery._id); result.recovered += 1; }
    catch (error) {
      result.recoveryFailed += 1;
      await PaymentOrderRecovery.updateOne({ _id: recovery._id }, { $set: {
        reconciliationNextAt: new Date(now.getTime() + reconciliationLeaseMs),
        reconciliationLastCode: "PAYMENT_RECOVERY_REVIEW_REQUIRED",
      } });
      log.warn({ orderId: String(recovery._id), code: error.code || "PAYMENT_RECOVERY_FAILED" }, "Payment recovery requires review");
    }
  }
  const candidates = await PaymentOrder.aggregate([{ $match: {
    appMode: subscriptionConfig.appMode, amountMinor: { $gt: 0 }, status: { $in: ["created", "pending", "paid", "failed"] },
    $or: [
      { paymentReconciliationNextAt: { $exists: false } },
      { paymentReconciliationNextAt: null },
      { paymentReconciliationNextAt: { $lte: now } },
      // Recover legacy long delays without overriding active leases or a
      // provider-requested Retry-After cooldown.
      { status: { $in: ["created", "pending"] },
        paymentReconciliationLeaseToken: { $exists: false },
        paymentReconciliationLastCode: { $ne: "CASHFREE_RATE_LIMITED" },
        updatedAt: { $lte: new Date(now.getTime() - reconciliationLeaseMs) } },

    ],
  } }, { $sort: { paymentReconciliationNextAt: 1, createdAt: 1, _id: 1 } },
    { $limit: boundedLimit },
  ]);
  result.scanned = candidates.length;
  for (const candidate of candidates) {
    const leaseToken = randomUUID();
    const claim = await PaymentOrder.findOneAndUpdate({
      _id: candidate._id, status: candidate.status, updatedAt: candidate.updatedAt,
      paymentReconciliationAttempts: candidate.paymentReconciliationAttempts ?? { $exists: false },
    }, { $inc: { paymentReconciliationAttempts: 1 }, $set: {
      paymentReconciliationLeaseToken: leaseToken,
      paymentReconciliationAttemptedAt: now,
      paymentReconciliationNextAt: new Date(now.getTime() + reconciliationLeaseMs),
    } }, { new: true }).lean();
    if (!claim) { result.skipped += 1; continue; }
    result.attempted += 1;
    try {
      // The provider order ID is deterministic, including creation interrupted
      // between the provider response and the local persistence step.
      if (!claim.gatewayOrderId) {
        claim.gatewayOrderId = `dk_${claim._id}`;
        await PaymentOrder.updateOne({ _id: claim._id, paymentReconciliationLeaseToken: leaseToken }, { $set: { gatewayOrderId: claim.gatewayOrderId } });
      }
      const status = await inspectCashfreeOrder(claim);
      if (status.status === "paid") result.paid += 1;
      else if (status.status === "failed") result.failed += 1;
      else result.pending += 1;
      const pendingAttempt = await PaymentTransaction.exists({ orderId: claim._id, status: "pending" });
      const nextCheckMs = ["paid", "failed"].includes(claim.status) && !pendingAttempt ? 24 * 3600_000 : 5 * 60_000;
      await PaymentOrder.updateOne({ _id: claim._id, paymentReconciliationLeaseToken: leaseToken }, {
        $unset: { paymentReconciliationLastCode: 1, paymentReconciliationLeaseToken: 1 },
        $set: { paymentReconciliationNextAt: new Date(now.getTime() + nextCheckMs) },
      });
    } catch (error) {
      const code = typeof error?.code === "string" && /^[A-Z0-9_-]{1,40}$/i.test(error.code)
        ? error.code : "PAYMENT_RECONCILIATION_FAILED";
      const delay = paymentReconciliationBackoffMinutes[Math.min(claim.paymentReconciliationAttempts - 1, 2)];
      await PaymentOrder.updateOne({ _id: claim._id, paymentReconciliationLeaseToken: leaseToken }, { $unset: { paymentReconciliationLeaseToken: 1 }, $set: {
        paymentReconciliationLastCode: code,
        paymentReconciliationNextAt: new Date(now.getTime() + Math.max(delay * 60_000, Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : 0)),
      } });
      log.warn({ orderId: String(claim._id), code }, "Cashfree order reconciliation failed; retry scheduled");
      result.failed += 1;
    }
  }
  return result;
}

export async function processPaymentWebhook({ eventId, eventType, orderId, paymentId }) {
  let order = await PaymentOrder.findOne({ gatewayOrderId: orderId, appMode: subscriptionConfig.appMode }).lean();
  if (!order && /^dk_[a-f0-9]{24}$/i.test(orderId)) {
    const recovery = await PaymentOrderRecovery.findOne({ _id: orderId.slice(3), appMode: subscriptionConfig.appMode }).lean();
    if (recovery) order = await recoverMissingOrder(recovery.shopId, orderId.slice(3));
  }
  if (!order) throw serviceError("Payment order requires recovery review", 503, { code: "PAYMENT_RECOVERY_REVIEW_REQUIRED" });
  const paymentEvent = await mongoose.model("PaymentWebhookEvent").findOne({ eventId }).lean();
  if (paymentEvent?.status === "processed") return { duplicate: true };
  const provider = paymentProvider({ forVerification: true });
  const [gatewayOrder, remotePayment] = await Promise.all([
    provider.fetchOrder(order.gatewayOrderId),
    provider.fetchPayment({ orderId: order.gatewayOrderId, paymentId }),
  ]);
  const normalized = normalizeCashfreePayment(remotePayment);
  if (gatewayOrder.order_id !== order.gatewayOrderId || cashfreeAmountMinor(gatewayOrder.order_amount) !== order.amountMinor || gatewayOrder.order_currency !== order.currency || normalized.amount !== order.amountMinor || normalized.currency !== order.currency || normalized.order_id !== order.gatewayOrderId)
    throw serviceError("Webhook payment does not match the order", 409);
  const successEvent = eventType === "PAYMENT_SUCCESS_WEBHOOK" || (normalized.status === "captured" && gatewayOrder.order_status === "PAID");
  const failureEvent = !successEvent && ["PAYMENT_FAILED_WEBHOOK", "PAYMENT_USER_DROPPED_WEBHOOK"].includes(eventType);
  if (!successEvent && !failureEvent) return { ignored: true };
  if (successEvent && (normalized.status !== "captured" || gatewayOrder.order_status !== "PAID"))
    throw serviceError("Cashfree payment is not yet verifiably paid", 503);
  if (failureEvent && normalized.status !== "failed")
    throw serviceError("Cashfree attempt status is not yet final", 503, { code: "PAYMENT_WEBHOOK_RETRY_REQUIRED" });

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
        if (!["captured", "refunded", "partially_refunded"].includes(existing?.status)) {
          const record = {
            shopId: currentOrder.shopId,
            orderId: currentOrder._id,
            provider: "cashfree",
            gatewayPaymentId: normalized.id,
            gatewayOrderId: normalized.order_id,
            amountMinor: normalized.amount ?? currentOrder.amountMinor,
            currency: normalized.currency || currentOrder.currency,
            method: normalized.method,
            status: "failed", gatewayStatus: normalized.gatewayStatus,
            verificationStatus: "verified",
            gatewayCreatedAt: normalized.created_at ? new Date(normalized.created_at) : undefined,
            verifiedAt: new Date(),
          };
          if (existing) { existing.set(record); await existing.save({ session }); }
          else await PaymentTransaction.create([record], { session });
          await SubscriptionAuditLog.updateOne({ referenceId: `payment-failed:${normalized.id}`, eventType: "payment_failed" }, { $setOnInsert: {
            shopId: currentOrder.shopId,
            previousPlan: null,
            newPlan: null,
            eventType: "payment_failed",
            referenceId: `payment-failed:${normalized.id}`,
            actorType: "gateway",
            occurredAt: new Date(),
            metadata: { paymentOrderId: String(currentOrder._id) },
          } }, { upsert: true, session });
        }
        result = { failed: currentOrder.status !== "paid" };
      }
      await WebhookEvent.updateOne({ eventId }, { $set: { status: "processed", processedAt: new Date() } }, { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const duplicateEvent = await mongoose.model("PaymentWebhookEvent").findOne({ eventId }).lean();
      // A transaction row (even captured) is not proof that this event committed.
      // Keep the durable event retryable after unrelated unique-index conflicts.
      if (duplicateEvent?.status === "processed") return { duplicate: true };
    }
    throw error;
  } finally { await session.endSession(); }
  if (successEvent && result?.payment && !result.additionalPayment) await notifyPaymentSuccess(order.shopId, normalized.id);
  await recordOrderObservation(order, gatewayOrder, remotePayment);
  if (failureEvent && result?.failed) await notifyPaymentFailure(order.shopId, normalized.id);
  return result;
}
