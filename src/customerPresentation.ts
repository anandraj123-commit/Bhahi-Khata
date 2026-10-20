export function formatCustomerCreatedOn(value?: string): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function customerBalanceDisplay(
  signedBalance: number,
  currency: (amount: number) => string,
): { label: string; tone: "red" | "green" | "neutral" } {
  if (signedBalance < 0)
    return { label: `${currency(Math.abs(signedBalance))} Advance`, tone: "green" };
  if (signedBalance > 0)
    return { label: `${currency(Math.abs(signedBalance))} Due`, tone: "red" };
  return { label: `${currency(0)} Settled`, tone: "neutral" };
}
