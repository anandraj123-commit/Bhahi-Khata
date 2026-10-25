import { receiptBrand } from "./receiptBrand";
import { receiptCurrency, type TransactionReceipt } from "./transactionReceipt";
import { receiptLogoDataUri } from "./receiptLogo";

export function escapeReceiptHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]!);
}
const optional = (label: string, value: unknown) => typeof value === "string" && value.trim()
  ? `<div class="field"><span>${escapeReceiptHtml(label)}</span><strong>${escapeReceiptHtml(value.trim())}</strong></div>` : "";
const amount = (value: number) => escapeReceiptHtml(receiptCurrency(value));

export function transactionReceiptHtml(receipt: TransactionReceipt): string {
  const entry = receipt.entry;
  const balanceSection = receipt.history ? `
    <section><h2>Historical Balance Summary</h2>
      <div class="field"><span>Outstanding Before</span><strong>${amount(receipt.history.before.outstanding)}</strong></div>
      <div class="field"><span>Available Advance Before</span><strong>${amount(receipt.history.before.advance)}</strong></div>
      <div class="field"><span>Transaction Amount</span><strong>${amount(entry.amount)}</strong></div>
      <div class="field"><span>Outstanding After</span><strong>${amount(receipt.history.after.outstanding)}</strong></div>
      <div class="field"><span>Available Advance After</span><strong>${amount(receipt.history.after.advance)}</strong></div>
      <p class="muted">${escapeReceiptHtml(receipt.history.explanation)}</p>
    </section>` : "";
  const timestamp = new Date(receipt.generatedAt);
  const generated = Number.isFinite(timestamp.getTime())
    ? `${timestamp.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} (${escapeReceiptHtml(receipt.timeZone)})`
    : "Not available";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    @page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,"Noto Sans Devanagari",sans-serif;color:#203044;margin:0;font-size:11pt;line-height:1.45}header{display:flex;align-items:center;gap:14px;border-bottom:2px solid #15803D;padding-bottom:12px}header img{width:64px;height:64px;object-fit:contain}h1{font-size:20pt;color:#15803D;margin:0}header p{margin:2px 0;color:#475569}.receipt{margin-left:auto;text-align:right;color:#15803D;font-weight:700;font-size:14pt}h2{font-size:12pt;color:#15803D;border-bottom:1px solid #BBF7D0;padding-bottom:4px;margin:0 0 8px}section{margin-top:13px;page-break-inside:avoid}.field{display:flex;justify-content:space-between;gap:16px;padding:4px 0;border-bottom:1px solid #E2E8F0}.field span{color:#475569}.field strong{text-align:right;max-width:65%;overflow-wrap:anywhere}.amount{font-size:17pt;color:#15803D}.pending-sync{display:inline-block;border:1px solid #FED7AA;background:#FFF7ED;color:#C2410C;padding:4px 9px;border-radius:14px;font-weight:700;margin-top:8px}.note{white-space:pre-wrap;overflow-wrap:anywhere}.muted{font-size:9pt;color:#64748B;overflow-wrap:anywhere}.footer{margin-top:16px;padding-top:9px;border-top:1px solid #CBD5E1;text-align:center;font-size:8.5pt;color:#475569;page-break-inside:avoid}.footer strong{display:block;color:#203044;font-size:10pt}.generated{margin-top:9px;text-align:center;font-size:8pt;color:#64748B}.field,.note{overflow-wrap:anywhere}
  </style></head><body>
    <header><img src="${receiptLogoDataUri}" alt="Digital-Khata logo"><div><h1>DIGITAL-KHATA</h1><p>Digital Ledger &amp; Customer Management</p></div><div class="receipt">TRANSACTION<br>RECEIPT</div></header>
    <section><h2>Business Details</h2><div class="field"><span>Shop</span><strong>${escapeReceiptHtml(receipt.shop.name || "Not added")}</strong></div>${optional("Mobile", receipt.shop.phone)}${optional("Address", receipt.shop.address)}</section>
    <section><h2>Customer Details</h2><div class="field"><span>Name</span><strong>${escapeReceiptHtml(receipt.customer.name)}</strong></div>${optional("Mobile Number", receipt.customer.phone)}${optional("WhatsApp Number", receipt.customer.whatsappNumber)}${optional("Address", receipt.customer.address)}</section>
    <section><h2>Transaction Details</h2><div class="field"><span>Transaction ID</span><strong>${escapeReceiptHtml(entry.id)}</strong></div><div class="field"><span>Transaction Date</span><strong>${escapeReceiptHtml(receipt.date)}</strong></div>${receipt.time ? `<div class="field"><span>Transaction Time</span><strong>${escapeReceiptHtml(receipt.time)} (${escapeReceiptHtml(receipt.timeZone)})</strong></div>` : ""}<div class="field"><span>Type</span><strong>${escapeReceiptHtml(receipt.label)}</strong></div><div class="field"><span>Amount</span><strong class="amount">${amount(entry.amount)}</strong></div>${optional("Payment Mode", entry.method)}${optional("Reference", entry.reference)}${entry.note?.trim() ? `<div class="field"><span>Description / Notes</span><strong class="note">${escapeReceiptHtml(entry.note.trim())}</strong></div>` : ""}${receipt.pendingSync ? `<p class="pending-sync">PENDING SYNC</p>` : ""}</section>
    ${balanceSection}
    <div class="footer">Developed &amp; Powered By<strong>${escapeReceiptHtml(receiptBrand.company)}</strong>${escapeReceiptHtml(receiptBrand.registration)}<br>Mobile: ${escapeReceiptHtml(receiptBrand.mobile)} · WhatsApp: ${escapeReceiptHtml(receiptBrand.whatsapp)}<br>${escapeReceiptHtml(receiptBrand.email)} · ${escapeReceiptHtml(receiptBrand.website)}</div>
    <p class="generated">Receipt Generated On: ${escapeReceiptHtml(generated)}<br>This receipt reflects the transaction information recorded in Digital-Khata. This is not a GST invoice.</p>
  </body></html>`;
}

export function safeReceiptFilename(date: string, transactionId: string) {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "transaction";
  return `DigitalKhata_Receipt_${safe(date)}_${safe(transactionId)}.pdf`;
}
