import assert from 'node:assert/strict';
import test from 'node:test';
import loadTs from './helpers/loadTs.cjs';
import { entrySchema } from '../server/src/validators/schemas.js';
import { readFileSync } from 'node:fs';

const entry = {
  id: 'txn-original', customerId: 'customer-one', type: 'payment', amount: 250,
  date: '2026-10-15', createdAt: '2026-10-15T10:00:00.000Z',
  recordedAt: '2026-10-15T10:00:00.000Z', note: 'Paid', method: 'Cash', reference: '',
  appliedToUdhari: 250, addedToAdvance: 0, advanceApplied: 0,
  serverVersion: 7, resolutionVersion: 3,
};

function apiWithRequests() {
  const requests = [];
  const api = loadTs('src/api.ts', {
    'expo-secure-store': { getItemAsync: async () => 'shop-token' },
    './offlineStore': {},
  }, { __DEV__: false, fetch: async (url, options) => {
    const body = JSON.parse(options.body || '{}');
    requests.push({ path: new URL(url).pathname.replace('/api/v1', ''), method: options.method, body });
    const payload = options.method === 'DELETE'
      ? { entry, deletedAt: '2026-10-26T10:00:00.000Z' }
      : options.url?.endsWith('/restore') ? entry : entry;
    return new Response(JSON.stringify(payload), { status: 200 });
  } });
  return { api, requests };
}

test('queued edits keep optimistic versions and serialize only strict-schema ledger fields', async () => {
  assert.equal(entrySchema.safeParse(entry).success, false, 'the old object with server metadata failed strict API validation');
  const { api, requests } = apiWithRequests();
  const updated = { ...entry, amount: 300 };
  await api.syncQueuedChange({ customers: [], entries: [{ operation: 'update', before: entry, after: updated }], audit: [], read: [] });
  const request = requests[0];
  assert.equal(request.path, `/ledger/${entry.id}`);
  assert.equal(request.method, 'PATCH');
  assert.equal(request.body.baseVersion, 7);
  assert.equal(request.body.baseResolutionVersion, 3);
  assert.equal(request.body.baseRecord.recordedAt, entry.recordedAt);
  assert.equal(request.body.recordedAt, entry.recordedAt);
  const { baseRecord: _baseRecord, baseVersion: _baseVersion, baseResolutionVersion: _baseResolutionVersion, ...payload } = request.body;
  assert.equal(entrySchema.safeParse(payload).success, true);
  assert.equal(entrySchema.safeParse(request.body.baseRecord).success, true);
  assert.equal('createdAt' in request.body.baseRecord, false);
  assert.equal('createdAt' in request.body, false);
  assert.equal('serverVersion' in request.body, false);
  assert.equal('resolutionVersion' in request.body, false);
});

test('delete queue sends a strict-schema base record with the original ID and both versions', async () => {
  const { api, requests } = apiWithRequests();
  const audit = { id: 'delete-event', action: 'Deleted transaction', date: '2026-10-26T10:00:00.000Z', before: entry };
  await api.syncQueuedChange({ customers: [], entries: [{ operation: 'delete', before: entry }], audit: [audit], read: [] });
  const request = requests[0];
  assert.equal(request.path, `/ledger/${entry.id}`);
  assert.equal(request.method, 'DELETE');
  assert.equal(request.body.baseVersion, 7);
  assert.equal(request.body.baseResolutionVersion, 3);
  assert.equal(request.body.baseRecord.id, entry.id);
  assert.equal(request.body.baseRecord.recordedAt, entry.recordedAt);
  assert.equal(entrySchema.safeParse(request.body.baseRecord).success, true);
  assert.equal('createdAt' in request.body.baseRecord, false);
  assert.equal(request.body.audit.id, audit.id);
});

test('restoration sends an audit snapshot accepted by the strict ledger schema', async () => {
  const { api, requests } = apiWithRequests();
  const audit = { id: 'restore-event', action: 'Restored transaction', date: '2026-10-27T10:00:00.000Z', before: entry, after: entry };
  await api.syncQueuedChange({ customers: [], entries: [{ operation: 'create', after: entry }], audit: [audit], read: [] });
  const request = requests[0];
  assert.equal(request.path, `/ledger/${entry.id}/restore`);
  assert.equal(request.method, 'POST');
  assert.equal(request.body.expectedVersion, 7);
  assert.equal(request.body.expectedResolutionVersion, 3);
  assert.equal(entrySchema.safeParse(request.body.audit.before).success, true);
  assert.equal(entrySchema.safeParse(request.body.audit.after).success, true);
  assert.equal('createdAt' in request.body.audit.before, false);
  assert.equal('serverVersion' in request.body.audit.after, false);
  assert.equal('resolutionVersion' in request.body.audit.after, false);
});

test('restore API diagnostics include safe HTTP and validation details without request data', async () => {
  const warnings = [];
  const api = loadTs('src/api.ts', {
    'expo-secure-store': { getItemAsync: async () => 'sensitive-auth-token' },
    './offlineStore': {},
  }, { __DEV__: true, console: { warn: (...args) => warnings.push(args) }, fetch: async () => new Response(JSON.stringify({
    error: 'Invalid restore request', code: 'INVALID_TRANSACTION_RESTORATION',
    details: [{ field: 'audit.before.createdAt', code: 'unrecognized_keys' }],
  }), { status: 400, headers: { 'x-request-id': 'restore-req-123' } }) });
  const audit = { id: 'restore-event', action: 'Restored transaction', date: '2026-10-27T10:00:00.000Z', before: { ...entry, note: 'PRIVATE CUSTOMER NOTE' }, after: entry };
  await assert.rejects(api.syncQueuedChange({ customers: [], entries: [{ operation: 'create', after: entry }], audit: [audit], read: [] }), error => error.status === 400 && error.payload.code === 'INVALID_TRANSACTION_RESTORATION');
  const diagnostic = JSON.stringify(warnings);
  assert.match(diagnostic, /POST/);
  assert.match(diagnostic, /\/ledger\/:id\/restore/);
  assert.match(diagnostic, /400/);
  assert.match(diagnostic, /INVALID_TRANSACTION_RESTORATION/);
  assert.match(diagnostic, /audit\.before\.createdAt/);
  assert.match(diagnostic, /restore-req-123/);
  assert.doesNotMatch(diagnostic, /sensitive-auth-token|PRIVATE CUSTOMER NOTE|250/);
});

test('edit form preserves resolution version and cannot turn a missing edit target into a new transaction', () => {
  const app = readFileSync('App.tsx', 'utf8');
  assert.match(app, /resolutionVersion: old\?\.resolutionVersion/);
  assert.match(app, /route\.screen === "editTransaction" && !old/);
});

test('stale restore operations enter the existing transaction conflict resolver', () => {
  const sync = readFileSync('src/offlineSync.ts', 'utf8');
  assert.match(sync, /event\.action === "Restored transaction"/);
  assert.match(sync, /await markConflict\(pending\.id, pending\.change/);
});
