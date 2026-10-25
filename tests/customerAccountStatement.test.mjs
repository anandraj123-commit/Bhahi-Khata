import assert from 'node:assert/strict';
import test from 'node:test';
import loadTs from './helpers/loadTs.cjs';

const model = loadTs('src/model.ts', { 'expo-crypto': { randomUUID: () => 'test-id' } });
const receipt = loadTs('src/transactionReceipt.ts', { './model': model });
const lifecycle = loadTs('src/customerLifecycle.ts', { './model': model });
const presentation = loadTs('src/entryPresentation.ts', { './model': model });
const locales = loadTs('src/locales.ts');
const statementModule = loadTs('src/customerAccountStatement.ts', {
  './model': model,
  './customerLifecycle': lifecycle,
  './entryPresentation': presentation,
  './locales': locales,
  './transactionReceipt': receipt,
});
const pdfModule = loadTs('src/customerAccountStatementPdf.ts', {
  './receiptBrand': { receiptBrand: { company: 'Apurva Software Solutions', registration: 'MSME Registered', mobile: '+91 6203253537', whatsapp: '+91 8797044416', email: 'supports@apurvasoftwaresolutions.com', website: 'www.apurvasoftwaresolutions.com' } },
  './transactionReceipt': receipt,
  './transactionReceiptPdf': { escapeReceiptHtml: (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]) },
  './receiptLogo': { receiptLogoDataUri: 'data:image/png;base64,bG9nbw==' },
  './i18n': { t: (key) => key },
  './locales': locales,
  './customerAccountStatement': statementModule,
});

const customer = {
  id: 'cust-1', status: true, disabled: false, removed: false, name: 'Asha <Shopper>',
  phone: '9876543210', whatsappNumber: '9123456789', address: 'Main & Market',
  opening: 0, openingAdvance: 0, limit: 0, reminder: false, createdAt: '2026-01-01T00:00:00.000Z',
};
const entry = (id, type = 'credit', amount = 100, index = 0, fields = {}) => {
  const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
  return { id, customerId: customer.id, type, amount, date, recordedAt: `${date}T10:00:00.000Z`, note: '', method: 'Cash', ...fields };
};
const snapshot = (entries = [], overrides = {}) => ({
  accountId: '6203253537', queue: [],
  data: {
    shop: { name: 'Asha Stores', owner: 'Asha', phone: '6203253537', whatsapp: '', address: 'Gaya' },
    shopExists: true, customers: [customer], entries, deletedEntries: [], audit: [], signedIn: true,
    language: 'English', reminders: { enabled: false, day: '', time: '', minimum: '', whatsapp: false, sms: false },
    defaultMethod: 'Cash', read: [], ...overrides,
  },
});

test('statement exports every active local transaction independently of Customer Details pagination', () => {
  for (const count of [0, 9, 10, 11, 25, 100, 500, 1000]) {
    const entries = Array.from({ length: count }, (_, index) => entry(`txn-${String(index).padStart(4, '0')}`, 'credit', index + 1, index));
    const statement = statementModule.buildCustomerAccountStatement(snapshot(entries), customer.id, new Date('2026-10-26T10:00:00Z'));
    assert.equal(statement.transactions.length, count);
    if (count) assert.equal(statement.transactions[0]?.id, 'txn-0000');
    assert.equal(statement.transactions.at(-1)?.id, count ? `txn-${String(count - 1).padStart(4, '0')}` : undefined);
  }
});

test('financial summary uses the existing selectors and matches the detail-card values including opening advances', () => {
  const opened = { ...customer, opening: 300, openingAdvance: 500 };
  const entries = [entry('credit-1', 'credit', 200, 0), entry('payment-1', 'payment', 150, 1), entry('refund-1', 'refund', 25, 2)];
  const data = { ...snapshot(entries, { customers: [opened] }).data };
  const summary = model.financialSummary(data, opened.id);
  const statement = statementModule.buildCustomerAccountStatement({ ...snapshot(entries, { customers: [opened] }), data }, opened.id);
  assert.equal(statement.financial.totalUdhari, model.totalUdhari(data, opened.id));
  assert.equal(statement.financial.totalReceived, summary.totalReceivedPaise / 100);
  assert.equal(statement.financial.udhariRecovered, summary.totalUdhariRecoveredPaise / 100);
  assert.equal(statement.financial.advanceDeposited, summary.totalAdvanceDepositedPaise / 100);
  assert.equal(statement.financial.advanceRefunded, summary.totalAdvanceRefundedPaise / 100);
  assert.equal(statement.financial.outstanding, summary.outstandingPaise / 100);
  assert.equal(statement.financial.availableAdvance, summary.availableAdvancePaise / 100);
  assert.deepEqual(statement.opening, { date: '2026-01-01', udhari: 300, advance: 500, adjustedAgainstUdhari: 300, remainingAdvance: 200 });
});

test('opening advance is independently included when there is no opening Udhari and optional contact values stay optional', () => {
  const opened = { ...customer, opening: 0, openingAdvance: 500, phone: '', whatsappNumber: '', address: '' };
  const statement = statementModule.buildCustomerAccountStatement(snapshot([], { customers: [opened] }), opened.id);
  assert.deepEqual(statement.opening, { date: '2026-01-01', advance: 500 });
  const html = pdfModule.customerAccountStatementHtml(statement);
  assert.match(html, /Opening Advance/);
  assert.doesNotMatch(html, /Opening Advance Adjusted Against Udhari/);
  assert.doesNotMatch(html, /9876543210|9123456789|Main &amp; Market/);
});

test('deleted entries are excluded, restored active records and pending offline entries are included once', () => {
  const deleted = entry('deleted-1', 'credit', 900, 0);
  const restored = entry('restored-1', 'payment', 40, 1, { serverVersion: 3 });
  const pending = entry('pending-1', 'credit', 60, 2);
  const activeEntries = [{ ...deleted, deletedAt: '2026-01-04T10:00:00Z' }, restored, pending];
  const data = {
    ...snapshot(activeEntries, { deletedEntries: [{ ...deleted, deletedAt: '2026-01-04T10:00:00Z' }] }).data,
  };
  // A valid synchronized cache stores tombstones outside the active entries array.
  data.entries = [restored, pending];
  const queue = [{ state: 'pending', change: { customers: [], entries: [{ operation: 'create', after: pending }], audit: [], read: [] } }];
  const statement = statementModule.buildCustomerAccountStatement({ accountId: '6203253537', data, queue }, customer.id);
  assert.deepEqual(statement.transactions.map((item) => item.id), ['restored-1', 'pending-1']);
  assert.equal(statement.transactions[1].syncState, 'pending');
  assert.equal(statement.transactions[0].syncState, 'server');
});

test('statement HTML contains the complete customer, shop, financial, history, logo, company details, and escapes user content', () => {
  const e = entry('txn-html', 'payment', 2500, 0, { note: '<script>alert(1)</script>', reference: 'REF-1', appliedToUdhari: 2000, addedToAdvance: 500 });
  const statement = statementModule.buildCustomerAccountStatement(snapshot([e]), customer.id);
  const html = pdfModule.customerAccountStatementHtml(statement);
  for (const value of ['data:image/png;base64,bG9nbw==', 'DIGITAL-KHATA', 'Asha Stores', 'Asha &lt;Shopper&gt;', '9876543210', '9123456789', 'Main &amp; Market', 'Total Money Received', 'Available Advance', 'txn-html', 'Payment Received', '₹2,500.00', 'REF-1', 'Apurva Software Solutions', 'supports@apurvasoftwaresolutions.com', 'www.apurvasoftwaresolutions.com']) assert.ok(html.includes(value), value);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /<thead>/);
  assert.match(html, /page-break-inside:avoid/);
});

test('missing local customer and cross-shop data are rejected without substituting another record', () => {
  assert.throws(() => statementModule.buildCustomerAccountStatement(snapshot([]), 'missing'), /not available/);
  assert.throws(() => statementModule.buildCustomerAccountStatement({ ...snapshot([]), accountId: '1111111111' }, customer.id), /does not match/);
});

test('statement filename is safe and ends with PDF extension', () => {
  const statement = statementModule.buildCustomerAccountStatement(snapshot([]), customer.id);
  const filename = pdfModule.safeCustomerStatementFilename(statement);
  assert.match(filename, /^DigitalKhata_Customer_Statement_Asha_Shopper_cust-1\.pdf$/);
});
