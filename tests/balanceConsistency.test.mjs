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

const customerId = 'customer-1';
const makeCustomer = (opening, openingAdvance, openingDate = '2026-01-01') => ({
  id: customerId,
  name: 'Customer',
  phone: '',
  address: '',
  opening,
  openingAdvance,
  openingDate,
  createdAt: '2026-01-01T00:00:00.000Z',
  limit: 0,
  reminder: false,
});
const entry = (id, type, amount, date, fields = {}) => ({
  id, customerId, type, amount, date, recordedAt: `${date}T10:00:00.000Z`, note: '', method: 'Cash', ...fields,
});
const makeData = (customer, entries) => ({
  shop: { name: 'Shop', owner: 'Owner', phone: '9876543210', whatsapp: '', address: '' },
  shopExists: true,
  customers: [customer],
  entries,
  deletedEntries: [],
  audit: [],
  signedIn: true,
  language: 'English',
  reminders: { enabled: false, day: '', time: '', minimum: '', whatsapp: false, sms: false },
  defaultMethod: 'Cash',
  read: [],
});

const openingCases = [
  ['opening Udhari only', 500, 0, 500],
  ['opening Advance only', 0, 500, -500],
  ['both opening positions', 700, 250, 450],
  ['zero opening', 0, 0, 0],
];

test('monthly opening and closing reconcile to adjacent periods and lifetime balance for every opening position', () => {
  for (const [name, opening, advance, originalNet] of openingCases) {
    const customer = makeCustomer(opening, advance);
    const data = makeData(customer, [
      entry(`${name}-credit-jan`, 'credit', 120, '2026-01-12'),
      entry(`${name}-payment-feb`, 'payment', 180, '2026-02-04'),
      entry(`${name}-refund-mar`, 'refund', 30, '2026-03-08'),
      entry(`${name}-credit-apr`, 'credit', 75, '2026-04-01'),
    ]);

    assert.equal(model.monthly(data, customerId, '2026-01').opening, 0, `${name}: opening recorded in January`);
    assert.equal(model.monthly(data, customerId, '2026-01').closing, originalNet + 120, `${name}: January closing`);
    assert.equal(model.monthly(data, customerId, '2026-02').opening, model.monthly(data, customerId, '2026-01').closing, `${name}: February opening`);
    assert.equal(model.monthly(data, customerId, '2026-03').opening, model.monthly(data, customerId, '2026-02').closing, `${name}: March opening`);
    assert.equal(model.monthly(data, customerId, '2026-04').opening, model.monthly(data, customerId, '2026-03').closing, `${name}: April opening`);
    assert.equal(model.monthly(data, customerId, '2026-04').closing, model.balance(data, customerId), `${name}: lifetime close`);

    const financial = model.financialSummary(data, customerId);
    assert.equal(model.balance(data, customerId), (financial.outstandingPaise - financial.availableAdvancePaise) / 100, `${name}: outstanding and advance net`);
    const statement = statementModule.buildCustomerAccountStatement({ accountId: '9876543210', data, queue: [] }, customerId);
    assert.equal(statement.opening.balance, originalNet, `${name}: original opening in account statement`);
    assert.equal(statement.financial.closingBalance, model.balance(data, customerId), `${name}: statement closing matches View Customer`);
  }
});

test('monthly balances use effective edited, restored and pending local ledger entries without double counting opening advance', () => {
  const customer = makeCustomer(300, 500);
  const edited = entry('edited-credit', 'credit', 400, '2026-01-10');
  const pendingPayment = entry('pending-payment', 'payment', 250, '2026-02-10', { serverVersion: undefined });
  const restoredRefund = entry('restored-refund', 'refund', 40, '2026-03-05');
  const deleted = { ...entry('deleted-credit', 'credit', 999, '2026-03-08'), deletedAt: '2026-03-09T00:00:00.000Z' };
  const data = makeData(customer, [edited, pendingPayment, restoredRefund]);
  data.deletedEntries = [deleted];

  // Active SQLite entries are the effective ledger: deleted tombstones are kept separately;
  // pending local records and restored records remain active and are counted once.
  assert.equal(model.monthly(data, customerId, '2026-01').closing, 200);
  assert.equal(model.monthly(data, customerId, '2026-02').closing,  -50);
  assert.equal(model.monthly(data, customerId, '2026-03').closing, -10);
  assert.equal(model.monthly(data, customerId, '2026-03').closing, model.balance(data, customerId));
  assert.equal(model.financialSummary(data, customerId).availableAdvancePaise, 1000);
});

test('transactions dated before the recorded opening position do not create a monthly-to-lifetime closing discrepancy', () => {
  const customer = makeCustomer(500, 100, '2026-01-10');
  const data = makeData(customer, [
    entry('pre-opening-credit', 'credit', 250, '2026-01-05'),
    entry('opening-month-payment', 'payment', 100, '2026-01-15'),
    entry('next-month-credit', 'credit', 100, '2026-02-01'),
  ]);

  const january = model.monthly(data, customerId, '2026-01');
  const february = model.monthly(data, customerId, '2026-02');
  assert.equal(january.opening, 0);
  assert.equal(january.closing, 300);
  assert.equal(february.opening, january.closing);
  assert.equal(february.closing, 400);
  assert.equal(february.closing, model.balance(data, customerId));
  const financial = model.financialSummary(data, customerId);
  assert.equal(model.balance(data, customerId), (financial.outstandingPaise - financial.availableAdvancePaise) / 100);
});

