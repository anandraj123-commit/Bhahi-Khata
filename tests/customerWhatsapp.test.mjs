import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import loadTs from './helpers/loadTs.cjs';
import { customerSchema, customerCreateSchema } from '../server/src/validators/schemas.js';
import { customerOut } from '../server/src/utils/serializers.js';
import { sameCustomerValues } from '../server/src/utils/records.js';
import { Customer } from '../server/src/models.js';
import { readFileSync } from 'node:fs';
const { normalizeCustomerMobile } = loadTs('src/customerPhone.ts');
const { updateCustomerContactForm } = loadTs('src/customerContactForm.ts');
const { createSyncDelta } = loadTs('src/syncDelta.ts');
const base = { id: 'test-customer', name: 'Test', phone: '', address: '', opening: 12, openingAdvance: 0, limit: 100, reminder: false, status: true, disabled: false, removed: false };

test('optional WhatsApp normalizes consistently and rejects invalid input', () => {
  for (const [input, expected] of [['', ''], ['  ', ''], ['9876543210', '9876543210'], ['+91 98765-43210', '9876543210'], ['09876543210', '9876543210']]) {
    assert.equal(normalizeCustomerMobile(input), expected);
    assert.equal(customerCreateSchema.parse({ ...base, whatsappNumber: input }).whatsappNumber, expected);
  }
  assert.equal(customerCreateSchema.parse(base).whatsappNumber, undefined);
  for (const input of ['5123456789', '987654321', '98765432100', 'abcdefghij', '+1 9876543210', null, 9876543210]) {
    assert.equal(customerSchema.safeParse({ ...base, whatsappNumber: input }).success, false);
  }
});

test('same-as-mobile follows edits and permits a different number after unchecking', () => {
  let form = { phone: '9876543210', whatsappNumber: '', sameAsMobile: 'false' };
  form = updateCustomerContactForm(form, 'sameAsMobile', 'true');
  assert.equal(form.whatsappNumber, form.phone);
  form = updateCustomerContactForm(form, 'phone', '8765432109');
  assert.equal(form.whatsappNumber, '8765432109');
  form = updateCustomerContactForm(form, 'sameAsMobile', 'false');
  form = updateCustomerContactForm(form, 'whatsappNumber', '7654321098');
  form = updateCustomerContactForm(form, 'phone', '9876543210');
  assert.equal(form.whatsappNumber, '7654321098');
  assert.equal(form.phone, '9876543210');
});

test('MongoDB schema and conflict equality support optional values and removal', async () => {
  const doc = new Customer({ shopId: '000000000000000000000001', clientId: base.id, name: 'Test', nameFolded: 'test', whatsappNumber: '9876543210' });
  await doc.validate();
  assert.equal(customerOut(doc).whatsappNumber, '9876543210');
  doc.whatsappNumber = ''; await doc.validate();
  assert.equal(customerOut(doc).whatsappNumber, '');
  doc.whatsappNumber = '123'; await assert.rejects(doc.validate());
  assert.equal(customerOut({ ...base, clientId: base.id }).whatsappNumber, '');
  assert.equal(sameCustomerValues(base, { ...base, whatsappNumber: '' }), true);
  assert.equal(sameCustomerValues({ ...base, whatsappNumber: '9876543210' }, base), true);
  assert.equal(sameCustomerValues({ ...base, whatsappNumber: '9876543210' }, { ...base, whatsappNumber: '' }), false);
  assert.equal(sameCustomerValues({ ...base, whatsappNumber: '9876543210' }, { ...base, whatsappNumber: '8765432109' }), false);
});

test('real SQLite stores offline create/edit/removal and queue snapshots without changing finances', async () => {
  // Native SQLCipher/key APIs are mocked; SQL statements run against real SQLite.
  const sql = new DatabaseSync(':memory:');
  const db = {
    execAsync: async (query) => sql.exec(query),
    getFirstAsync: async (query, ...args) => query === 'PRAGMA cipher_version' ? { cipher_version: 'test-native-adapter' } : sql.prepare(query).get(...args),
    getAllAsync: async (query, ...args) => sql.prepare(query).all(...args),
    runAsync: async (query, ...args) => { const r = sql.prepare(query).run(...args); return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
    closeAsync: async () => {},
  };
  const store = loadTs('src/offlineStore.ts', {
    'expo-crypto': { randomUUID },
    'expo-secure-store': { getItemAsync: async () => 'a'.repeat(64) },
    'expo-file-system/legacy': { getInfoAsync: async () => ({ exists: true }) },
    'expo-constants': { default: { executionEnvironment: 'standalone' }, ExecutionEnvironment: { StoreClient: 'store' } },
    'expo-sqlite': { openDatabaseAsync: async () => db, defaultDatabaseDirectory: '/test' },
  });
  const { initialData: initial, financialSummary } = loadTs('src/model.ts', { 'expo-crypto': { randomUUID } });
  let previous = { ...initial, customers: [], entries: [], audit: [], read: [] };
  for (const value of [undefined, '9876543210', '8765432109', '']) {
    const customer = { ...base, ...(value !== undefined ? { whatsappNumber: value } : {}) };
    const next = { ...previous, customers: [customer] };
    const id = await store.saveLocalChange('shop-one', previous, next);
    const cached = await store.readCachedAccount('shop-one');
    assert.equal(cached.customers[0].whatsappNumber, value);
    const queued = JSON.parse(sql.prepare('SELECT change_json FROM sync_queue WHERE id = ?').get(id).change_json);
    assert.equal(queued.customers[0].after.whatsappNumber, value);
    assert.equal(queued.customers[0].operation, previous.customers.length ? 'update' : 'create');
    if (previous.customers.length) assert.deepEqual(financialSummary(previous), financialSummary(next));
    assert.deepEqual(queued.entries, []);
    previous = next;
  }
  assert.equal(await store.readCachedAccount('other-shop'), null);
  const offlineCreated = { ...previous, customers: [{ ...base, whatsappNumber: '9876543210' }] };
  const createdId = await store.saveLocalChange('shop-two', { ...previous, customers: [] }, offlineCreated);
  const createdQueue = JSON.parse(sql.prepare('SELECT change_json FROM sync_queue WHERE id = ?').get(createdId).change_json);
  assert.equal(createdQueue.customers[0].operation, 'create');
  assert.equal(createdQueue.customers[0].after.whatsappNumber, '9876543210');
  assert.equal((await store.readCachedAccount('shop-two')).customers[0].whatsappNumber, '9876543210');
  const { CustomerContactInfo } = loadTs('src/CustomerContactInfo.tsx', {
    react: { ...React, useContext: () => 'en' },
    'react-native': { View: 'View', Pressable: 'Pressable', StyleSheet: { create: (s) => s } },
    './ui': { Icon: () => null, colors: { green: '#15803D', muted: '#475569' }, s: {} },
    './i18n': { LanguageContext: {}, Text: 'Text', t: (s) => s },
    './customerContactActions': { customerContactUrls: () => [], openCustomerContact: () => { throw new Error('No actions during render'); } },
  });
  const cachedCustomer = (await store.readCachedAccount('shop-two')).customers[0];
  const cachedBefore = JSON.stringify(cachedCustomer);
  const queuedBefore = sql.prepare('SELECT count(*) AS total FROM sync_queue').get().total;
  for (const compact of [false, true]) {
    const rendered = CustomerContactInfo({ customer: cachedCustomer, compact }).props.children[0].props.children.filter(Boolean);
    assert.ok(rendered.some((row) => row.props.accessibilityLabel === 'WhatsApp Number: 9876543210'));
  }
  assert.equal(JSON.stringify(cachedCustomer), cachedBefore);
  assert.equal(sql.prepare('SELECT count(*) AS total FROM sync_queue').get().total, queuedBefore);
  const { TransactionTypeBadge } = loadTs('src/TransactionTypeBadge.tsx', {
    react: { ...React, useContext: () => 'en' },
    'react-native': { View: 'View', StyleSheet: { create: (s) => s } },
    './ui': { Icon: () => null },
    './i18n': { LanguageContext: {}, Text: 'Text', t: (s) => s },
  });
  const ledgerData = { ...offlineCreated, entries: [
    { id: 'offline-credit', customerId: base.id, type: 'credit', amount: 25, date: '2026-10-25', note: '', method: 'Cash' },
    { id: 'offline-payment', customerId: base.id, type: 'payment', amount: 10, date: '2026-10-25', note: '', method: 'Cash' },
    { id: 'offline-refund', customerId: base.id, type: 'refund', amount: 5, date: '2026-10-25', note: '', method: 'Cash' },
  ] };
  await store.saveLocalChange('shop-two', offlineCreated, ledgerData);
  const cachedLedger = await store.readCachedAccount('shop-two');
  const ledgerBefore = JSON.stringify(cachedLedger);
  const financialBefore = financialSummary(cachedLedger);
  const queueBeforeRender = sql.prepare('SELECT count(*) AS total FROM sync_queue').get().total;
  for (const entry of cachedLedger.entries) {
    const label = entry.type === 'credit' ? 'Udhari Given' : entry.type === 'refund' ? 'Advance Refund' : 'Payment Received';
    assert.equal(TransactionTypeBadge({ label, compact: true }).props.accessibilityLabel, label);
  }
  assert.equal(JSON.stringify(cachedLedger), ledgerBefore);
  assert.deepEqual(financialSummary(cachedLedger), financialBefore);
  assert.equal(sql.prepare('SELECT count(*) AS total FROM sync_queue').get().total, queueBeforeRender);
  assert.equal(sql.prepare('PRAGMA user_version').get().user_version, 6);
  const change = createSyncDelta(previous, { ...previous, customers: [{ ...base, whatsappNumber: '9876543210' }] });
  await store.markCustomerConflict(4, change, { ...base, whatsappNumber: '8765432109', serverVersion: 4 }, 4, 2);
  const conflicts = await store.readPendingCustomerConflicts('shop-one');
  assert.equal(conflicts[0].local.whatsappNumber, '9876543210');
  assert.equal(conflicts[0].server.whatsappNumber, '8765432109');
  sql.close();
});

test('sync API sends WhatsApp values, base records and versions, including explicit removal', async () => {
  const requests = [];
  const api = loadTs('src/api.ts', {
    'expo-secure-store': { getItemAsync: async () => 'test-token' },
    './offlineStore': {},
  }, { __DEV__: false, fetch: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ ...base, whatsappNumber: requests.at(-1).whatsappNumber }), { status: 200 });
  } });
  for (const whatsappNumber of ['9876543210', '']) {
    const before = { ...base, whatsappNumber: '8765432109', serverVersion: 3, resolutionVersion: 2 };
    await api.syncQueuedChange({ customers: [{ operation: 'update', before, after: { ...before, whatsappNumber } }], entries: [], audit: [], read: [] });
    assert.equal(requests.at(-1).whatsappNumber, whatsappNumber);
    assert.equal(requests.at(-1).baseRecord.whatsappNumber, '8765432109');
    assert.equal(requests.at(-1).baseVersion, 3);
  }
});

test('customer details use compact contact actions while the profile retains full contact details', () => {
  const source = readFileSync('App.tsx', 'utf8');
  assert.match(source, /case "customer":[\s\S]*?<CustomerContactInfo customer=\{customer\} compact \/>/);
  assert.match(source, /case "viewCustomer":[\s\S]*?<CustomerContactInfo customer=\{customer\} \/>/);
  assert.match(source, /field\("WhatsApp Number \(Optional\)", "whatsappNumber", \{\s*icon: "logo-whatsapp",\s*keyboardType: "phone-pad"/);
});
