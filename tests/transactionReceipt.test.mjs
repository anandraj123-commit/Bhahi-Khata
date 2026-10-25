import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import loadTs from './helpers/loadTs.cjs';

const modules = loadTs('src/transactionReceipt.ts', {
  'expo-crypto': { randomUUID: () => 'test-id' },
});
const { authorizeReceiptAccess, buildTransactionReceipt, receiptDateTime, reconstructReceiptHistory, resolveReceiptAccountId } = modules;

const customer = {
  id: 'customer-1', status: true, disabled: false, removed: false,
  name: 'Asha Customer', phone: '9876543210', whatsappNumber: '9123456789',
  address: 'Gandhi Maidan, Gaya', opening: 0, openingAdvance: 0, limit: 0, reminder: false,
};
const shop = { name: 'Asha Stores', phone: '6203253537', whatsapp: '', address: 'Gaya', owner: 'Asha' };
const entry = (id, type, amount, date, time = `${date}T10:00:00.000Z`, extra = {}) => ({
  id, customerId: customer.id, type, amount, date, recordedAt: time,
  note: '', method: 'Cash', ...extra,
});
const credit10 = entry('credit-10', 'credit', 3000, '2026-10-10');
const credit15 = entry('credit-15', 'credit', 2500, '2026-10-15');
const later20 = entry('payment-20', 'payment', 2000, '2026-10-20');
const later25 = entry('payment-25', 'payment', 1000, '2026-10-25');
const data = (entries, overrides = {}) => ({
  shop, shopExists: true, customers: [customer], entries, audit: [], signedIn: true,
  language: 'English', reminders: { enabled: false, day: '', time: '', minimum: '', whatsapp: false, sms: false },
  defaultMethod: 'Cash', read: [], ...overrides,
});
const snapshot = (entries, overrides = {}) => ({
  accountId: '6203253537', data: data(entries, overrides), queue: [],
});
const createQueueChange = (e) => ({
  customers: [], entries: [{ operation: 'create', after: e }], audit: [], read: [],
});

test('receipt uses exact selected transaction, shop-scoped customer, and recorded effective date', () => {
  const receipt = buildTransactionReceipt(snapshot([credit10, credit15, later20]), credit15.id, new Date('2026-10-26T09:00:00Z'));
  assert.equal(receipt.entry.id, credit15.id);
  assert.equal(receipt.customer.id, customer.id);
  assert.equal(receipt.shop.name, shop.name);
  assert.equal(receipt.label, 'Udhari Given');
  assert.equal(receipt.date, '15 October 2026');
  assert.equal(receipt.generatedAt, '2026-10-26T09:00:00.000Z');
  assert.equal(receipt.pendingSync, undefined);
});

test('receipt authorization accepts an already authenticated shop and valid offline session without ref login', () => {
  const active = data([credit10]);
  assert.equal(resolveReceiptAccountId(active, null, null, false), '6203253537');
  assert.equal(resolveReceiptAccountId(active, null, { accountId: '916203253537' }, true), '916203253537');
  assert.throws(() => resolveReceiptAccountId(active, null, null, true), /offline authorization has expired/);
  assert.throws(() => resolveReceiptAccountId(active, '1111111111', null, false), /does not match/);
  assert.equal(authorizeReceiptAccess(active, '+91 62032-53537', null, false), true);
  assert.equal(authorizeReceiptAccess(active, '6203253537', { accountId: '916203253537' }, true), true);
  assert.throws(() => authorizeReceiptAccess(active, '6203253537', null, true), /offline authorization has expired/);
  assert.throws(() => authorizeReceiptAccess(active, '1111111111', null, false), /does not match/);
  assert.throws(() => authorizeReceiptAccess(active, '6203253537', { accountId: '1111111111' }, false), /different shop/);
});

test('historical outstanding excludes transactions after the selected entry', () => {
  const history = reconstructReceiptHistory(snapshot([credit10, credit15, later20, later25]), customer, credit15).history;
  assert.deepEqual(history.before, { outstanding: 3000, advance: 0 });
  assert.deepEqual(history.after, { outstanding: 5500, advance: 0 });
  assert.match(history.explanation, /currently recorded ledger/);
});

test('existing financial rules reconstruct advance and payment allocations', () => {
  const deposit = entry('deposit', 'payment', 4000, '2026-10-10');
  const debt = entry('debt', 'credit', 2500, '2026-10-11');
  const summary = reconstructReceiptHistory(snapshot([deposit, debt]), customer, debt).history;
  assert.deepEqual(summary.before, { outstanding: 0, advance: 4000 });
  assert.deepEqual(summary.after, { outstanding: 0, advance: 1500 });
});

test('opening amounts are applied only from their recorded effective date', () => {
  const opened = { ...customer, opening: 500, openingAdvance: 100, openingDate: '2026-10-15' };
  const history = reconstructReceiptHistory(snapshot([credit15], { customers: [opened] }), opened, credit15).history;
  assert.deepEqual(history.before, { outstanding: 400, advance: 0 });
  assert.deepEqual(history.after, { outstanding: 2900, advance: 0 });
});

test('ambiguous same-day ordering and unresolved sync conflicts omit history', () => {
  const undated = { ...credit15, recordedAt: undefined };
  assert.ok(reconstructReceiptHistory(snapshot([undated, later20]), customer, undated).history);
  const sameDay = { ...entry('same-day', 'payment', 50, '2026-10-15'), recordedAt: undefined };
  assert.match(reconstructReceiptHistory(snapshot([credit15, sameDay]), customer, credit15).historyUnavailable, /timestamp/);
  const conflicted = snapshot([credit10, credit15], {
    queue: undefined,
  });
  conflicted.queue = [{ state: 'conflict', change: { customers: [], entries: [{ operation: 'update', before: credit10, after: credit10 }], audit: [], read: [] } }];
  assert.match(reconstructReceiptHistory(conflicted, customer, credit15).historyUnavailable, /conflicts/);
});

test('offline-created entries are labeled pending sync only while the queue marks them pending', () => {
  const local = entry('local-uuid', 'payment', 500, '2026-10-26');
  const before = JSON.stringify([local]);
  const receipt = buildTransactionReceipt({ ...snapshot([local]), queue: [{ state: 'pending', change: createQueueChange(local) }] }, local.id);
  assert.equal(receipt.pendingSync, true);
  assert.equal(receipt.entry.id, 'local-uuid');
  assert.equal(JSON.stringify([local]), before);
  const failed = buildTransactionReceipt({ ...snapshot([local]), queue: [{ state: 'failed', change: createQueueChange(local) }] }, local.id);
  assert.equal(failed.pendingSync, undefined);
  const conflict = buildTransactionReceipt({ ...snapshot([local]), queue: [{ state: 'conflict', change: createQueueChange(local) }] }, local.id);
  assert.equal(conflict.pendingSync, undefined);
});

test('memory fallback with active online authentication omits unverified sync status and history', () => {
  const cached = { ...snapshot([credit15]), accountId: '916203253537', queueAvailable: false };
  const receipt = buildTransactionReceipt(cached, credit15.id);
  assert.equal(receipt.pendingSync, undefined);
  assert.equal(receipt.history, undefined);
  assert.match(receipt.historyUnavailable, /synchronization queue/);
});

test('missing, cross-shop, and duplicate transaction data fail without substitution', () => {
  assert.throws(() => buildTransactionReceipt(snapshot([credit10]), 'missing'), /not available/);
  assert.throws(() => buildTransactionReceipt({ ...snapshot([credit10]), accountId: '1111111111' }, credit10.id), /shop/);
  assert.throws(() => buildTransactionReceipt(snapshot([credit10, { ...credit10 }]), credit10.id), /ambiguous/);
});

test('date/time rendering never fabricates transaction time from PDF generation time', () => {
  assert.deepEqual(receiptDateTime({ date: '2026-10-15' }), {
    date: '15 October 2026', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  assert.equal(receiptDateTime({ date: '2026-10-15', recordedAt: '2026-10-14T00:00:00Z' }).time, undefined);
  assert.equal(receiptDateTime({ date: '2026-10-15', createdAt: '2026-10-15T10:00:00Z' }).time !== undefined, true);
  assert.equal(receiptDateTime({ date: '2026-10-15', createdAt: '2026-10-14T10:00:00Z' }).time, undefined);
});

test('PDF content embeds bundled logo, escapes customer text, includes required branding, and sanitizes filename', () => {
  const pdf = loadTs('src/transactionReceiptPdf.ts', { './transactionReceipt': modules });
  const receipt = buildTransactionReceipt(snapshot([{ ...credit15, amount: 2500, note: '<script>alert("x")</script>' }]), credit15.id,
    new Date('2026-10-26T09:00:00Z'));
  const html = pdf.transactionReceiptHtml(receipt);
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /DIGITAL-KHATA/);
  assert.match(html, /Asha Stores/);
  assert.match(html, /WhatsApp Number/);
  assert.match(html, /15 October 2026/);
  assert.match(html, /₹2,500\.00/);
  assert.match(html, /Apurva Software Solutions/);
  assert.match(html, /\+91 6203253537/);
  assert.match(html, /\+91 8797044416/);
  assert.match(html, /supports@apurvasoftwaresolutions\.com/);
  assert.match(html, /www\.apurvasoftwaresolutions\.com/);
  assert.match(html, /Receipt Generated On/);
  assert.doesNotMatch(html, /<span>Status<\/span>|SYNCED|COMPLETED|SUCCESSFUL/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.equal(pdf.safeReceiptFilename('2026/10/15', '../TXN 001'), 'DigitalKhata_Receipt_2026_10_15_TXN_001.pdf');
});

test('Home route opens the exact entry and details actions use only local snapshot/PDF APIs', () => {
  const app = readFileSync('App.tsx', 'utf8');
  const detail = readFileSync('src/TransactionDetails.tsx', 'utf8');
  const exportSource = readFileSync('src/transactionReceiptExport.ts', 'utf8');
  const store = readFileSync('src/offlineStore.ts', 'utf8');
  assert.match(app, /const entry = data\.entries\.find\(\(e\) => e\.id === route\.id\)/);
  assert.match(app, /resolveReceiptAccountId\(initialData, preferredAccountId, session, requireOfflineSession\)/);
  assert.match(app, /const allowMissingOfflineSession = currentConnectivity\(\) === "online"/);
  assert.match(app, /content = <TransactionDetails[\s\S]*?entry=\{selectedEntry\}[\s\S]*?loadReceipt=\{loadTransactionReceipt\}/);
  assert.match(detail, /<CustomerContactInfo customer=\{customer\} compact \/>/);
  assert.doesNotMatch(detail, /title="Status"/);
  assert.match(detail, /title="Download PDF"[\s\S]*?title="Share PDF"/);
  assert.match(exportSource, /mimeType: "application\/pdf"/);
  assert.match(detail, /saveReceiptPdfToAndroid\(generated\.base64/);
  assert.match(store, /SELECT record_json FROM local_ledger WHERE account_id = \?/);
  assert.match(store, /SELECT state, change_json FROM sync_queue WHERE account_id = \?/);
  assert.doesNotMatch(detail, /api\.|fetch\(/);
});

test('pending sync indicator is shared by details and PDF and old entries remain status-free', () => {
  const detail = readFileSync('src/TransactionDetails.tsx', 'utf8');
  const pdfSource = readFileSync('src/transactionReceiptPdf.ts', 'utf8');
  const pdf = loadTs('src/transactionReceiptPdf.ts', { './transactionReceipt': modules });
  const queued = { ...snapshot([credit15]), queue: [{ state: 'pending', change: createQueueChange(credit15) }] };
  const queuedReceipt = buildTransactionReceipt(queued, credit15.id);
  assert.match(detail, /receipt\?\.pendingSync[\s\S]*?Pending Sync/);
  assert.match(pdf.transactionReceiptHtml(queuedReceipt), /PENDING SYNC/);
  const legacyReceipt = buildTransactionReceipt(snapshot([{ ...credit15, serverVersion: 4 }]), credit15.id);
  assert.equal(legacyReceipt.pendingSync, undefined);
  assert.doesNotMatch(pdf.transactionReceiptHtml(legacyReceipt), /PENDING SYNC|<span>Status<\/span>/);
  assert.doesNotMatch(pdfSource, /receipt\.status|<span>Status<\/span>/);
});
