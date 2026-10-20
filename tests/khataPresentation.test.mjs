import assert from "node:assert/strict";
import test from "node:test";
import {
  khataBalanceDisplay,
  khataCustomerMatchesSearch,
  khataEntriesForTab,
  transactionAmountText,
} from "../src/khataPresentation.ts";

const entries = [
  { id: "credit", type: "credit", date: "2026-10-03", amount: 500, advanceApplied: 300 },
  { id: "payment", type: "payment", date: "2026-10-04", amount: 1000, appliedToUdhari: 500, addedToAdvance: 500 },
  { id: "refund", type: "refund", date: "2026-10-05", amount: 100 },
  { id: "next-month", type: "credit", date: "2026-11-01", amount: 200 },
];

test("All includes each supported transaction type in the selected month", () => {
  assert.deepEqual(
    khataEntriesForTab(entries, "All", "2026-10").map(({ id }) => id),
    ["credit", "payment", "refund"],
  );
});

test("Udhari contains only credit entries, including credit applied from advance", () => {
  assert.deepEqual(
    khataEntriesForTab(entries, "Udhari", "2026-10").map(({ id }) => id),
    ["credit"],
  );
});

test("Payment contains the full receipt once and excludes Udhari and refunds", () => {
  const payments = khataEntriesForTab(entries, "Payment", "2026-10");
  assert.deepEqual(payments.map(({ id }) => id), ["payment"]);
  assert.equal(payments[0].amount, 1000);
  assert.equal(payments[0].addedToAdvance, 500);
});

test("month filtering excludes entries outside the selected period", () => {
  assert.deepEqual(
    khataEntriesForTab(entries, "All", "2026-11").map(({ id }) => id),
    ["next-month"],
  );
});

test("customer search can be combined with the selected transaction tab", () => {
  assert.equal(khataCustomerMatchesSearch("Rahul Sharma", "rahul"), true);
  assert.equal(khataCustomerMatchesSearch("Amit Shah", "rahul"), false);
  const searchedCustomerEntries = khataCustomerMatchesSearch("Rahul Sharma", "rahul")
    ? entries
    : [];
  assert.deepEqual(
    khataEntriesForTab(searchedCustomerEntries, "Udhari", "2026-10").map(({ id }) => id),
    ["credit"],
  );
});

test("empty data produces no matching transaction rows", () => {
  assert.deepEqual(khataEntriesForTab([], "All", "2026-10"), []);
});

test("switching tabs filters a copy and preserves the complete monthly collection", () => {
  const allEntries = entries.filter((entry) => entry.date.startsWith("2026-10"));
  assert.deepEqual(khataEntriesForTab(allEntries, "Udhari", "2026-10").map(({ id }) => id), ["credit"]);
  assert.deepEqual(khataEntriesForTab(allEntries, "Payment", "2026-10").map(({ id }) => id), ["payment"]);
  assert.deepEqual(khataEntriesForTab(allEntries, "All", "2026-10").map(({ id }) => id), ["credit", "payment", "refund"]);
  assert.deepEqual(allEntries.map(({ id }) => id), ["credit", "payment", "refund"]);
});

test("offline-created entries use the same tab filtering rules", () => {
  const offlineEntry = { id: "offline-credit", type: "credit", date: "2026-10-06", source: "offline" };
  assert.deepEqual(
    khataEntriesForTab([offlineEntry], "Udhari", "2026-10"),
    [offlineEntry],
  );
});

test("edits and deletions are reflected from the current local entry collection", () => {
  const edited = entries.map((entry) =>
    entry.id === "credit" ? { ...entry, amount: 300 } : entry,
  );
  const afterDelete = edited.filter((entry) => entry.id !== "payment");
  assert.equal(khataEntriesForTab(edited, "Udhari", "2026-10")[0].amount, 300);
  assert.deepEqual(
    khataEntriesForTab(afterDelete, "Payment", "2026-10"),
    [],
  );
});

test("signed balance presentation distinguishes debt, advance and settled states", () => {
  assert.deepEqual(khataBalanceDisplay(1000), {
    amount: 1000,
    position: "Outstanding",
    tone: "red",
  });
  assert.deepEqual(khataBalanceDisplay(-1000), {
    amount: 1000,
    position: "Advance",
    tone: "green",
  });
  assert.deepEqual(khataBalanceDisplay(0), {
    amount: 0,
    position: "Settled",
    tone: "neutral",
  });
});

test("Udhari and payment transaction amounts omit arithmetic signs", () => {
  const currency = (amount) => `₹${amount.toLocaleString("en-IN")}`;
  assert.equal(transactionAmountText({ type: "credit", amount: 1000 }, currency), "₹1,000");
  assert.equal(transactionAmountText({ type: "payment", amount: 600 }, currency), "₹600");
});

test("refund amounts omit the list sign and remain absolute in transaction detail", () => {
  const currency = (amount) => `₹${amount.toLocaleString("en-IN")}`;
  const refund = { type: "refund", amount: 400 };
  assert.equal(transactionAmountText(refund, currency), "₹400");
  assert.equal(transactionAmountText({ ...refund, amount: -300 }, currency), "₹300");
});

test("display formatting uses an absolute value without mutating the transaction", () => {
  const currency = (amount) => `₹${amount.toLocaleString("en-IN")}`;
  const transaction = { type: "credit", amount: -1000 };
  assert.equal(transactionAmountText(transaction, currency), "₹1,000");
  assert.equal(transaction.amount, -1000);
});
