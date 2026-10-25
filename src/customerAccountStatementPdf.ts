import { receiptBrand } from "./receiptBrand";
import { receiptCurrency } from "./transactionReceipt";
import { escapeReceiptHtml } from "./transactionReceiptPdf";
import { receiptLogoDataUri } from "./receiptLogo";
import { t } from "./i18n";
import { localeTag } from "./locales";
import type { CustomerAccountStatement, CustomerStatementTransaction } from "./customerAccountStatement";

const text = (value: unknown) => escapeReceiptHtml(value == null || value === "" ? "Not added" : value);
const optionalField = (label: string, value: unknown) => typeof value === "string" && value.trim()
  ? `<div class="field"><span>${text(label)}</span><strong>${text(value.trim())}</strong></div>` : "";
const amountField = (label: string, amount: number) => `<div class="field"><span>${text(label)}</span><strong>${text(receiptCurrency(amount))}</strong></div>`;
const labels: Record<string, string> = {
  pending: "Pending Sync", failed: "Sync Failed", conflict: "Conflict", server: "Server Confirmed",
  local: "Local Record", unknown: "Sync Status Unavailable",
};
const transactionDetails = (entry: CustomerStatementTransaction, language: string) => {
  const fields: string[] = [];
  if (entry.note?.trim()) fields.push(`${t("Description / Note", language)}: ${entry.note.trim()}`);
  if (entry.method?.trim()) fields.push(`${t("Payment Method", language)}: ${entry.method.trim()}`);
  if (entry.reference?.trim()) fields.push(`${t("Reference", language)}: ${entry.reference.trim()}`);
  if (entry.appliedToUdhari !== undefined) fields.push(`${t("Adjusted Against Udhari", language)}: ${receiptCurrency(entry.appliedToUdhari)}`);
  if (entry.addedToAdvance !== undefined) fields.push(`${t("Added to Advance", language)}: ${receiptCurrency(entry.addedToAdvance)}`);
  if (entry.advanceApplied !== undefined) fields.push(`${t("Adjusted From Advance", language)}: ${receiptCurrency(entry.advanceApplied)}`);
  return fields.length ? fields.join("\n") : "—";
};

export function customerAccountStatementHtml(statement: CustomerAccountStatement): string {
  const language = statement.language;
  const currency = receiptCurrency;
  const tag = localeTag(language);
  const generated = new Date(statement.generatedAt);
  const generatedText = Number.isFinite(generated.getTime())
    ? generated.toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" })
    : t("Not available", language);
  const state = statement.customerState === "active" ? "" : `<div class="status">${text(t(statement.customerState === "removed" ? "Removed" : "Disabled", language))}</div>`;
  const openingFields = [
    statement.opening.date ? `<div class="field"><span>${text(t("Date", language))}</span><strong>${text(statement.opening.date)}</strong></div>` : "",
    statement.opening.udhari !== undefined ? amountField(t("Opening Udhari", language), statement.opening.udhari) : "",
    statement.opening.advance !== undefined ? amountField(t("Opening Advance", language), statement.opening.advance) : "",
    statement.opening.adjustedAgainstUdhari !== undefined ? amountField(t("Opening Advance Adjusted Against Udhari", language), statement.opening.adjustedAgainstUdhari) : "",
    statement.opening.remainingAdvance !== undefined ? amountField(t("Remaining Advance", language), statement.opening.remainingAdvance) : "",
  ].join("");
  const financial = statement.financial;
  const openingSection = openingFields ? `<h3>${text(t("Opening Financial Position", language))}</h3>${openingFields}` : "";
  const summaryRows = [
    amountField(t("Total Udhari", language), financial.totalUdhari),
    amountField(t("Total Money Received", language), financial.totalReceived),
    amountField(t("Udhari Recovered", language), financial.udhariRecovered),
    amountField(t("Advance Deposited", language), financial.advanceDeposited),
    amountField(t("Advance Refunded", language), financial.advanceRefunded),
    amountField(t("Current Outstanding", language), financial.outstanding),
    amountField(t("Available Advance", language), financial.availableAdvance),
  ].join("");
  const runningHeader = statement.runningBalancesAvailable ? `<th>${text(t("Balance After", language))}</th>` : "";
  const rows = statement.transactions.map((entry) => {
    const running = entry.runningAfter
      ? `<td class="balance"><span>${text(t("Current Outstanding", language))}: ${text(currency(entry.runningAfter.outstanding))}</span><span>${text(t("Available Advance", language))}: ${text(currency(entry.runningAfter.advance))}</span></td>`
      : "";
    const sync = statement.queueAvailable ? labels[entry.syncState] : "Sync Status Unavailable";
    return `<tr><td>${text(entry.displayDate)}</td><td>${text(t(entry.label, language))}</td><td class="id">${text(entry.id)}</td><td class="amount">${text(currency(entry.amount))}</td>${running}<td class="details">${text(transactionDetails(entry, language))}</td><td><span class="sync ${text(entry.syncState)}">${text(t(sync, language))}</span></td></tr>`;
  }).join("");
  const emptyHistory = statement.transactions.length ? "" : `<p class="muted">${text(t("No transactions yet", language))}</p>`;
  const historyCaveat = !statement.queueAvailable
    ? `<p class="warning">${text(t("Sync queue could not be read. Pending operations cannot be verified; this document reflects locally available records.", language))}</p>`
    : !statement.runningBalancesAvailable && statement.transactions.length
      ? `<p class="muted">${text(t("Running balances are omitted because the saved ledger does not contain enough information for a reliable historical order.", language))}</p>`
      : statement.runningBalancesAvailable
        ? `<p class="muted">${text(t("Running balances are reconstructed from the currently recorded ledger. Later edits or deletions can change them; they are not immutable historical snapshots.", language))}</p>`
        : "";

  const tableClass = statement.runningBalancesAvailable ? "with-balance" : "without-balance";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    @page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,"Noto Sans Devanagari",sans-serif;color:#203044;margin:0;font-size:9pt;line-height:1.4}header{display:flex;align-items:center;gap:12px;border-bottom:2px solid #15803D;padding-bottom:9px}header img{width:50px;height:50px;object-fit:contain}h1{font-size:17pt;color:#15803D;margin:0}header p{margin:2px 0;color:#475569}.statement-title{margin-left:auto;text-align:right;font-weight:700;color:#15803D;font-size:12pt}h2{font-size:11pt;color:#15803D;border-bottom:1px solid #BBF7D0;padding-bottom:4px;margin:0 0 6px}h3{font-size:9pt;color:#475569;margin:9px 0 3px}section{margin-top:10px;page-break-inside:auto}.field{display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px solid #E2E8F0}.field span{color:#475569}.field strong{text-align:right;max-width:67%;overflow-wrap:anywhere}.fields{display:grid;grid-template-columns:1fr 1fr;column-gap:22px}.customer-name{font-size:13pt;font-weight:700}.status{display:inline-block;margin-top:5px;padding:3px 8px;border-radius:12px;background:#F1F5F9;color:#475569;font-weight:700}.table-wrap{width:100%;overflow:visible}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:7.3pt}thead{display:table-header-group}th{background:#F0FDF4;color:#166534;text-align:left;font-size:7pt}th,td{border:1px solid #CBD5E1;padding:4px 3px;vertical-align:top;overflow-wrap:anywhere;word-break:break-word}tr{page-break-inside:avoid;break-inside:avoid}.with-balance th:nth-child(1){width:12%}.with-balance th:nth-child(2){width:12%}.with-balance th:nth-child(3){width:12%}.with-balance th:nth-child(4){width:10%}.with-balance th:nth-child(5){width:18%}.with-balance th:nth-child(6){width:26%}.with-balance th:nth-child(7){width:10%}.without-balance th:nth-child(1){width:13%}.without-balance th:nth-child(2){width:14%}.without-balance th:nth-child(3){width:14%}.without-balance th:nth-child(4){width:12%}.without-balance th:nth-child(5){width:37%}.without-balance th:nth-child(6){width:10%}.amount{text-align:right;font-weight:700;white-space:nowrap}.id{font-size:6.7pt}.details{white-space:pre-wrap}.balance span{display:block}.sync{display:inline-block;padding:2px 4px;border-radius:8px;font-size:6.5pt;font-weight:700;background:#EFF6FF;color:#1D4ED8}.sync.pending{background:#FFF7ED;color:#C2410C}.sync.failed,.sync.conflict{background:#FEE2E2;color:#B91C1C}.sync.local,.sync.unknown{background:#F1F5F9;color:#475569}.muted,.warning{font-size:8pt;color:#64748B;overflow-wrap:anywhere}.warning{padding:6px;background:#FFF7ED;color:#9A3412}.footer{margin-top:12px;padding-top:7px;border-top:1px solid #CBD5E1;text-align:center;font-size:7.5pt;color:#475569;page-break-inside:avoid}.footer strong{display:block;color:#203044;font-size:9pt}.generated{margin-top:7px;text-align:center;font-size:7pt;color:#64748B}.generated,footer{page-break-inside:avoid}
  </style></head><body>
    <header><img src="${receiptLogoDataUri}" alt="Digital-Khata logo"><div><h1>DIGITAL-KHATA</h1><p>Digital Ledger &amp; Customer Management</p></div><div class="statement-title">${text(t("Customer Account Statement", language))}</div></header>
    <section><h2>${text(t("Shop Information", language))}</h2><div class="fields"><div>${optionalField(t("Shop Name *", language), statement.shop.name)}${optionalField(t("Owner Name *", language), statement.shop.owner)}${optionalField(t("Mobile Number", language), statement.shop.phone)}</div><div>${optionalField(t("WhatsApp Number", language), statement.shop.whatsapp)}${optionalField(t("Address", language), statement.shop.address)}</div></div></section>
    <section><h2>${text(t("Customer Name", language))}</h2><div class="customer-name">${text(statement.customer.name)}</div>${state}<div class="fields"><div>${optionalField(t("Mobile Number", language), statement.customer.phone)}${optionalField(t("WhatsApp Number", language), statement.customer.whatsappNumber)}</div><div>${optionalField(t("Address", language), statement.customer.address)}</div></div></section>
    <section><h2>${text(t("Financial Summary", language))}</h2>${openingSection}${summaryRows}</section>
    <section><h2>${text(t("Transaction History", language))} (${statement.transactions.length})</h2>${historyCaveat}${emptyHistory}<div class="table-wrap"><table class="${tableClass}"><thead><tr><th>${text(t("Date", language))}</th><th>${text(t("Transaction", language))}</th><th>${text(t("Transaction ID", language))}</th><th>${text(t("Amount", language))}</th>${runningHeader}<th>${text(t("Description / Note", language))}</th><th>${text(t("Sync", language))}</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <footer class="footer">${text(t("Developed by", language))}<strong>${text(receiptBrand.company)}</strong>${text(receiptBrand.registration)}<br>${text(t("Website", language))}: ${text(receiptBrand.website)} · ${text(t("Email", language))}: ${text(receiptBrand.email)}<br>${text(t("Phone", language))}: ${text(receiptBrand.mobile)} · WhatsApp: ${text(receiptBrand.whatsapp)}</footer>
    <p class="generated">${text(t("Statement generated on", language))}: ${text(generatedText)}<br>${text(t("This statement reflects the locally available Digital-Khata customer and transaction records at generation time.", language))}</p>
  </body></html>`;
}

export function safeCustomerStatementFilename(statement: CustomerAccountStatement) {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 70) || "customer";
  return `DigitalKhata_Customer_Statement_${safe(statement.customer.name)}_${safe(statement.customer.id)}.pdf`;
}
