import assert from "node:assert/strict";
import test from "node:test";
import { sameEntryValues } from "./records.js";

const entry = {
  id: "entry-1", customerId: "customer-1", type: "credit", amount: 10,
  date: "2026-10-25", note: "", method: "Cash", reference: "",
};

test("transaction time edits are recognized as entry changes", () => {
  assert.equal(sameEntryValues(
    { ...entry, recordedAt: "2026-10-25T09:00:00.000Z" },
    { ...entry, recordedAt: "2026-10-25T10:00:00.000Z" },
  ), false);
});

test("legacy entries without one side's timestamp remain compatible", () => {
  assert.equal(sameEntryValues(entry, { ...entry, recordedAt: "2026-10-25T09:00:00.000Z" }), true);
});
