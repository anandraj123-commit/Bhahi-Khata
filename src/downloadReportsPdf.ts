import { receiptBrand } from "./receiptBrand";
import { receiptCurrency } from "./transactionReceipt";
import { escapeReceiptHtml } from "./transactionReceiptPdf";
import { receiptLogoDataUri } from "./receiptLogo";
import { t } from "./i18n";
import { localeTag } from "./locales";
import { reportRangeLabel, type DownloadReport } from "./downloadReports";

const esc = (value: unknown) => escapeReceiptHtml(value == null || value === "" ? "Not added" : value);
const reportTitles: Record<DownloadReport["kind"], string> = {
  all: "All Transactions", today: "Today", thisMonth: "This Month", lastMonth: "Last Month", custom: "Custom Date Range",
};
const syncLabels: Record<string, string> = {
  pending: "Pending Sync", failed: "Sync Failed", conflict: "Conflict", server: "Server Confirmed", local: "Local Record", unknown: "Sync Status Unavailable",
};
const amount = (value: number) => esc(receiptCurrency(value));
const detailsFor = (entry: DownloadReport["transactions"][number], language: string) => [
  entry.note?.trim(),
  entry.method?.trim() ? `${t("Payment Method", language)}: ${entry.method.trim()}` : "",
  entry.reference?.trim() ? `${t("Reference", language)}: ${entry.reference.trim()}` : "",
  entry.appliedToUdhari !== undefined ? `${t("Adjusted Against Udhari", language)}: ${receiptCurrency(entry.appliedToUdhari)}` : "",
  entry.addedToAdvance !== undefined ? `${t("Added to Advance", language)}: ${receiptCurrency(entry.addedToAdvance)}` : "",
  entry.advanceApplied !== undefined ? `${t("Adjusted From Advance", language)}: ${receiptCurrency(entry.advanceApplied)}` : "",
].filter(Boolean).join("\n") || "—";

export function downloadReportHtml(report: DownloadReport): string {
  const lang = report.language;
  const tag = localeTag(lang);
  const period = reportRangeLabel(report, lang);
  const generated = new Date(report.generatedAt);
  const generatedText = Number.isFinite(generated.getTime())
    ? generated.toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" }) : t("Not available", lang);
  const customerSection = report.customer
    ? `<section><h2>${esc(t("Customer Information", lang))}</h2><div class="customer"><strong>${esc(report.customer.name)}</strong><span>${esc(t(report.customerStates[report.customer.id] === "active" ? "Active" : report.customerStates[report.customer.id] === "removed" ? "Removed" : "Disabled", lang))}</span></div><div class="fields"><div>${field("Mobile Number", report.customer.phone, lang)}${field("WhatsApp Number", report.customer.whatsappNumber, lang)}</div><div>${field("Address", report.customer.address, lang)}</div></div></section>`
    : `<section><h2>${esc(t("Customers", lang))} (${report.customers.length})</h2><div class="customer-list">${report.customers.map((customer) => `<div><strong>${esc(customer.name)}</strong><span>${esc(customer.phone || t("Not added", lang))}</span>${customer.whatsappNumber ? `<span>${esc(t("WhatsApp Number", lang))}: ${esc(customer.whatsappNumber)}</span>` : ""}${customer.address ? `<span>${esc(customer.address)}</span>` : ""}</div>`).join("") || `<p>${esc(t("All Customers", lang))}</p>`}</div></section>`;
  const totals = report.transactions.length ? `<section><h2>${esc(t("Transactions", lang))}</h2><div class="totals"><div>${esc(t("Udhari Given", lang))}<strong>${amount(report.totals.udhariGiven)}</strong></div><div>${esc(t("Payment Received", lang))}<strong>${amount(report.totals.paymentsReceived)}</strong></div><div>${esc(t("Advance Refunded", lang))}<strong>${amount(report.totals.advanceRefunded)}</strong></div></div></section>` : "";
  const empty = report.transactions.length ? "" : `<tr><td colspan="7" class="empty">${esc(t("No transactions found for the selected period.", lang))}</td></tr>`;
  const rows = report.transactions.map((entry) => `<tr><td>${esc(entry.displayDate)}</td><td>${esc(entry.customerName)}</td><td>${esc(t(entry.label, lang))}</td><td class="id">${esc(entry.id)}</td><td class="amount">${amount(entry.amount)}</td><td class="details">${esc(detailsFor(entry, lang))}</td><td>${esc(t(syncLabels[entry.syncState] || "Sync Status Unavailable", lang))}</td></tr>`).join("");
  const queueNote = report.queueAvailable ? "" : `<p class="caption">${esc(t("Synchronization status is unavailable for some local records.", lang))}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:22mm 14mm 20mm}*{box-sizing:border-box}body{font-family:Arial,"Noto Sans",sans-serif;color:#203044;font-size:10px;line-height:1.45;margin:0}
    header{display:flex;align-items:center;gap:12px;border-bottom:2px solid #15803d;padding-bottom:12px;margin-bottom:16px}header img{width:54px;height:54px;object-fit:contain}header h1{font-size:19px;margin:0;color:#166534}header p{margin:2px 0 0;color:#475569}.report-title{margin-left:auto;text-align:right;font-size:15px;font-weight:800}
    section{border:1px solid #dbe5e1;border-radius:8px;padding:11px 12px;margin:0 0 12px;break-inside:avoid}h2{font-size:12px;color:#166534;margin:0 0 8px;text-transform:uppercase}.meta,.fields,.totals{display:grid;grid-template-columns:1fr 1fr;gap:7px 16px}.field{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid #edf1ef}.field span{color:#475569}.field strong{text-align:right;overflow-wrap:anywhere}.customer{display:flex;justify-content:space-between;gap:10px;margin-bottom:8px;font-size:12px}.customer-list{display:grid;grid-template-columns:1fr 1fr;gap:8px}.customer-list>div{border:1px solid #e2e8f0;border-radius:6px;padding:7px;display:flex;flex-direction:column;overflow-wrap:anywhere}.totals>div{background:#f8fafc;padding:8px;border-radius:6px;display:flex;justify-content:space-between;gap:6px}.caption{font-size:8px;color:#64748b;margin:7px 0 0}.table-wrap{width:100%}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8px}thead{display:table-header-group}th{background:#f1f5f9;text-align:left;color:#334155;padding:6px 4px;border-bottom:1px solid #cbd5e1}td{padding:6px 4px;vertical-align:top;border-bottom:1px solid #e2e8f0;overflow-wrap:anywhere;white-space:pre-wrap}tr{break-inside:avoid}th:nth-child(1){width:12%}th:nth-child(2){width:13%}th:nth-child(3){width:13%}th:nth-child(4){width:14%}th:nth-child(5){width:11%}th:nth-child(6){width:23%}th:nth-child(7){width:14%}.amount{text-align:right;white-space:nowrap;font-weight:700}.id{font-size:7px}.empty{text-align:center;color:#64748b;padding:18px}.footer{border-top:1px solid #cbd5e1;padding-top:8px;text-align:center;font-size:8px;color:#475569}.footer strong{display:block;color:#203044;font-size:10px}.generated{text-align:center;font-size:8px;color:#64748b;margin-top:7px}
    </style></head><body><header><img src="${receiptLogoDataUri}" alt="Digital-Khata logo"><div><h1>DIGITAL-KHATA</h1></div><div class="report-title">${esc(t("Transaction", lang))} ${esc(t("Reports", lang))}</div></header>
    <section><h2>${esc(t(reportTitles[report.kind], lang))}</h2><div class="meta"><div class="field"><span>${esc(t("Shop Name", lang))}</span><strong>${esc(report.shop.name)}</strong></div><div class="field"><span>${esc(t("Customer Filter", lang))}</span><strong>${esc(report.customer?.name || t("All Customers", lang))}</strong></div><div class="field"><span>${esc(t("Report Period", lang))}</span><strong>${esc(period)}</strong></div><div class="field"><span>${esc(t("Transactions", lang))}</span><strong>${report.transactions.length}</strong></div></div>${report.shop.phone ? `<div class="field"><span>${esc(t("Shop Mobile Number", lang))}</span><strong>${esc(report.shop.phone)}</strong></div>` : ""}${report.shop.address ? `<div class="field"><span>${esc(t("Address", lang))}</span><strong>${esc(report.shop.address)}</strong></div>` : ""}</section>
    ${customerSection}${totals}${queueNote}<section><h2>${esc(t("Transaction History", lang))} (${report.transactions.length})</h2><div class="table-wrap"><table><thead><tr><th>${esc(t("Date", lang))}</th><th>${esc(t("Customer", lang))}</th><th>${esc(t("Transaction", lang))}</th><th>${esc(t("Transaction ID", lang))}</th><th>${esc(t("Amount", lang))}</th><th>${esc(t("Description / Note", lang))}</th><th>${esc(t("Sync", lang))}</th></tr></thead><tbody>${empty}${rows}</tbody></table></div></section>
    <footer class="footer">${esc(t("Developed by", lang))}<strong>${esc(receiptBrand.company)}</strong>${esc(receiptBrand.registration)}<br>${esc(t("Website", lang))}: ${esc(receiptBrand.website)} · ${esc(t("Email", lang))}: ${esc(receiptBrand.email)}<br>${esc(t("Phone", lang))}: ${esc(receiptBrand.mobile)}</footer><p class="generated">${esc(t("Report generated on", lang))}: ${esc(generatedText)}</p></body></html>`;
}

function field(label: string, value: string | undefined, language: string) {
  return value?.trim() ? `<div class="field"><span>${esc(t(label, language))}</span><strong>${esc(value.trim())}</strong></div>` : "";
}
