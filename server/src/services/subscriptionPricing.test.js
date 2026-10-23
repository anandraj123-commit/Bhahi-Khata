import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateDurationPricing,
  normalizePaidPlanDurations,
  percentToBasisPoints,
  SUPPORTED_SUBSCRIPTION_DURATIONS,
} from "./subscriptionPricing.js";

test("three paid tiers use the four canonical month durations", () => {
  assert.deepEqual(SUPPORTED_SUBSCRIPTION_DURATIONS, [1, 3, 6, 12]);
});

test("zero tax and discount produce the configured base amount", () => {
  const quote = calculateDurationPricing({
    months: 1,
    basePriceMinor: 19900,
    discountPercent: 0,
    taxPercent: 0,
  });
  assert.equal(quote.discountAmountMinor, 0);
  assert.equal(quote.taxableAmountMinor, 19900);
  assert.equal(quote.taxAmountMinor, 0);
  assert.equal(quote.finalAmountMinor, 19900);
});

test("discount then tax follows the documented order and rounds half up to one paise", () => {
  const quote = calculateDurationPricing({
    months: 6,
    basePriceMinor: 120000,
    discountPercent: 20,
    taxPercent: 5,
  });
  assert.equal(quote.discountAmountMinor, 24000);
  assert.equal(quote.taxableAmountMinor, 96000);
  assert.equal(quote.taxAmountMinor, 4800);
  assert.equal(quote.finalAmountMinor, 100800);
  assert.equal(quote.finalAmountMinor / 100, 1008);

  const halfPaise = calculateDurationPricing({
    months: 1,
    basePriceMinor: 100,
    discountPercent: 0,
    taxPercent: 0.5,
  });
  assert.equal(halfPaise.taxAmountMinor, 1);
});

test("duration prices and rates are independent and inactive durations remain non-purchasable", () => {
  const plan = {
    code: "pro",
    monthlyPriceMinor: 10000,
    durations: [
      { months: 1, basePriceMinor: 10000, discountPercent: 0, taxPercent: 0, isActive: true },
      { months: 3, basePriceMinor: 27000, discountPercent: 10, taxPercent: 5, isActive: true },
      { months: 6, basePriceMinor: 50000, discountPercent: 15, taxPercent: 12, isActive: false },
      { months: 12, basePriceMinor: 90000, discountPercent: 25, taxPercent: 18, isActive: true },
    ],
  };
  const monthly = calculateDurationPricing(plan.durations[0]);
  const quarterly = calculateDurationPricing(plan.durations[1]);
  const yearly = calculateDurationPricing(plan.durations[3]);
  assert.notEqual(monthly.finalAmountMinor, quarterly.finalAmountMinor);
  assert.notEqual(quarterly.taxPercent, yearly.taxPercent);
  assert.equal(plan.durations[2].isActive, false);
});

test("100 percent discount is rejected instead of creating a zero-value Cashfree order", () => {
  assert.throws(
    () => calculateDurationPricing({ months: 1, basePriceMinor: 10000, discountPercent: 100, taxPercent: 18 }),
    (error) => error.code === "INVALID_FINAL_PRICE",
  );
});

test("invalid paise, percentages, precision and durations are rejected", () => {
  for (const basePriceMinor of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => calculateDurationPricing({ months: 1, basePriceMinor }));
  for (const discountPercent of [-1, 100.01, 10.125, NaN])
    assert.throws(() => calculateDurationPricing({ months: 1, basePriceMinor: 10000, discountPercent }));
  for (const taxPercent of [-1, 100.01, 5.555, Infinity])
    assert.throws(() => calculateDurationPricing({ months: 1, basePriceMinor: 10000, taxPercent }));
  assert.throws(() => calculateDurationPricing({ months: 2, basePriceMinor: 10000 }));
  assert.throws(() => percentToBasisPoints(1.001));
});

test("legacy duration migration preserves configured discount and tax, fills new values at zero", () => {
  const plan = {
    code: "pro",
    monthlyPriceMinor: 19900,
    durations: [
      { months: 1, discountPercent: 5, taxPercent: 0, isActive: true },
      { months: 3, discountPercent: 10, taxPercent: 7.5, isActive: false },
    ],
  };
  const migrated = normalizePaidPlanDurations(plan, 0);
  assert.equal(migrated.length, 4);
  assert.deepEqual(migrated[0], { months: 1, basePriceMinor: 19900, discountPercent: 5, taxPercent: 0, isActive: true });
  assert.deepEqual(migrated[1], { months: 3, basePriceMinor: 59700, discountPercent: 10, taxPercent: 7.5, isActive: false });
  assert.deepEqual(migrated[2], { months: 6, basePriceMinor: 119400, discountPercent: 0, taxPercent: 0, isActive: true });
});

test("legacy duplicate and unsupported durations require explicit correction", () => {
  assert.throws(() => normalizePaidPlanDurations({
    code: "pro", monthlyPriceMinor: 10000,
    durations: [{ months: 1, discountPercent: 0 }, { months: 1, discountPercent: 5 }],
  }));
  assert.throws(() => normalizePaidPlanDurations({
    code: "pro", monthlyPriceMinor: 10000,
    durations: [{ months: 2, discountPercent: 0 }],
  }));
});
