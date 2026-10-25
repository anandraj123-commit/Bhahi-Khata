import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import loadTs from './helpers/loadTs.cjs';

const { deletedEntriesFromHistory } = loadTs('src/transactionLifecycle.ts');
const entry = { id: 'txn-1', customerId: 'customer-1', type: 'payment', amount: 2000, date: '2026-10-15', note: 'Payment', method: 'Cash' };

test('deleted transaction list is rebuilt from the latest deletion or restoration audit event', () => {
  const deleted = { id: 'delete-1', action: 'Deleted transaction', date: '2026-10-26T10:00:00.000Z', before: entry };
  const restored = { id: 'restore-1', action: 'Restored transaction', date: '2026-10-27T10:00:00.000Z', before: entry, after: entry };
  const deletedAgain = { ...deleted, id: 'delete-2', date: '2026-10-28T10:00:00.000Z' };
  assert.deepEqual(deletedEntriesFromHistory([deleted], []), [{ ...entry, deletedAt: deleted.date }]);
  assert.deepEqual(deletedEntriesFromHistory([deleted, restored], [entry]), []);
  assert.deepEqual(deletedEntriesFromHistory([deletedAgain, restored, deleted], []), [{ ...entry, deletedAt: deletedAgain.date }]);
});

test('restoring the same entry reuses existing financial calculations for outstanding and advances', () => {
  const { financialSummary } = loadTs('src/model.ts', { 'expo-crypto': { randomUUID: () => 'test-id' } });
  const customer = { id: 'customer-1', name: 'Test', phone: '', address: '', opening: 0, openingAdvance: 0, limit: 0, reminder: false };
  const credit = { ...entry, id: 'credit', type: 'credit', amount: 5000, date: '2026-10-10' };
  const payment = { ...entry, id: 'payment', type: 'payment', amount: 2000, date: '2026-10-15' };
  const laterCredit = { ...entry, id: 'later-credit', type: 'credit', amount: 1000, date: '2026-10-20' };
  const data = (entries) => ({ customers: [customer], entries });
  const active = [credit, payment, laterCredit];
  assert.equal(financialSummary(data(active), customer.id).outstandingPaise, 400000);
  assert.equal(financialSummary(data(active.filter((item) => item.id !== payment.id)), customer.id).outstandingPaise, 600000);
  const restored = [payment, ...active.filter((item) => item.id !== payment.id)];
  assert.equal(financialSummary(data(restored), customer.id).outstandingPaise, 400000);
  assert.equal(new Set(restored.map((item) => item.id)).size, 3);
});

test('deletion and restoration preserve the original transaction in the existing ledger queue', () => {
  const app = readFileSync('App.tsx', 'utf8');
  const api = readFileSync('src/api.ts', 'utf8');
  const store = readFileSync('src/offlineStore.ts', 'utf8');
  const server = readFileSync('server/src/services/ledgerService.js', 'utf8');
  const details = readFileSync('src/TransactionDetails.tsx', 'utf8');
  assert.match(app, /deletedEntries: \[\{ \.\.\.active, deletedAt \}/);
  assert.match(app, /action: "Restored transaction"/);
  assert.match(api, /transaction-restore:\$\{action\.id\}/);
  assert.match(api, /expectedVersion: old\?\.serverVersion \|\| entry\?\.serverVersion \|\| 1/);
  assert.match(store, /deletedEntries: data\.deletedEntries \|\| deletedEntriesFromHistory/);
  assert.match(server, /entry\.deletedAt = undefined/);
  assert.match(server, /serverVersion = actualVersion \+ 1/);
  assert.match(server, /reconcileCustomerAllocations\(shopId, entry\.customerClientId, session\)/);
  assert.match(details, /deleted \? <Card>[\s\S]*No active receipt can be generated/);
  assert.doesNotMatch(server, /Entry\.deleteOne|Entry\.findByIdAndDelete/);
});
