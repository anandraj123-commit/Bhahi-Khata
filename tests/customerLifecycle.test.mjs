import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { customerLifecycleState, matchesCustomerLifecycleFilter, normalizeCustomerLifecycle, transitionCustomerLifecycle } from "../src/customerLifecycle.ts";
import { customerLifecycleTranslations } from "../src/customerLifecycleTranslations.ts";
import { APP_RUNTIME_TRANSLATION_KEYS } from "../src/translationInventory.ts";
import { customerCreateSchema, customerLifecycleSchema, customerSchema } from "../server/src/validators/schemas.js";
import { Customer } from "../server/src/models.js";
import { customerOut } from "../server/src/utils/serializers.js";

const customer = (overrides = {}) => ({
  id: "customer-1", name: "Synthetic customer", phone: "", address: "", opening: 50,
  openingAdvance: 20, limit: 0, reminder: false, serverVersion: 1, resolutionVersion: 1,
  status: true, disabled: false, removed: false, ...overrides,
});
const data = (customers = [], audit = []) => ({
  shop: { name: "Test", owner: "Test", address: "", phone: "", whatsapp: "" },
  customers, entries: [], audit, read: [], language: "en", defaultMethod: "Cash",
  reminders: { enabled: false, day: "Last day", time: "10:00", minimum: "0", whatsapp: false, sms: false },
});

test("legacy customer lifecycle defaults to active and the three valid states normalize", () => {
  assert.deepEqual(
    (({ status, disabled, removed }) => ({ status, disabled, removed }))(normalizeCustomerLifecycle({ id: "legacy" })),
    { status: true, disabled: false, removed: false },
  );
  for (const [state, flags] of Object.entries({
    active: { status: true, disabled: false, removed: false },
    disabled: { status: false, disabled: true, removed: false },
    removed: { status: false, disabled: false, removed: true },
  })) assert.equal(customerLifecycleState(customer(flags)), state);
  for (const flags of [
    { status: false, disabled: false, removed: false },
    { status: true, disabled: true, removed: false },
    { status: false, disabled: true, removed: true },
    { status: true, disabled: undefined, removed: false },
  ]) assert.throws(() => normalizeCustomerLifecycle(customer(flags)));
});

test("only the specified lifecycle transitions are allowed and balances are preserved", () => {
  const transitions = [
    ["active", "disabled"], ["active", "removed"], ["disabled", "active"],
    ["disabled", "removed"], ["removed", "active"],
  ];
  for (const [from, to] of transitions) {
    const flags = { active: { status: true, disabled: false, removed: false }, disabled: { status: false, disabled: true, removed: false }, removed: { status: false, disabled: false, removed: true } };
    const original = customer(flags[from]);
    const changed = transitionCustomerLifecycle(original, to);
    assert.equal(customerLifecycleState(changed), to);
    assert.equal(changed.id, original.id);
    assert.equal(changed.opening, original.opening);
    assert.equal(changed.openingAdvance, original.openingAdvance);
  }
  assert.throws(() => transitionCustomerLifecycle(customer({ status: false, disabled: false, removed: true }), "disabled"));
});

test("Manage Customers filters active, disabled, and removed records without cross-classifying", () => {
  const active = customer();
  const disabled = customer({ status: false, disabled: true, removed: false });
  const removed = customer({ status: false, disabled: false, removed: true });
  for (const filter of ["All", "Disabled", "Removed"]) {
    const matches = [active, disabled, removed].filter((item) => matchesCustomerLifecycleFilter(item, filter));
    assert.deepEqual(matches, [({ All: active, Disabled: disabled, Removed: removed })[filter]]);
  }
  assert.equal(matchesCustomerLifecycleFilter({ id: "legacy" }, "All"), true);
  assert.equal(matchesCustomerLifecycleFilter({ id: "legacy" }, "Removed"), false);
});

test("status-only edits become an explicit lifecycle queue operation", () => {
  const source = readFileSync("src/syncDelta.ts", "utf8");
  assert.match(source, /lifecycleOnly\s*=.*equal\(oldProfile, nextProfile\)/);
  assert.match(source, /operation: lifecycleOnly \? "lifecycle" : "update"/);
  const before = data([customer()]);
  const after = data([transitionCustomerLifecycle(customer(), "removed")], [{ id: "op-1", action: "CUSTOMER_REMOVED", date: "2026-01-01T00:00:00Z" }]);
  assert.equal(before.customers[0].status, true);
  assert.deepEqual([after.customers[0].status, after.customers[0].disabled, after.customers[0].removed], [false, false, true]);
  assert.equal(after.audit[0].action, "CUSTOMER_REMOVED");
});

test("backend schemas accept legacy defaults, enforce exclusive flags, and validate transition payloads", () => {
  const base = { id: "customer-1", name: "Synthetic customer", phone: "", address: "", opening: 0, openingAdvance: 0, limit: 0, reminder: false };
  assert.equal(customerSchema.safeParse(base).success, true);
  assert.equal(customerSchema.safeParse({ ...base, status: true, disabled: false, removed: false }).success, true);
  assert.equal(customerSchema.safeParse({ ...base, status: true, disabled: true, removed: false }).success, false);
  assert.equal(customerCreateSchema.safeParse(base).success, true);
  assert.equal(customerCreateSchema.safeParse({ ...base, status: false, disabled: true, removed: false }).success, false);
  assert.equal(customerLifecycleSchema.safeParse({ target: "removed", operationId: "op-1", baseVersion: 1, baseResolutionVersion: 1 }).success, true);
  assert.equal(customerLifecycleSchema.safeParse({ target: "removed", operationId: "op-1", baseVersion: 1, baseResolutionVersion: 1, extra: true }).success, false);
});

test("Mongo customer schema defaults all lifecycle flags to active; legacy API serialization is active", () => {
  assert.equal(Customer.schema.path("status").defaultValue, true);
  assert.equal(Customer.schema.path("disabled").defaultValue, false);
  assert.equal(Customer.schema.path("removed").defaultValue, false);
  assert.ok(Customer.schema.s.hooks._pres.get("validate").some((hook) => hook.fn.name === "validateCustomerLifecycle"));
  const serialized = customerOut({ clientId: "legacy", name: "Legacy", phone: "", address: "", openingPaise: 0, openingAdvancePaise: 0, limitPaise: 0, reminder: false });
  assert.deepEqual([serialized.status, serialized.disabled, serialized.removed], [true, false, false]);
});

test("lifecycle localization keys exist in every non-English locale and are tracked", () => {
  const required = [
    "Manage Customers", "Disabled", "Removed", "Disable Customer", "Enable Customer", "Remove Customer", "Restore Customer",
    "Disable customer?", "Remove Customer?", "Enable Customer?", "Restore Customer?", "Customer disabled", "Customer enabled",
    "Customer removed", "Customer restored", "Customer status change not allowed", "This customer cannot be moved to that status.",
    "Removing hides this customer from active lists. Their balance and transaction history remain saved and can be accessed from Removed customers.",
    "This customer will not be available for new transactions until enabled.", "This customer will be available for normal transactions again.",
    "No disabled customers", "No removed customers", "Try another search or customer status.", "Customer status", "Cannot edit this customer",
    "Enable or restore this customer before editing.", "Customer is unavailable for transactions",
    "Enable or restore this customer before recording financial transactions.", "Historical transactions are read-only.",
  ];
  assert.equal(Object.keys(customerLifecycleTranslations).length, 22);
  for (const [locale, dictionary] of Object.entries(customerLifecycleTranslations)) {
    for (const key of required) assert.ok(dictionary[key]?.trim() && dictionary[key] !== key, `${locale} missing ${key}`);
  }
  for (const key of required) assert.ok(APP_RUNTIME_TRANSLATION_KEYS.includes(key), `inventory missing ${key}`);
});

test("inactive customers remain in financial totals and are excluded from active selectors", () => {
  const app = readFileSync("App.tsx", "utf8");
  const list = app.match(/const matchingCustomers = useMemo\(\(\) => \{([\s\S]*?)\}, \[data, route\.screen, search, filter\]\)/)?.[0] || "";
  assert.match(list, /isActiveCustomer/);
  assert.match(app, /matchesCustomerLifecycleFilter\(c, manageCustomerFilter/);
  const summary = readFileSync("src/model.ts", "utf8").match(/export function financialSummary\([\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(summary, /isActiveCustomer|\.filter\(.*status/);
  assert.match(app, /case "manageCustomers"/);
});

test("backend guards financial mutations and startup migration only defaults wholly legacy rows", () => {
  const ledger = readFileSync("server/src/services/ledgerService.js", "utf8");
  const models = readFileSync("server/src/models.js", "utf8");
  assert.match(ledger, /CUSTOMER_NOT_ACTIVE/);
  assert.match(models, /status: \{ \$exists: false \}, disabled: \{ \$exists: false \}, removed: \{ \$exists: false \}/);
  assert.match(models, /CUSTOMER_STATUS_MIGRATION_CONFLICT/);
  const store = readFileSync("src/offlineStore.ts", "utf8");
  assert.match(store, /currentVersion > 6/);
  assert.match(store, /UPDATE local_customers SET record_json/);
  assert.match(store, /UPDATE sync_queue SET change_json/);
  assert.doesNotMatch(store.match(/if \(currentVersion < 6\) \{([\s\S]*?)\n    \}/)?.[1] || "", /DELETE FROM local_customers|DELETE FROM sync_queue/);
  const conflictResolution = readFileSync("server/src/services/customersService.js", "utf8");
  assert.match(conflictResolution, /\.\.\.lifecycleTarget\(proposedStatus\)/);
  assert.match(conflictResolution, /customer-lifecycle-resolution-\$\{input\.resolutionId\}/);
  assert.match(readFileSync("App.tsx", "utf8"), /CUSTOMER_DISABLED: "Customer disabled"/);
});
