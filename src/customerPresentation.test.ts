import assert from "node:assert/strict";
import test from "node:test";
import { formatCustomerCreatedAt } from "./customerPresentation.ts";

test("shows customer creation date and time with an AM/PM period", () => {
  const timestamp = "2026-10-25T09:07:00.000Z";
  const value = formatCustomerCreatedAt(timestamp);
  const date = new Date(timestamp);
  const dateText = date.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
  const timeText = date.toLocaleTimeString("en-IN", {
    hour: "numeric", minute: "2-digit", hour12: true,
  }).replace(/\b(am|pm)\b/i, (period) => period.toUpperCase());
  assert.equal(value, `${dateText}, ${timeText}`);
  assert.match(value, /\b(AM|PM)$/);
});

test("handles missing and invalid customer creation timestamps", () => {
  assert.equal(formatCustomerCreatedAt(undefined), "Not available");
  assert.equal(formatCustomerCreatedAt("not-a-timestamp"), "Not available");
});
