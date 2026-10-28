import type { Customer, Entry } from "./model";
import type { ReceiptSnapshot } from "./transactionReceipt";
import { authorizeReceiptAccess, receiptCurrency } from "./transactionReceipt";
import { entryDateTime, transactionLabel } from "./entryPresentation";
import { localeTag } from "./locales";
import { customerLifecycleState } from "./customerLifecycle";
import { entrySyncState, type StatementSyncState } from "./customerAccountStatement";
import { t } from "./i18n";

export type DownloadReportKind = "all" | "today" | "thisMonth" | "lastMonth" | "custom";
export type DownloadReportRequest = {
  kind: DownloadReportKind;
  customerId: string | null;
  fromDate?: string;
  toDate?: string;
};
export type DownloadReportTransaction = Entry & {
  customerName: string;
  label: string;
  displayDate: string;
  syncState: StatementSyncState;
};
export type DownloadReport = {
  shop: ReceiptSnapshot["data"]["shop"];
  language: string;
  kind: DownloadReportKind;
  customerId: string | null;
  customer?: Customer;
  customers: Customer[];
  customerStates: Record<string, "active" | "disabled" | "removed">;
  startDate?: string;
  endDate?: string;
  generatedAt: string;
  transactions: DownloadReportTransaction[];
  totals: { udhariGiven: number; paymentsReceived: number; advanceRefunded: number };
  queueAvailable: boolean;
};

const localDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const pad = (value: number) => String(value).padStart(2, "0");

export function isValidReportDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(year, month, 0).getDate();
}

export type CustomReportDateState = "incomplete" | "invalid" | "invalidOrder" | "valid";

/** Empty dates are an incomplete selection, not a validation error. */
export function customReportDateState(fromDate: string, toDate: string): CustomReportDateState {
  if (!fromDate || !toDate) return "incomplete";
  if (!isValidReportDate(fromDate) || !isValidReportDate(toDate)) return "invalid";
  return fromDate > toDate ? "invalidOrder" : "valid";
}

export function reportDateRange(kind: DownloadReportKind, now = new Date(), custom?: { fromDate?: string; toDate?: string }) {
  if (kind === "all") return {};
  if (kind === "today") {
    const day = localDay(now);
    return { startDate: day, endDate: day };
  }
  if (kind === "thisMonth") {
    return {
      startDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
      endDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())}`,
    };
  }
  if (kind === "lastMonth") {
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      startDate: `${last.getFullYear()}-${pad(last.getMonth() + 1)}-01`,
      endDate: localDay(last),
    };
  }
  const fromDate = custom?.fromDate || "";
  const toDate = custom?.toDate || "";
  if (!isValidReportDate(fromDate) || !isValidReportDate(toDate) || fromDate > toDate)
    throw new Error("Invalid date range.");
  return { startDate: fromDate, endDate: toDate };
}

const inactive = (entry: Entry) => {
  const value = entry as Entry & { deletedAt?: string | null; voidedAt?: string | null; status?: string };
  return Boolean(value.deletedAt || value.voidedAt || value.status === "deleted" || value.status === "voided");
};

/** Builds an export only from one authenticated local ledger snapshot, never a visible/paginated list. */
export function buildDownloadReport(
  snapshot: ReceiptSnapshot,
  request: DownloadReportRequest,
  now = new Date(),
): DownloadReport {
  authorizeReceiptAccess(snapshot.data, snapshot.accountId, null, false);
  const range = reportDateRange(request.kind, now, request);
  const customerMap = new Map(snapshot.data.customers.map((customer) => [customer.id, customer]));
  const customer = request.customerId ? customerMap.get(request.customerId) : undefined;
  if (request.customerId && !customer) throw new Error("Selected customer is unavailable in this shop.");
  const deletedIds = new Set((snapshot.data.deletedEntries || []).map((entry) => entry.id));
  const seen = new Set<string>();
  const entries = snapshot.data.entries.filter((entry) => {
    if (seen.has(entry.id)) throw new Error("The local ledger contains duplicate transaction IDs.");
    seen.add(entry.id);
    if (inactive(entry) || deletedIds.has(entry.id) || !customerMap.has(entry.customerId) ||
      (request.customerId && entry.customerId !== request.customerId)) return false;
    if (!isValidReportDate(entry.date) || !Number.isFinite(entry.amount) || entry.amount < 0)
      throw new Error("The local ledger contains invalid transaction information.");
    return (!range.startDate || entry.date >= range.startDate) && (!range.endDate || entry.date <= range.endDate);
  }).slice().sort((left, right) => left.date.localeCompare(right.date) ||
    (left.recordedAt || left.createdAt || "").localeCompare(right.recordedAt || right.createdAt || "") || left.id.localeCompare(right.id));

  const customers = request.customerId && customer
    ? [customer]
    : [...new Set(entries.map((entry) => entry.customerId))]
      .map((id) => customerMap.get(id)!)
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id));
  const cents = (type: Entry["type"]) => entries.filter((entry) => entry.type === type)
    .reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0) / 100;
  const reportSnapshot = snapshot;
  const transactions: DownloadReportTransaction[] = entries.map((entry) => ({
    ...entry,
    customerName: customerMap.get(entry.customerId)!.name,
    label: transactionLabel(entry.type),
    displayDate: entryDateTime(entry, localeTag(snapshot.data.language)),
    syncState: entrySyncState(reportSnapshot, entry),
  }));

  return {
    shop: { ...snapshot.data.shop }, language: snapshot.data.language, kind: request.kind,
    customerId: request.customerId, ...(customer ? { customer: { ...customer } } : {}),
    customers: customers.map((item) => ({ ...item })),
    customerStates: Object.fromEntries(customers.map((item) => [item.id, customerLifecycleState(item)])),
    ...range, generatedAt: now.toISOString(), transactions,
    totals: { udhariGiven: cents("credit"), paymentsReceived: cents("payment"), advanceRefunded: cents("refund") },
    queueAvailable: snapshot.queueAvailable !== false,
  };
}

export function downloadReportFilename(report: DownloadReport) {
  const safe = (value: string) => value.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "Customer";
  const scope = report.customer ? `${safe(report.customer.name)}_${safe(report.customer.id)}` : "AllCustomers";
  const kind = report.kind === "all" ? "AllTransactions" : report.kind === "today" ? `Today_${report.startDate}` : report.kind === "thisMonth" ? `ThisMonth_${report.startDate?.slice(0, 7)}` : report.kind === "lastMonth" ? `LastMonth_${report.startDate?.slice(0, 7)}` : `Custom_${report.startDate}_${report.endDate}`;
  return `DigitalKhata_${scope}_${kind}.pdf`;
}

export function reportRangeLabel(report: DownloadReport, language: string) {
  if (!report.startDate || !report.endDate) return t("All", language);
  const format = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12).toLocaleDateString(localeTag(language), { day: "numeric", month: "short", year: "numeric" });
  };
  return report.startDate === report.endDate ? format(report.startDate) : `${format(report.startDate)} – ${format(report.endDate)}`;
}

export { receiptCurrency };
