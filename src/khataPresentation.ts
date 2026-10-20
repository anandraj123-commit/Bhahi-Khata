export type KhataBalanceTone = "red" | "green" | "neutral";

export type KhataEntryForDisplay = {
  date: string;
  type: string;
};

export type TransactionAmountForDisplay = {
  amount: number;
  type: string;
};

export function transactionAmountText(
  entry: TransactionAmountForDisplay,
  formatCurrency: (amount: number) => string,
) {
  return formatCurrency(Math.abs(entry.amount));
}

export function khataBalanceDisplay(signedBalance: number) {
  const tone: KhataBalanceTone =
    signedBalance > 0 ? "red" : signedBalance < 0 ? "green" : "neutral";
  const position =
    signedBalance > 0 ? "Outstanding" : signedBalance < 0 ? "Advance" : "Settled";

  return { amount: Math.abs(signedBalance), position, tone };
}

export function khataCustomerMatchesSearch(name: string, search: string) {
  return name.toLowerCase().includes(search.toLowerCase());
}

export function khataEntriesForTab<T extends KhataEntryForDisplay>(
  entries: T[],
  tab: string,
  month: string,
) {
  return entries.filter((entry) => {
    if (!entry.date.startsWith(month)) return false;
    if (tab === "Udhari") return entry.type === "credit";
    if (tab === "Payment") return entry.type === "payment";
    return true;
  });
}
