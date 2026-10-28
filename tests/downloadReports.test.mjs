import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import loadTs from "./helpers/loadTs.cjs";

const model = loadTs("src/model.ts", { "expo-crypto": { randomUUID: () => "test-id" } });
const receipt = loadTs("src/transactionReceipt.ts", { "./model": model });
const lifecycle = loadTs("src/customerLifecycle.ts", { "./model": model });
const presentation = loadTs("src/entryPresentation.ts", { "./model": model });
const locales = loadTs("src/locales.ts");
const statement = loadTs("src/customerAccountStatement.ts", {
  "./model": model, "./customerLifecycle": lifecycle, "./entryPresentation": presentation,
  "./locales": locales, "./transactionReceipt": receipt,
});
const reports = loadTs("src/downloadReports.ts", {
  "./model": model, "./transactionReceipt": receipt, "./entryPresentation": presentation,
  "./locales": locales, "./customerLifecycle": lifecycle, "./customerAccountStatement": statement,
  "./i18n": { t: (key) => key },
});
const reportPdf = loadTs("src/downloadReportsPdf.ts", {
  "./receiptBrand": { receiptBrand: { company: "Apurva Software Solutions", registration: "MSME Registered", mobile: "+91 6203253537", email: "supports@example.test", website: "example.test" } },
  "./transactionReceipt": receipt,
  "./transactionReceiptPdf": { escapeReceiptHtml: (value) => String(value ?? "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\\"": "&quot;", "'": "&#39;" })[character]) },
  "./receiptLogo": { receiptLogoDataUri: "data:image/png;base64,bG9nbw==" },
  "./i18n": { t: (key) => key },
  "./locales": locales,
  "./downloadReports": reports,
});
const reportPagination = loadTs("src/downloadReportPagination.ts");

const customers = [
  { id: "c1", status: true, disabled: false, removed: false, name: "Asha <One>", phone: "9876543210", whatsappNumber: "9123456789", address: "Main & Market", opening: 0, openingAdvance: 0, limit: 1000, reminder: false },
  { id: "c2", status: true, disabled: false, removed: false, name: "Asha <One>", phone: "9876543211", address: "Second Street", opening: 0, openingAdvance: 0, limit: 1000, reminder: false },
];
const makeEntry = (id, customerId, type, date, fields = {}) => ({ id, customerId, type, amount: 100, date, note: "", method: "Cash", ...fields });
const makeSnapshot = (entries, extras = {}) => ({
  accountId: "6203253537", queue: [], queueAvailable: true,
  data: {
    shop: { name: "Asha Stores", owner: "Asha", phone: "6203253537", whatsapp: "", address: "Gaya" },
    shopExists: true, signedIn: true, language: "English", customers, entries, deletedEntries: [], audit: [],
    reminders: { enabled: false, day: "", time: "", minimum: "", whatsapp: false, sms: false }, defaultMethod: "Cash", read: [],
    ...extras,
  },
});

test("calendar report periods use local calendar boundaries including year transitions and leap February", () => {
  const { reportDateRange } = reports;
  const october = new Date(2026, 9, 28, 12);
  assert.deepEqual(reportDateRange("today", october), { startDate: "2026-10-28", endDate: "2026-10-28" });
  assert.deepEqual(reportDateRange("thisMonth", october), { startDate: "2026-10-01", endDate: "2026-10-31" });
  assert.deepEqual(reportDateRange("lastMonth", october), { startDate: "2026-09-01", endDate: "2026-09-30" });
  assert.deepEqual(reportDateRange("lastMonth", new Date(2027, 0, 10, 12)), { startDate: "2026-12-01", endDate: "2026-12-31" });
  assert.deepEqual(reportDateRange("lastMonth", new Date(2024, 2, 2, 12)), { startDate: "2024-02-01", endDate: "2024-02-29" });
  assert.deepEqual(reportDateRange("custom", october, { fromDate: "2026-10-28", toDate: "2026-10-28" }), { startDate: "2026-10-28", endDate: "2026-10-28" });
  assert.throws(() => reportDateRange("custom", october, { fromDate: "2026-10-29", toDate: "2026-10-28" }), /Invalid date range/);
  assert.throws(() => reportDateRange("custom", october, { fromDate: "2026-02-29", toDate: "2026-03-01" }), /Invalid date range/);
});

test("custom range treats empty and partial dates as incomplete and only errors for a selected reversed range", () => {
  assert.equal(reports.customReportDateState("", ""), "incomplete");
  assert.equal(reports.customReportDateState("2026-10-01", ""), "incomplete");
  assert.equal(reports.customReportDateState("", "2026-10-31"), "incomplete");
  assert.equal(reports.customReportDateState("2026-10-01", "2026-10-31"), "valid");
  assert.equal(reports.customReportDateState("2026-10-10", "2026-10-10"), "valid");
  assert.equal(reports.customReportDateState("2026-10-20", "2026-10-10"), "invalidOrder");
  assert.equal(reports.customReportDateState("2026-02-30", "2026-03-01"), "invalid");
  assert.equal(reports.customReportDateState("2026-10-01", "2026-10-31"), "valid", "correcting the range clears its validation state");
  const app = readFileSync("App.tsx", "utf8");
  assert.match(app, /setReportFromDate\(""\); setReportToDate\(""\); \} setReportKind\(kind\)/, "changing report types clears any old range error");
  assert.match(app, /Select From Date and To Date to view transactions/);
  assert.equal((app.match(/t\("From Date cannot be later than To Date\./g) || []).length, 1, "the reversed-date error is rendered once near the date fields");
  assert.doesNotMatch(app, /t\("Invalid date range\.", data\.language\)\s*<\/Hint>[\s\S]{0,500}Transaction History/);
  assert.match(app, /reportPreview\.transactions\.length > 0 && !reportPreviewLoading && !customRangeInvalid && !customDatesIncomplete/);
});

test("all report types filter the complete local ledger, exclude deleted data, and preserve customer isolation", () => {
  const entries = [
    makeEntry("old", "c1", "credit", "2026-09-30"),
    makeEntry("first", "c1", "credit", "2026-10-01"),
    makeEntry("middle", "c2", "payment", "2026-10-15"),
    makeEntry("last", "c1", "refund", "2026-10-31"),
    makeEntry("future", "c1", "payment", "2026-11-01"),
    makeEntry("deleted", "c1", "credit", "2026-10-15"),
  ];
  const snapshot = makeSnapshot(entries, { deletedEntries: [{ ...entries[5], deletedAt: "2026-10-20T00:00:00Z" }] });
  const now = new Date(2026, 9, 28, 12);
  const all = reports.buildDownloadReport(snapshot, { kind: "all", customerId: null }, now);
  assert.deepEqual(all.transactions.map((entry) => entry.id), ["old", "first", "middle", "last", "future"]);
  const month = reports.buildDownloadReport(snapshot, { kind: "thisMonth", customerId: null }, now);
  assert.deepEqual(month.transactions.map((entry) => entry.id), ["first", "middle", "last"]);
  assert.deepEqual(month.totals, { udhariGiven: 100, paymentsReceived: 100, advanceRefunded: 100 });
  const customer = reports.buildDownloadReport(snapshot, { kind: "custom", customerId: "c1", fromDate: "2026-10-01", toDate: "2026-10-31" }, now);
  assert.equal(customer.customer.id, "c1");
  assert.deepEqual(customer.transactions.map((entry) => entry.id), ["first", "last"]);
  assert.equal(customer.customers.length, 1);
  assert.equal(customer.transactions.every((entry) => entry.customerName === customers[0].name), true);
});

test("pending offline entries remain in the report with the existing sync classification", () => {
  const entry = makeEntry("offline-entry", "c1", "payment", "2026-10-10");
  const snapshot = makeSnapshot([entry]);
  snapshot.queue = [{ state: "pending", change: { entries: [{ after: entry }] } }];
  const report = reports.buildDownloadReport(snapshot, { kind: "all", customerId: "c1" }, new Date(2026, 9, 28));
  assert.equal(report.transactions.length, 1);
  assert.equal(report.transactions[0].syncState, "pending");
});

test("report exports are complete beyond UI pagination and filename is safe", () => {
  const entries = Array.from({ length: 750 }, (_, index) => makeEntry(`tx-${String(index).padStart(4, "0")}`, "c1", index % 2 ? "payment" : "credit", `2026-10-${String((index % 31) + 1).padStart(2, "0")}`));
  const snapshot = makeSnapshot(entries);
  const beforeLoadMore = reports.buildDownloadReport(snapshot, { kind: "thisMonth", customerId: "c1" }, new Date(2026, 9, 28));
  assert.equal(beforeLoadMore.transactions.length, 750);
  const afterLoadMore = reports.buildDownloadReport(snapshot, { kind: "thisMonth", customerId: "c1" }, new Date(2026, 9, 28));
  assert.deepEqual(afterLoadMore, beforeLoadMore);
  assert.match(reports.downloadReportFilename(beforeLoadMore), /^DigitalKhata_Asha_One_c1_ThisMonth_2026-10\.pdf$/);
});

test("report PDF contains the complete selected-customer information and escaped full transaction history", () => {
  const entries = Array.from({ length: 35 }, (_, index) => makeEntry(`statement-${index}`, "c1", index % 2 ? "payment" : "credit", `2026-10-${String((index % 31) + 1).padStart(2, "0")}`, { note: index === 0 ? "<script>alert('x')</script>" : `Note ${index}`, ...(index === 1 ? { appliedToUdhari: 80, addedToAdvance: 20, advanceApplied: 5, reference: "REF-1" } : {}) }));
  const report = reports.buildDownloadReport(makeSnapshot(entries), { kind: "thisMonth", customerId: "c1" }, new Date(2026, 9, 28));
  const html = reportPdf.downloadReportHtml(report);
  assert.match(html, /Asha &lt;One&gt;/);
  assert.match(html, /9876543210/);
  assert.match(html, /9123456789/);
  assert.match(html, /Main &amp; Market/);
  assert.match(html, /Digital-Khata logo/);
  assert.match(html, /Apurva Software Solutions/);
  assert.match(html, /statement-34/);
  assert.match(html, /Adjusted Against Udhari: ₹80/);
  assert.match(html, /Added to Advance: ₹20/);
  assert.match(html, /Adjusted From Advance: ₹5/);
  assert.match(html, /Reference: REF-1/);
  assert.match(html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
  assert.equal((html.match(/<tr><td>/g) || []).length, 35);
});

test("report builder rejects a snapshot from a different authenticated shop", () => {
  const snapshot = makeSnapshot([]);
  snapshot.data.shop.phone = "6000000000";
  assert.throws(() => reports.buildDownloadReport(snapshot, { kind: "all", customerId: null }), /does not match/);
});

test("empty reports are labeled without transaction rows or invented financial totals", () => {
  const report = reports.buildDownloadReport(makeSnapshot([]), { kind: "custom", customerId: "c1", fromDate: "2026-10-01", toDate: "2026-10-10" }, new Date(2026, 9, 28));
  const html = reportPdf.downloadReportHtml(report);
  assert.match(html, /No transactions found for the selected period/);
  assert.doesNotMatch(html, /Financial Summary|₹0\.00/);
});

test("More routes to Download Reports and every report action builds from the fresh authenticated snapshot", () => {
  const app = readFileSync("App.tsx", "utf8");
  const action = readFileSync("src/DownloadReportActions.tsx", "utf8");
  assert.match(app, /useState<DownloadReportKind>\("all"\)/);
  assert.match(app, /setReportCustomerId\(null\)/);
  assert.match(app, /setReportVisibleCount\(DOWNLOAD_REPORT_PAGE_SIZE\)/);
  assert.match(app, /reportKinds\.map\(/);
  assert.match(app, /setReportPreview\(null\)/);
  assert.match(app, /visibleDownloadReportTransactions\(reportPreview\.transactions, reportVisibleCount\)/);
  assert.match(app, /reportPreview\.transactions\.length > 0 && !reportPreviewLoading/);
  assert.match(app, /No Transactions Found/);
  assert.match(app, /"downloadReports"[\s\S]*"profile"/);
  assert.match(app, /case "downloadReports"/);
  assert.match(app, /buildDownloadReport\(await loadAuthenticatedReceiptSnapshot\(\), request\)/);
  assert.match(action, /const report = await loadReport\(\{ kind, customerId/);
  assert.match(action, /onReportLoaded\?\.\(report\)/);
  assert.match(action, /if \(!report\.transactions\.length\) return/);
  assert.match(action, /run\("download"\)/);
  assert.match(action, /run\("share"\)/);
  assert.match(action, /generateReceiptPdfFromHtml\(downloadReportHtml\(report\)\)/);
  assert.doesNotMatch(action, /visibleEntries|pageRecords|Load More/);
});

test("report preview starts with ten, advances by ten, caps the last page, and does not alter exports", () => {
  const transactions = Array.from({ length: 25 }, (_, index) => ({ id: `tx-${index}` }));
  assert.equal(reportPagination.visibleDownloadReportTransactions(transactions, 10).length, 10);
  assert.equal(reportPagination.nextDownloadReportCount(10, transactions.length), 20);
  assert.equal(reportPagination.visibleDownloadReportTransactions(transactions, 20).length, 20);
  assert.equal(reportPagination.nextDownloadReportCount(20, transactions.length), 25);
  assert.equal(reportPagination.visibleDownloadReportTransactions(transactions, 25).length, 25);
  const all = reports.buildDownloadReport(makeSnapshot(Array.from({ length: 25 }, (_, index) => makeEntry(`tx-${index}`, "c1", "payment", "2026-10-15"))), { kind: "all", customerId: "c1" }, new Date(2026, 9, 28));
  assert.equal(all.transactions.length, 25);
});
