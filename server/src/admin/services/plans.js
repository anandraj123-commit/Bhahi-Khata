import mongoose from "mongoose";
import { SubscriptionPlan } from "../../models.js";
import { calculateDurationPricing, SUPPORTED_SUBSCRIPTION_DURATIONS } from "../../services/subscriptionPricing.js";
import { fail } from "../utils/security.js";
import { audit } from "./audit.js";

const planProjection =
  "_id code name description features monthlyPriceMinor currency customerLimit unlimitedCustomers entitlements enabled displayOrder configurationVersion pricingVersion durations createdByAdminId updatedByAdminId createdAt updatedAt";

function outputPlan(plan) {
  return {
    ...plan,
    id: String(plan._id),
    pricingVersion: plan.pricingVersion || 1,
    features: plan.features || [],
    durations: (plan.durations || []).map((duration) => ({
      ...calculateDurationPricing({
        months: duration.months,
        basePriceMinor: duration.basePriceMinor ?? plan.monthlyPriceMinor * duration.months,
        discountPercent: duration.discountPercent ?? 0,
        taxPercent: duration.taxPercent ?? 0,
        isActive: duration.isActive !== false,
        pricingVersion: plan.pricingVersion || 1,
      }),
    })),
  };
}

export async function listPlans() {
  const plans = await SubscriptionPlan.find({ code: { $in: ["free", "pro", "business"] } })
    .select(planProjection)
    .sort({ displayOrder: 1, _id: 1 })
    .maxTimeMS(5000)
    .lean();
  return plans.map(outputPlan);
}

function pricingState(plan) {
  return {
    enabled: plan.enabled,
    durations: (plan.durations || []).map(({ months, basePriceMinor, discountPercent, taxPercent, isActive }) => ({
      months, basePriceMinor, discountPercent, taxPercent, isActive,
    })),
  };
}

function planAuditView(plan) {
  return {
    name: plan.name,
    description: plan.description,
    customerLimit: plan.unlimitedCustomers ? "unlimited" : plan.customerLimit,
    unlimitedCustomers: Boolean(plan.unlimitedCustomers),
    enabled: plan.enabled,
    features: plan.features || [],
    entitlements: plan.entitlements || {},
    durations: pricingState(plan).durations,
  };
}

export async function updatePlanConfiguration(req, planId, input) {
  let result;
  await mongoose.connection.transaction(async (session) => {
    const previous = await SubscriptionPlan.findById(planId)
      .select(planProjection)
      .session(session)
      .lean();
    if (!previous || !["free", "pro", "business"].includes(previous.code))
      throw fail(404, "ADMIN_PLAN_NOT_FOUND", "Canonical subscription plan not found");
    const version = Number.isSafeInteger(previous.configurationVersion) ? previous.configurationVersion : 1;
    if (version !== input.expectedVersion)
      throw fail(409, "ADMIN_PLAN_CHANGED", "This plan changed since it was loaded. Refresh and try again.");
    if (previous.code === "free" && input.enabled !== true)
      throw fail(400, "ADMIN_FREE_PLAN_REQUIRED", "The Free plan must remain enabled as the fallback.");
    if (previous.code === "free" && input.durations.length !== 0)
      throw fail(400, "ADMIN_FREE_PLAN_NO_CHECKOUT", "The Free plan cannot have paid billing durations.");
    if (previous.code !== "free" && (
      input.durations.length !== SUPPORTED_SUBSCRIPTION_DURATIONS.length ||
      !SUPPORTED_SUBSCRIPTION_DURATIONS.every((months) => input.durations.some((duration) => duration.months === months))
    ))
      throw fail(400, "ADMIN_PLAN_DURATIONS_REQUIRED", "Paid plans require one configuration for each supported duration.");
    let durations = input.durations;
    try {
      durations = input.durations.map((duration) => {
        calculateDurationPricing(duration);
        return {
          months: duration.months,
          basePriceMinor: duration.basePriceMinor,
          discountPercent: duration.discountPercent,
          taxPercent: duration.taxPercent,
          isActive: duration.isActive,
        };
      });
    } catch (error) {
      throw fail(400, error.code || "ADMIN_PLAN_PRICING_INVALID", error.message);
    }
    const nextValues = {
      name: input.name,
      description: input.description,
      customerLimit: input.unlimitedCustomers ? null : input.customerLimit,
      unlimitedCustomers: input.unlimitedCustomers,
      features: input.features,
      entitlements: input.entitlements,
      enabled: input.enabled,
      displayOrder: input.displayOrder,
      durations,
      ...(previous.code === "free" ? { monthlyPriceMinor: 0 } : {
        monthlyPriceMinor: durations.find((duration) => duration.months === 1).basePriceMinor,
      }),
      currency: "INR",
      updatedByAdminId: req.admin._id,
      ...(previous.createdByAdminId ? {} : { createdByAdminId: req.admin._id }),
    };
    const pricingChanged = JSON.stringify(pricingState(previous)) !== JSON.stringify(pricingState(nextValues));
    const versionFilter = Number.isSafeInteger(previous.configurationVersion)
      ? { configurationVersion: version }
      : { configurationVersion: { $exists: false } };
    const updated = await SubscriptionPlan.findOneAndUpdate(
      { _id: previous._id, ...versionFilter },
      {
        $set: nextValues,
        $inc: {
          configurationVersion: 1,
          ...(pricingChanged ? { pricingVersion: 1 } : {}),
        },
      },
      { new: true, runValidators: true, session },
    ).select(planProjection).lean();
    if (!updated)
      throw fail(409, "ADMIN_PLAN_CHANGED", "This plan changed since it was loaded. Refresh and try again.");
    await audit(
      req,
      "plan.configuration.update",
      "subscription_plan",
      previous._id,
      {
        planCode: previous.code,
        previousValues: JSON.stringify(planAuditView(previous)),
        updatedValues: JSON.stringify(planAuditView(updated)),
        configurationVersion: String(updated.configurationVersion),
        pricingVersion: String(updated.pricingVersion),
      },
      session,
    );
    result = outputPlan(updated);
  });
  return result;
}

export async function updatePlanCustomerLimit(req, planId, input) {
  let result;
  await mongoose.connection.transaction(async (session) => {
    const previous = await SubscriptionPlan.findById(planId)
      .select(planProjection)
      .session(session)
      .lean();
    if (!previous)
      throw fail(404, "ADMIN_PLAN_NOT_FOUND", "Subscription plan not found");

    const version = Number.isSafeInteger(previous.configurationVersion)
      ? previous.configurationVersion
      : 1;
    if (version !== input.expectedVersion)
      throw fail(
        409,
        "ADMIN_PLAN_CHANGED",
        "This plan changed since it was loaded. Refresh and try again.",
      );

    const updated = await SubscriptionPlan.findOneAndUpdate(
      {
        _id: planId,
        $or: [
          { configurationVersion: version },
          ...(version === 1 ? [{ configurationVersion: { $exists: false } }] : []),
        ],
      },
      {
        $set: {
          customerLimit: input.unlimitedCustomers ? null : input.customerLimit,
          unlimitedCustomers: input.unlimitedCustomers,
        },
        $inc: { configurationVersion: 1 },
      },
      { new: true, runValidators: true, session },
    )
      .select(planProjection)
      .lean();
    if (!updated)
      throw fail(
        409,
        "ADMIN_PLAN_CHANGED",
        "This plan changed since it was loaded. Refresh and try again.",
      );

    await audit(
      req,
      "plan.customer_limit.update",
      "subscription_plan",
      previous._id,
      {
        planCode: previous.code,
        planName: previous.name,
        previousLimit: previous.unlimitedCustomers
          ? "unlimited"
          : String(previous.customerLimit),
        newLimit: updated.unlimitedCustomers
          ? "unlimited"
          : String(updated.customerLimit),
        previousUnlimited: String(Boolean(previous.unlimitedCustomers)),
        newUnlimited: String(updated.unlimitedCustomers),
        configurationVersion: String(updated.configurationVersion),
      },
      session,
    );
    result = updated;
  });
  return result;
}
