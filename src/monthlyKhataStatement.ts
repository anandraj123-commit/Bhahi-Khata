import { monthly, type Data } from "./model";
import { buildCustomerAccountStatement, type CustomerAccountStatement } from "./customerAccountStatement";
import { khataEntriesForTab } from "./khataPresentation";
import type { ReceiptSnapshot } from "./transactionReceipt";

export type MonthlyKhataStatement = CustomerAccountStatement & {
  period: NonNullable<CustomerAccountStatement["period"]>;
};

/** Build one customer's selected-month statement from the authenticated local ledger snapshot. */
export function buildMonthlyKhataStatement(
  snapshot: ReceiptSnapshot,
  customerId: string,
  month: string,
  now = new Date(),
  transactionFilter = "All",
  customerSearch = "",
  customerCreatedDateFilter = "",
): MonthlyKhataStatement {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Choose a valid month before exporting the statement.");

  const complete = buildCustomerAccountStatement(snapshot, customerId, now, {
    transactionFilter: (entry) => entry.date.slice(0, 7) === month,
    includeRunningBalances: false,
  });
  const deletedIds = new Set((snapshot.data.deletedEntries || []).map((entry) => entry.id));
  const activeEntries = snapshot.data.entries.filter((entry) => {
    const record = entry as typeof entry & { deletedAt?: string | null; voidedAt?: string | null; status?: string };
    return !deletedIds.has(entry.id) && !record.deletedAt && !record.voidedAt && record.status !== "deleted" && record.status !== "voided";
  });
  const activeData: Data = { ...snapshot.data, entries: activeEntries };
  const summary = monthly(activeData, customerId, month);
  return {
    ...complete,
    period: {
      month,
      openingBalance: summary.opening,
      closingBalance: summary.closing,
      udhariGiven: summary.credit,
      paymentReceived: summary.payment,
      advanceRefunded: summary.refund,
      transactionFilter,
      customerSearch: customerSearch.trim(),
      customerCreatedDateFilter,
    },
    // Reuse the exact month/type selector used for the Khata card. This applies
    // to the full eligible history; the screen's visible 10-row slice is never used.
    transactions: khataEntriesForTab(complete.transactions, transactionFilter, month),
  };
}
