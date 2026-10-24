import assert from "node:assert/strict";
import test from "node:test";
import { ledgerRecordedAt } from "./ledgerTimestamp.js";

test("online ledger entries use server time instead of the phone timestamp", () => {
  const serverTime = new Date("2026-10-25T10:00:00.000Z");
  const result = ledgerRecordedAt("2001-01-01T00:00:00.000Z", true, () => serverTime);
  assert.equal(result.toISOString(), serverTime.toISOString());
});

test("offline queue replay preserves the original recorded timestamp", () => {
  const offlineTime = "2026-10-20T12:30:00.000Z";
  assert.equal(ledgerRecordedAt(offlineTime, false).toISOString(), offlineTime);
});

test("entries without a recorded timestamp fall back to server time", () => {
  const serverTime = new Date("2026-10-25T10:00:00.000Z");
  assert.equal(ledgerRecordedAt(undefined, false, () => serverTime), serverTime);
});
