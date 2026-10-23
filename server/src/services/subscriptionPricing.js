export const SUPPORTED_SUBSCRIPTION_DURATIONS = Object.freeze([1, 3, 6, 12]);

export function percentToBasisPoints(value, label = "Percentage") {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100)
    throw Object.assign(new Error(`${label} must be between 0 and 100`), { status: 400, code: "INVALID_PRICING_PERCENT" });
  const basisPoints = Math.round(value * 100);
  if (Math.abs(value * 100 - basisPoints) > 1e-8)
    throw Object.assign(new Error(`${label} supports at most two decimal places`), { status: 400, code: "INVALID_PRICING_PERCENT" });
  return basisPoints;
}

function roundedPaise(amountMinor, basisPoints) {
  return Number((BigInt(amountMinor) * BigInt(basisPoints) + 5000n) / 10000n);
}

export function calculateDurationPricing({
  basePriceMinor,
  discountPercent = 0,
  taxPercent = 0,
  months,
  isActive = true,
  pricingVersion = 1,
}) {
  if (!Number.isSafeInteger(basePriceMinor) || basePriceMinor <= 0)
    throw Object.assign(new Error("Base price must be a positive whole number of paise"), { status: 400, code: "INVALID_BASE_PRICE" });
  if (!SUPPORTED_SUBSCRIPTION_DURATIONS.includes(months))
    throw Object.assign(new Error("Unsupported billing duration"), { status: 400, code: "INVALID_DURATION" });
  if (typeof isActive !== "boolean")
    throw Object.assign(new Error("Duration active status is invalid"), { status: 400, code: "INVALID_DURATION_STATUS" });
  const discountBps = percentToBasisPoints(discountPercent, "Discount");
  const taxBps = percentToBasisPoints(taxPercent, "Tax");
  const discountAmountMinor = roundedPaise(basePriceMinor, discountBps);
  const taxableAmountMinor = basePriceMinor - discountAmountMinor;
  const taxAmountMinor = roundedPaise(taxableAmountMinor, taxBps);
  const finalAmountMinor = taxableAmountMinor + taxAmountMinor;
  if (!Number.isSafeInteger(finalAmountMinor) || finalAmountMinor < 100)
    throw Object.assign(new Error("A paid billing duration must have a final payable amount of at least ₹1"), { status: 400, code: "INVALID_FINAL_PRICE" });
  return {
    months,
    durationMonths: months,
    basePriceMinor,
    discountPercent,
    discountAmountMinor,
    taxableAmountMinor,
    taxPercent,
    taxRateBps: taxBps,
    taxAmountMinor,
    finalAmountMinor,
    currency: "INR",
    isActive,
    pricingVersion,
  };
}

export function normalizePaidPlanDurations(plan, legacyTaxPercent = 0) {
  const configured = Array.isArray(plan.durations) ? plan.durations : [];
  for (const duration of configured) {
    if (!SUPPORTED_SUBSCRIPTION_DURATIONS.includes(duration.months))
      throw Object.assign(new Error(`Plan ${plan.code} contains an unsupported duration`), { code: "SUBSCRIPTION_PLAN_MIGRATION_REQUIRED" });
    if (configured.filter((item) => item.months === duration.months).length > 1)
      throw Object.assign(new Error(`Plan ${plan.code} contains duplicate durations`), { code: "SUBSCRIPTION_PLAN_MIGRATION_REQUIRED" });
  }
  const byMonth = new Map(configured.map((duration) => [duration.months, duration]));
  const result = SUPPORTED_SUBSCRIPTION_DURATIONS.map((months) => {
    const previous = byMonth.get(months);
    const basePriceMinor = previous?.basePriceMinor ?? plan.monthlyPriceMinor * months;
    const discountPercent = previous?.discountPercent ?? 0;
    const taxPercent = previous?.taxPercent ?? legacyTaxPercent;
    const isActive = previous?.isActive ?? true;
    calculateDurationPricing({ basePriceMinor, discountPercent, taxPercent, months, isActive });
    return { months, basePriceMinor, discountPercent, taxPercent, isActive };
  });
  return result;
}
