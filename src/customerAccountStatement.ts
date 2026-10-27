import { financialSummary, totalUdhari, type Customer, type Data, type Entry } from "./model";
import { customerLifecycleState } from "./customerLifecycle";
import { entryDateTime, transactionLabel } from "./entryPresentation";
import { localeTag } from "./locales";
import { authorizeReceiptAccess, reconstructReceiptHistory, type ReceiptSnapshot } from "./transactionReceipt";

export type StatementSyncState = "pending" | "failed" | "conflict" | "server" | "local" | "unknown";
export type CustomerStatementTransaction = Entry & {
  label: string;
  displayDate: string;
  syncState: StatementSyncState;
  runningAfter?: { outstanding: number; advance: number };
};

export type CustomerAccountStatement = {
  shop: Data["shop"];
  customer: Customer;
  language: string;
  generatedAt: string;
  customerState: "active" | "disabled" | "removed";
  financial: {
    totalUdhari: number;
    totalReceived: number;
    udhariRecovered: number;
    advanceDeposited: number;
    advanceRefunded: number;
    outstanding: number;
    availableAdvance: number;
  };
  opening: {
    date?: string;
    udhari?: number;
    advance?: number;
    adjustedAgainstUdhari?: number;
    remainingAdvance?: number;
  };
  transactions: CustomerStatementTransaction[];
  runningBalancesAvailable: boolean;
  queueAvailable: boolean;
  period?: {
    month: string;
    openingBalance: number;
    closingBalance: number;
    udhariGiven: number;
    paymentReceived: number;
    advanceRefunded: number;
    transactionFilter?: string;
    customerSearch?: string;
    customerCreatedDateFilter?: string;
  };
};

const isInactiveEntry = (entry: Entry) => {
  const record = entry as Entry & { deletedAt?: string | null; voidedAt?: string | null; status?: string };
  return Boolean(record.deletedAt || record.voidedAt || record.status === "deleted" || record.status === "voided");
};

function entrySyncState(snapshot: ReceiptSnapshot, entry: Entry): StatementSyncState {
  if (snapshot.queueAvailable === false) return "unknown";
  const operations = snapshot.queue.flatMap(({ state, change }) => change.entries
    .filter((item) => (item.after || item.before)?.id === entry.id)
    .map(() => state));
  const latest = operations.at(-1);
  if (latest === "pending") return "pending";
  if (latest === "failed") return "failed";
  if (latest === "conflict") return "conflict";
  return entry.serverVersion ? "server" : "local";
}

/** Build a read-only statement from one authenticated, account-scoped local snapshot. */
export function buildCustomerAccountStatement(
  snapshot: ReceiptSnapshot,
  customerId: string,
  now = new Date(),
  options: { transactionFilter?: (entry: Entry) => boolean; includeRunningBalances?: boolean } = {},
): CustomerAccountStatement {
  authorizeReceiptAccess(snapshot.data, snapshot.accountId, null, false);
  const customers = snapshot.data.customers.filter((customer) => customer.id === customerId);
  if (customers.length !== 1) throw new Error("This customer is not available in the authenticated shop's local data.");
  const customer = customers[0];
  const deletedIds = new Set((snapshot.data.deletedEntries || []).map((entry) => entry.id));
  const allActiveEntries = snapshot.data.entries.filter((entry) => !isInactiveEntry(entry) && !deletedIds.has(entry.id));
  const customerEntries = allActiveEntries.filter((entry) => entry.customerId === customer.id);
  if (new Set(customerEntries.map((entry) => entry.id)).size !== customerEntries.length)
    throw new Error("The local customer history contains duplicate transaction IDs. Refresh the shop data before exporting.");

  // This is the same full local ledger supplied to Customer Details, with any
  // explicit tombstones removed defensively. No visible-page slice is used.
  const data: Data = { ...snapshot.data, entries: allActiveEntries };
  const totals = financialSummary(data, customer.id);
  const openingAdvance = customer.openingAdvance || 0;
  const opening: CustomerAccountStatement["opening"] = {};
  if (customer.opening > 0) opening.udhari = customer.opening;
  if (openingAdvance > 0) opening.advance = openingAdvance;
  if (customer.opening > 0 || openingAdvance > 0)
    opening.date = customer.openingDate || customer.createdAt?.slice(0, 10);
  if (customer.opening > 0 && openingAdvance > 0) {
    // Match the two conditional opening rows shown on Customer Details.
    opening.adjustedAgainstUdhari = Math.min(customer.opening, openingAdvance);
    opening.remainingAdvance = Math.max(0, openingAdvance - customer.opening);
  }

  const ordered = customerEntries.filter((entry) => options.transactionFilter?.(entry) ?? true).map((entry, index) => ({ entry, index }))
    .sort((left, right) => left.entry.date.localeCompare(right.entry.date) ||
      (left.entry.recordedAt || `${left.entry.date}T00:00:00.000Z`).localeCompare(right.entry.recordedAt || `${right.entry.date}T00:00:00.000Z`) ||
      left.entry.id.localeCompare(right.entry.id) || left.index - right.index)
    .map(({ entry }) => entry);
  const statementSnapshot: ReceiptSnapshot = { ...snapshot, data };
  const reconstructed = options.includeRunningBalances === false
    ? []
    : ordered.map((entry) => reconstructReceiptHistory(statementSnapshot, customer, entry));
  const runningBalancesAvailable = options.includeRunningBalances !== false && ordered.length > 0 && reconstructed.every((item) => Boolean(item.history));
  const transactions = ordered.map((entry, index) => {
    const history = runningBalancesAvailable ? reconstructed[index]?.history : undefined;
    return {
      ...entry,
      label: transactionLabel(entry.type),
      displayDate: entryDateTime(entry, localeTag(snapshot.data.language)),
      syncState: entrySyncState(snapshot, entry),
      ...(history ? { runningAfter: { ...history.after } } : {}),
    };
  });

  return {
    shop: { ...snapshot.data.shop },
    customer: { ...customer },
    language: snapshot.data.language,
    generatedAt: now.toISOString(),
    customerState: customerLifecycleState(customer),
    financial: {
      totalUdhari: totalUdhari(data, customer.id),
      totalReceived: totals.totalReceivedPaise / 100,
      udhariRecovered: totals.totalUdhariRecoveredPaise / 100,
      advanceDeposited: totals.totalAdvanceDepositedPaise / 100,
      advanceRefunded: totals.totalAdvanceRefundedPaise / 100,
      outstanding: totals.outstandingPaise / 100,
      availableAdvance: totals.availableAdvancePaise / 100,
    },
    opening,
    transactions,
    runningBalancesAvailable,
    queueAvailable: snapshot.queueAvailable !== false,
  };
}
