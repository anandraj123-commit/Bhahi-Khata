import assert from "node:assert/strict";
import test from "node:test";
import { withoutLegacyDue, withoutLegacyDueFromAudit } from "../src/ledgerCompatibility.ts";
import { backupSchema, entrySchema } from "../server/src/validators/schemas.js";
import { Entry } from "../server/src/models.js";
import { entryOut } from "../server/src/utils/serializers.js";

const legacyEntry = {
  id: "entry-1",
  customerId: "customer-1",
  type: "credit",
  amount: 500,
  date: "2026-10-01",
  note: "Goods",
  method: "Cash",
  due: "2026-10-25",
};

test("legacy local entries load without the retired property", () => {
  const normalized = withoutLegacyDue(legacyEntry);
  assert.equal("due" in normalized, false);
  assert.equal(normalized.amount, 500);
  assert.equal(legacyEntry.due, "2026-10-25");
});

test("legacy local audit snapshots load without the retired property", () => {
  const audit = withoutLegacyDueFromAudit({
    id: "audit-1",
    action: "Recorded Udhari",
    date: "2026-10-01",
    after: legacyEntry,
  });
  assert.equal("due" in audit.after, false);
  assert.equal(audit.after.amount, 500);
});

test("backend accepts and discards legacy due on otherwise valid ledger payloads", () => {
  const parsed = entrySchema.parse(legacyEntry);
  assert.equal("due" in parsed, false);
  assert.equal(parsed.id, legacyEntry.id);
  assert.equal(parsed.amount, legacyEntry.amount);
});

test("legacy backups remain restorable while parsed entries omit due", () => {
  const entry = {
    ...legacyEntry,
    appliedToUdhari: 0,
    addedToAdvance: 0,
    advanceApplied: 0,
  };
  const backup = backupSchema.parse({
    shop: { name: "Shop", owner: "Owner", address: "", phone: "+919876543210", whatsapp: "" },
    customers: [{ id: "customer-1", name: "Customer", phone: "", address: "", opening: 0, openingAdvance: 0, limit: 0, reminder: true }],
    entries: [entry],
    audit: [{ id: "audit-1", action: "Recorded Udhari", date: "2026-10-01", after: entry }],
    language: "English",
    reminders: { enabled: false, day: "Last day", time: "10:00", minimum: "0", whatsapp: false, sms: false },
    defaultMethod: "Cash",
    read: [],
  });
  assert.equal("due" in backup.entries[0], false);
  assert.equal("due" in backup.audit[0].after, false);
});

test("new Mongoose entries and API serializers omit due while old documents remain readable", () => {
  assert.equal(Entry.schema.path("due"), undefined);
  const output = entryOut({
    ...legacyEntry,
    clientId: legacyEntry.id,
    customerClientId: legacyEntry.customerId,
    amountPaise: 50000,
    appliedToUdhariPaise: 0,
    addedToAdvancePaise: 0,
    advanceAppliedPaise: 0,
  });
  assert.equal("due" in output, false);
  assert.equal(output.amount, 500);
});
