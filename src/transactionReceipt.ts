import { financialSummary, type Customer, type Data, type Entry } from "./model";
import type { SyncDelta } from "./syncDelta";
import { transactionLabel } from "./entryPresentation";

export type ReceiptQueueRecord = { state: string; change: SyncDelta };
export type ReceiptSnapshot = { accountId: string; data: Data; queue: ReceiptQueueRecord[]; queueAvailable?: boolean };
export type ReceiptHistory = {
  before: { outstanding: number; advance: number };
  after: { outstanding: number; advance: number };
  explanation: string;
};
export type TransactionReceipt = {
  shop: Data["shop"]; customer: Customer; entry: Entry; label: string;
  date: string; time?: string; timeZone: string; pendingSync?: true;
  history?: ReceiptHistory; historyUnavailable?: string; generatedAt: string;
};
export const receiptCurrency = (amount: number) => `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Compare Indian shop identities independent of formatting or a leading +91. */
export const receiptAccountIdentity = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
};
export function authorizeReceiptAccess(
  data: Data,
  accountId: string,
  session: { accountId: string } | null,
  requireOfflineSession: boolean,
) {
  if (!data.signedIn || data.shopExists === false)
    throw new Error("Sign in to this shop before exporting a receipt.");
  const shopIdentity = receiptAccountIdentity(data.shop.phone || "");
  const accountIdentity = receiptAccountIdentity(accountId);
  if (!/^\d{10}$/.test(shopIdentity) || !accountIdentity || accountIdentity !== shopIdentity)
    throw new Error("The authenticated shop does not match this receipt’s local account.");
  if (session && receiptAccountIdentity(session.accountId) !== shopIdentity)
    throw new Error("The offline session belongs to a different shop.");
  if (requireOfflineSession && !session)
    throw new Error("Your offline authorization has expired. Sign in again when connected before exporting a receipt.");
  return true;
}
/** Select the SQLite key from an active offline session/ref, falling back to the signed-in shop identity. */
export function resolveReceiptAccountId(
  data: Data,
  preferredAccountId: string | null,
  session: { accountId: string } | null,
  requireOfflineSession: boolean,
) {
  const shopIdentity = receiptAccountIdentity(data.shop.phone || "");
  const accountId = session?.accountId || preferredAccountId || shopIdentity;
  authorizeReceiptAccess(data, accountId, session, requireOfflineSession);
  if (preferredAccountId && receiptAccountIdentity(preferredAccountId) !== shopIdentity)
    throw new Error("The active local account does not match the authenticated shop.");
  return accountId;
}
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
const validAmount = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1e9 && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;
const removed = (entry: Entry) => {
  const record = entry as Entry & { status?: string; deletedAt?: string; voidedAt?: string };
  return record.voidedAt || record.status === "voided" ? "VOIDED" : record.deletedAt || record.status === "deleted" ? "DELETED" : null;
};
/** Effective accounting day is authoritative; creation/synchronization time is not occurrence time. */
export function receiptDateTime(entry: Entry) {
  const date = validDay(entry.date)
    ? new Date(`${entry.date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    : entry.date;
  const timestamp = entry.recordedAt || entry.createdAt;
  const recorded = timestamp ? new Date(timestamp) : null;
  const sameDay = recorded && Number.isFinite(recorded.getTime()) &&
    `${recorded.getFullYear()}-${String(recorded.getMonth() + 1).padStart(2, "0")}-${String(recorded.getDate()).padStart(2, "0")}` === entry.date;
  return {
    date,
    ...(sameDay ? { time: recorded.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase() } : {}),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Device local time",
  };
}

export function reconstructReceiptHistory(snapshot: ReceiptSnapshot, customer: Customer, selected: Entry): { history?: ReceiptHistory; historyUnavailable?: string } {
  const unavailable = (historyUnavailable: string) => ({ historyUnavailable });
  if (removed(selected) || !snapshot.data.entries.some((entry) => entry.id === selected.id))
    return unavailable("Balances are unavailable for a deleted or voided transaction.");
  const entries = snapshot.data.entries.filter((entry) => entry.customerId === customer.id && !removed(entry));
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length ||
      entries.some((entry) => !validDay(entry.date) || !validAmount(entry.amount) || !["credit", "payment", "refund"].includes(entry.type)) ||
      !validAmount(customer.opening) || !validAmount(customer.openingAdvance || 0))
    return unavailable("The cached ledger is incomplete or contains invalid financial data.");
  const openingDate = customer.openingDate || customer.createdAt?.slice(0, 10);
  if (openingDate && (!validDay(openingDate) || entries.some((entry) => entry.date < openingDate)))
    return unavailable("Transactions precede the recorded opening balance; historical balances cannot be established safely.");
  // A day-only record cannot be placed before/after another record on the selected day.
  const sameDay = entries.filter((entry) => entry.date === selected.date);
  if (sameDay.length > 1 && sameDay.some((entry) => {
    if (!entry.recordedAt || !Number.isFinite(Date.parse(entry.recordedAt))) return true;
    const stamp = new Date(entry.recordedAt);
    const localDay = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}`;
    return localDay !== entry.date;
  }))
    return unavailable("Multiple transactions share this date without enough timestamp information to establish their order.");
  const unresolved = snapshot.queue.some(({ state, change }) =>
    (state === "conflict" || state === "failed") &&
    (change.entries.some((item) => (item.after || item.before)?.customerId === customer.id) ||
      change.customers.some((item) => (item.after || item.before)?.id === customer.id)));
  if (unresolved) return unavailable("Resolve this customer’s synchronization conflicts or failed changes before reconstructing balances.");
  if (snapshot.queueAvailable === false)
    return unavailable("Historical balances are unavailable because the local synchronization queue could not be read.");
  const ordered = entries.slice().sort((a, b) => a.date.localeCompare(b.date) ||
    (Date.parse(a.recordedAt || `${a.date}T00:00:00Z`) - Date.parse(b.recordedAt || `${b.date}T00:00:00Z`)) ||
    a.id.localeCompare(b.id));
  const index = ordered.findIndex((entry) => entry.id === selected.id);
  if (index < 0) return unavailable("The selected transaction is missing from the cached ledger.");
  const position = (prefix: Entry[]) => {
    const ledgerPrefix = openingDate ? prefix.filter((entry) => entry.date >= openingDate) : prefix;
    const scopedData = {
      ...snapshot.data,
      customers: snapshot.data.customers.map((item) => item.id === customer.id ? customer : item),
      entries: ledgerPrefix,
    };
    const summary = financialSummary(scopedData, customer.id);
    return {
      outstanding: summary.outstandingPaise / 100,
      advance: summary.availableAdvancePaise / 100,
    };
  };
  return { history: {
    before: position(ordered.slice(0, index)), after: position(ordered.slice(0, index + 1)),
    explanation: "Reconstructed from the currently recorded ledger, including local pending changes. Not an immutable historical snapshot. Later edits or deletions can change these balances. Ordered by effective date, recorded timestamp, then transaction ID for ties; subsequent entries are excluded.",
  } };
}

/** Input is one authenticated, account-scoped SQLite snapshot, never a mixed/global customer lookup. */
export function buildTransactionReceipt(snapshot: ReceiptSnapshot, entryId: string, now = new Date()): TransactionReceipt {
  const { data, accountId, queue } = snapshot;
  authorizeReceiptAccess(data, accountId, null, false);
  const matches = data.entries.filter((entry) => entry.id === entryId);
  if (matches.length > 1) throw new Error("The cached transaction identifier is ambiguous.");
  const operations = queue.flatMap(({ state, change }) => change.entries
    .filter((item) => (item.after || item.before)?.id === entryId).map((item) => ({ state, item })));
  const last = operations.at(-1);
  const deletedAudit = data.audit.find((audit) => audit.action === "Deleted transaction" && audit.before?.id === entryId && !audit.after);
  const entry = matches[0] || (last?.item.operation === "delete" ? last.item.before : undefined) || deletedAudit?.before;
  if (!entry) throw new Error("This transaction is not available in the local cache. No receipt can be generated.");
  if (!validDay(entry.date) || !validAmount(entry.amount) || entry.amount <= 0 || !["credit", "payment", "refund"].includes(entry.type))
    throw new Error("The stored transaction date, type or amount is invalid.");
  const customers = data.customers.filter((customer) => customer.id === entry.customerId);
  if (customers.length !== 1) throw new Error("This transaction’s customer is unavailable in this shop’s cache.");
  const pendingSync = snapshot.queueAvailable !== false && matches.length === 1 && operations.some(({ state, item }) =>
    state === "pending" && item.operation !== "delete" && item.after?.id === entryId);
  return {
    shop: { ...data.shop }, customer: { ...customers[0] }, entry: { ...entry }, label: transactionLabel(entry.type),
    ...receiptDateTime(entry), ...(pendingSync ? { pendingSync: true as const } : {}),
    ...reconstructReceiptHistory(snapshot, customers[0], entry),
    generatedAt: now.toISOString(),
  };
}
