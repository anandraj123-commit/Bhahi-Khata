import assert from "node:assert/strict";
import test from "node:test";
import {
  customerBalanceDisplay,
  formatCustomerCreatedOn,
} from "../src/customerPresentation.ts";

test("customer creation timestamps use the app's date display format", () => {
  assert.equal(formatCustomerCreatedOn("2026-10-15T09:30:00.000Z"), "15 Oct 2026");
});

test("missing or invalid customer creation timestamps are not fabricated", () => {
  assert.equal(formatCustomerCreatedOn(undefined), "Not available");
  assert.equal(formatCustomerCreatedOn("not-a-date"), "Not available");
});

test("customer balance labels use absolute rupee amounts and financial meanings", () => {
  const currency = (amount) => `₹${amount.toLocaleString("en-IN")}`;
  assert.deepEqual(customerBalanceDisplay(-500, currency), {
    label: "₹500 Advance",
    tone: "green",
  });
  assert.deepEqual(customerBalanceDisplay(300, currency), {
    label: "₹300 Due",
    tone: "red",
  });
  assert.deepEqual(customerBalanceDisplay(0, currency), {
    label: "₹0 Settled",
    tone: "neutral",
  });
});
