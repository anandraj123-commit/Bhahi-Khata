import assert from 'node:assert/strict';
import test from 'node:test';
import loadTs from './helpers/loadTs.cjs';

const model = loadTs('src/model.ts', { 'expo-crypto': { randomUUID: () => 'test-id' } });
const receipt = loadTs('src/transactionReceipt.ts', { './model': model });
const lifecycle = loadTs('src/customerLifecycle.ts', { './model': model });
const presentation = loadTs('src/entryPresentation.ts', { './model': model });
const locales = loadTs('src/locales.ts');
const khataPresentation = loadTs('src/khataPresentation.ts');
const statementModule = loadTs('src/customerAccountStatement.ts', {
  './model': model,
  './customerLifecycle': lifecycle,
  './entryPresentation': presentation,
  './locales': locales,
  './transactionReceipt': receipt,
});
const monthlyStatementModule = loadTs('src/monthlyKhataStatement.ts', {
  './model': model,
  './customerAccountStatement': statementModule,
  './khataPresentation': khataPresentation,
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
  assert.deepEqual(statement.opening, { balance: -200, date: '2026-01-01', udhari: 300, advance: 500, adjustedAgainstUdhari: 300, remainingAdvance: 200 });
  assert.equal(statement.financial.closingBalance, model.balance(data, opened.id));
  const html = pdfModule.customerAccountStatementHtml(statement);
  assert.match(html, /Opening Advance Adjusted Against Udhari/);
  assert.match(html, /Remaining Advance/);
});

test('opening and closing positions distinguish outstanding, advance and settled balances', () => {
  const openingUdhari = { ...customer, opening: 500, openingAdvance: 100 };
  const settledEntries = [entry('settle-payment', 'payment', 400, 0, { date: '2026-01-02' })];
  const settledData = { ...snapshot(settledEntries, { customers: [openingUdhari] }).data };
  const settled = statementModule.buildCustomerAccountStatement({ ...snapshot(settledEntries, { customers: [openingUdhari] }), data: settledData }, customer.id);
  assert.equal(settled.opening.balance, 400);
  assert.equal(settled.financial.closingBalance, 0);

  const advanceCustomer = { ...customer, opening: 0, openingAdvance: 250 };
  const advance = statementModule.buildCustomerAccountStatement(snapshot([], { customers: [advanceCustomer] }), customer.id);
  assert.equal(advance.opening.balance, -250);
  assert.equal(advance.financial.closingBalance, -250);

  const udhariCustomer = { ...customer, opening: 500, openingAdvance: 0 };
  const outstanding = statementModule.buildCustomerAccountStatement(snapshot([entry('more-credit', 'credit', 100, 0)], { customers: [udhariCustomer] }), customer.id);
  assert.equal(outstanding.opening.balance, 500);
  assert.equal(outstanding.financial.closingBalance, 600);
  assert.equal(outstanding.financial.closingBalance, model.balance({ ...snapshot([entry('more-credit', 'credit', 100, 0)], { customers: [udhariCustomer] }).data }, customer.id));

  const html = pdfModule.customerAccountStatementHtml(settled);
  assert.match(html, /Opening Balance<\/span><strong>₹400\.00 · Outstanding/);
  assert.match(html, /Closing Balance<\/span><strong>₹0\.00 · Settled/);
});

test('opening advance is independently included when there is no opening Udhari and optional contact values stay optional', () => {
  const opened = { ...customer, opening: 0, openingAdvance: 500, phone: '', whatsappNumber: '', address: '' };
  const statement = statementModule.buildCustomerAccountStatement(snapshot([], { customers: [opened] }), opened.id);
  assert.deepEqual(statement.opening, { balance: -500, date: '2026-01-01', advance: 500 });
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
  for (const value of ['data:image/png;base64,bG9nbw==', 'DIGITAL-KHATA', 'Asha Stores', 'Asha &lt;Shopper&gt;', '9876543210', '9123456789', 'Main &amp; Market', 'Khata Created On', 'Credit Limit', 'Reminders', 'Opening Balance', 'Closing Balance', 'Total Money Received', 'Available Advance', 'txn-html', 'Payment Received', '₹2,500.00', 'REF-1', 'Apurva Software Solutions', 'supports@apurvasoftwaresolutions.com', 'www.apurvasoftwaresolutions.com']) assert.ok(html.includes(value), value);
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

test('monthly statement uses the existing monthly selector and exports only one customer and selected month', () => {
  const opened = { ...customer, opening: 1000, openingAdvance: 100, openingDate: '2026-01-01' };
  const entries = [
    entry('sep-credit', 'credit', 500, 0, { date: '2026-09-15', note: 'September' }),
    entry('oct-credit', 'credit', 3000, 1, { date: '2026-10-10', note: 'October credit' }),
    entry('oct-payment', 'payment', 2000, 2, { date: '2026-10-15', note: 'October payment' }),
    entry('nov-credit', 'credit', 900, 3, { date: '2026-11-02', note: 'November' }),
    entry('other-customer', 'credit', 700, 4, { customerId: 'other-customer', date: '2026-10-12', note: 'Private other customer' }),
  ];
  const data = { ...snapshot(entries, { customers: [opened, { ...customer, id: 'other-customer', name: 'Other customer' }] }).data };
  const monthly = monthlyStatementModule.buildMonthlyKhataStatement(
    { accountId: '6203253537', data, queue: [] },
    opened.id,
    '2026-10',
    new Date('2026-10-27T12:00:00Z'),
  );
  assert.deepEqual(monthly.transactions.map((item) => item.id), ['oct-credit', 'oct-payment']);
  assert.equal(monthly.period.openingBalance, 1400);
  assert.equal(monthly.period.udhariGiven, 3000);
  assert.equal(monthly.period.paymentReceived, 2000);
  assert.equal(monthly.period.closingBalance, 2400);
  assert.deepEqual(monthly.opening, { balance: 900, date: '2026-01-01', udhari: 1000, advance: 100, adjustedAgainstUdhari: 100, remainingAdvance: 0 });
  const html = pdfModule.customerAccountStatementHtml(monthly);
  assert.match(html, /Monthly Statement/);
  assert.match(html, /October 2026/);
  assert.match(html, /2,400\.00/);
  assert.match(html, /October credit/);
  assert.match(html, /October payment/);
  assert.doesNotMatch(html, /September|November|Private other customer/);
  assert.doesNotMatch(html, /Credit Limit|Customer Search|Reminders/);
  assert.equal((html.match(/<span>Opening Balance<\/span>/g) || []).length, 1);
  assert.equal((html.match(/<span>Closing Balance<\/span>/g) || []).length, 1);
  assert.doesNotMatch(html, /Monthly Opening Balance|Monthly Closing Balance/);
  const filename = pdfModule.safeMonthlyKhataStatementFilename(monthly);
  assert.match(filename, /^DigitalKhata_Asha_Shopper_2026-10_cust-1\.pdf$/);
});

test('monthly PDF data is complete beyond visible pagination and omits deleted transactions', () => {
  const october = Array.from({ length: 250 }, (_, index) => entry(
    `oct-${String(index).padStart(3, '0')}`, 'credit', 1, index,
    { date: `2026-10-${String((index % 28) + 1).padStart(2, '0')}`, note: `Oct note ${index}` },
  ));
  const deleted = { ...entry('oct-deleted', 'payment', 99, 251, { date: '2026-10-25' }), deletedAt: '2026-10-26T10:00:00.000Z' };
  const november = entry('nov-outside', 'credit', 1, 252, { date: '2026-11-01' });
  const data = { ...snapshot([...october, deleted, november]).data, deletedEntries: [deleted] };
  const statement = monthlyStatementModule.buildMonthlyKhataStatement(
    { accountId: '6203253537', data, queue: [] }, customer.id, '2026-10', new Date('2026-10-27T12:00:00Z'),
  );
  assert.equal(statement.transactions.length, 250);
  assert.ok(statement.transactions.some((item) => item.id === 'oct-249'));
  assert.ok(!statement.transactions.some((item) => ['oct-deleted', 'nov-outside'].includes(item.id)));
  const html = pdfModule.customerAccountStatementHtml(statement);
  assert.match(html, /Transaction History \(250\)/);
  assert.match(html, /Oct note 249/);
  assert.doesNotMatch(html, /oct-deleted|nov-outside/);
});

test('monthly PDF export reuses All, Udhari, and Payment card filters without recalculating balances', () => {
  const entries = [
    entry('oct-credit', 'credit', 300, 0, { date: '2026-10-02' }),
    entry('oct-payment', 'payment', 100, 1, { date: '2026-10-03' }),
    entry('oct-refund', 'refund', 25, 2, { date: '2026-10-04' }),
    entry('nov-credit', 'credit', 500, 3, { date: '2026-11-01' }),
  ];
  const receiptSnapshot = snapshot(entries);
  const all = monthlyStatementModule.buildMonthlyKhataStatement(receiptSnapshot, customer.id, '2026-10', new Date('2026-10-27T12:00:00Z'), 'All');
  const udhari = monthlyStatementModule.buildMonthlyKhataStatement(receiptSnapshot, customer.id, '2026-10', new Date('2026-10-27T12:00:00Z'), 'Udhari', 'Asha', '2026-01-01');
  const payment = monthlyStatementModule.buildMonthlyKhataStatement(receiptSnapshot, customer.id, '2026-10', new Date('2026-10-27T12:00:00Z'), 'Payment');

  assert.deepEqual(all.transactions.map(({ id }) => id), ['oct-credit', 'oct-payment', 'oct-refund']);
  assert.deepEqual(udhari.transactions.map(({ id }) => id), ['oct-credit']);
  assert.deepEqual(payment.transactions.map(({ id }) => id), ['oct-payment']);
  for (const statement of [all, udhari, payment]) {
    assert.equal(statement.period.openingBalance, all.period.openingBalance);
    assert.equal(statement.period.closingBalance, all.period.closingBalance);
    assert.equal(statement.period.udhariGiven, all.period.udhariGiven);
    assert.equal(statement.period.paymentReceived, all.period.paymentReceived);
  }
  assert.equal(udhari.period.customerSearch, 'Asha');
  assert.equal(udhari.period.customerCreatedDateFilter, '2026-01-01');
  const html = pdfModule.customerAccountStatementHtml(udhari);
  assert.match(html, /Transaction Filter: Udhari/);
  assert.match(html, /Customer Search: Asha/);
  assert.match(html, /Khata Created On: 2026-01-01/);
  assert.match(html, /Financial balances reflect the full selected-month ledger; transaction history is filtered\./);
  assert.doesNotMatch(html, /oct-payment|oct-refund|nov-credit/);
});

test('monthly export is identical before and after Load More because it reads the complete ledger snapshot', () => {
  const entries = Array.from({ length: 25 }, (_, index) => entry(
    `oct-${String(index).padStart(2, '0')}`,
    index % 3 === 0 ? 'payment' : 'credit',
    index + 1,
    index,
    { date: `2026-10-${String((index % 28) + 1).padStart(2, '0')}`, note: `Transaction ${index}` },
  ));
  const ledgerSnapshot = snapshot(entries);
  const filters = ['2026-10', 'Payment', 'Asha', '2026-01-01'];
  const exportCurrentStatement = () => monthlyStatementModule.buildMonthlyKhataStatement(
    ledgerSnapshot, customer.id, filters[0], new Date('2026-10-27T12:00:00Z'), filters[1], filters[2], filters[3],
  );

  const firstPage = entries.slice(-10);
  const beforeLoadMore = exportCurrentStatement();
  assert.equal(firstPage.length, 10);
  assert.equal(beforeLoadMore.transactions.length, 9);
  assert.ok(beforeLoadMore.transactions.some((item) => item.id === 'oct-00'));

  const expandedPage = entries.slice(-20); // The UI's Load More action reveals the next ten rows.
  const afterLoadMore = exportCurrentStatement();
  assert.equal(expandedPage.length, 20);
  assert.deepEqual(afterLoadMore.transactions, beforeLoadMore.transactions);
  assert.equal(pdfModule.customerAccountStatementHtml(afterLoadMore), pdfModule.customerAccountStatementHtml(beforeLoadMore));
  assert.equal(afterLoadMore.transactions.length, 9);
});
