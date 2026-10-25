import assert from 'node:assert/strict';
import test from 'node:test';
import loadTs from './helpers/loadTs.cjs';
import { listActivity } from '../server/src/services/activityService.js';
import { Audit, FinancialResolution } from '../server/src/models.js';

const lifecycle = { clientId: 'audit-test', action: 'CUSTOMER_DISABLED', occurredAt: new Date('2026-01-01'), _id: 'test', before: { customerId: 'customer-test', status: 'active' }, after: { customerId: 'customer-test', status: 'disabled' } };
const account = { shop: { name: 'Test', owner: 'Test', address: '', phone: '', whatsapp: '' }, shopExists: true, shopComplete: true, signedIn: true, customers: [], entries: [], audit: [], reminders: { enabled: false, day: 'Last day', time: '10:00', minimum: '0', whatsapp: false, sms: false }, read: [], language: 'en', defaultMethod: 'Cash' };
const { validBackup } = loadTs('src/model.ts', { 'expo-crypto': {} });

test('session restoration accepts lifecycle activity returned by the actual activity serializer', async () => {
  const original = [Audit.find, FinancialResolution.find];
  const query = (rows) => ({ sort() { return this; }, limit() { return this; }, async lean() { return rows; } });
  try {
    Audit.find = () => query([lifecycle]);
    FinancialResolution.find = () => query([]);
    const page = await listActivity({ shopId: 'synthetic', limit: 500, token: '' });
    const calls = [];
    const api = loadTs('src/api.ts', {
      'expo-secure-store': { getItemAsync: async () => 'synthetic-token', setItemAsync: async () => {} },
      './offlineStore': { rotateOfflineSessionToken: async () => {} },
    }, { __DEV__: false, fetch: async (url) => {
      const path = new URL(url).pathname.replace('/api/v1', '');
      calls.push(path);
      return new Response(JSON.stringify(path === '/auth/refresh' ? { accessToken: 'synthetic', refreshToken: 'synthetic-next' } : path === '/bootstrap' ? account : path === '/activity' ? page : { items: [], nextCursor: null }), { status: 200 });
    } });
    const restored = await api.restoreSession();
    assert.equal(validBackup(restored), true, 'startup must accept a lifecycle audit without financial snapshot fields');
    assert.equal(restored.audit[0].customerLifecycle.newStatus, 'disabled');
    assert.deepEqual(calls, ['/auth/refresh', '/bootstrap', '/customers', '/ledger', '/activity', '/ledger/deleted']);
  } finally { [Audit.find, FinancialResolution.find] = original; }
});

test('old lifecycle cache records normalize without changing ledger values', () => {
  const { withoutLegacyDueFromAudit } = loadTs('src/ledgerCompatibility.ts');
  const original = { id: lifecycle.clientId, action: lifecycle.action, date: lifecycle.occurredAt.toISOString(), before: lifecycle.before, after: lifecycle.after };
  const cached = JSON.parse(JSON.stringify(original));
  const normalized = withoutLegacyDueFromAudit(cached);
  assert.equal(validBackup({ ...account, audit: [normalized] }), true);
  assert.equal(normalized.customerLifecycle.previousStatus, 'active');
  assert.deepEqual(cached, original);
  assert.equal(validBackup({ ...account, audit: [{ ...normalized, customerLifecycle: { ...normalized.customerLifecycle, newStatus: 'invalid' } }] }), false);
  assert.equal(validBackup({ ...account, audit: [{ id: 'bad', action: 'Payment', date: '2026-01-01', after: { amount: 'invalid' } }] }), false);
});

for (const status of [429, 500, 503, 401, 403]) test(`refresh HTTP ${status} preserves only eligible offline authorization`, async () => {
  const values = new Map([['khata.refresh.v1', 'synthetic'], ['khata.access.v1', 'synthetic']]);
  let cleared = false;
  const api = loadTs('src/api.ts', {
    'expo-secure-store': { getItemAsync: async key => values.get(key), deleteItemAsync: async key => values.delete(key) },
    './offlineStore': { clearOfflineSession: async () => { cleared = true; } },
  }, { __DEV__: false, fetch: async () => new Response(JSON.stringify({ code: 'TEST_FAILURE' }), { status }) });
  if ([401, 403].includes(status)) {
    assert.equal(await api.restoreSession(), null);
    assert.equal(cleared, true);
    assert.equal(values.has('khata.refresh.v1'), false);
  } else {
    await assert.rejects(api.restoreSession(), error => error instanceof api.ApiError && error.status === status);
    assert.equal(cleared, false);
    assert.equal(values.has('khata.refresh.v1'), true);
  }
});

test('backend transport failure retains credentials and reports no HTTP response', async () => {
  const logs = [];
  const api = loadTs('src/api.ts', {
    'expo-secure-store': { getItemAsync: async () => 'synthetic' }, './offlineStore': {},
  }, { __DEV__: true, console: { warn: (...args) => logs.push(args[1]) }, fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(api.restoreSession(), error => error instanceof api.ApiTransportError && error.kind === 'network');
  assert.equal(logs[0].origin, 'session_restore');
  assert.equal(logs[0].endpoint, '/auth/refresh');
  assert.equal(logs[0].responseReceived, false);
});

test('offline authorization checks expiry, token binding, first login and revocation', async () => {
  const values = new Map();
  const store = loadTs('src/offlineStore.ts', {
    'expo-secure-store': { getItemAsync: async key => values.get(key) },
    'expo-crypto': { CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async (_, token) => `hash:${token}` },
    'expo-file-system/legacy': {}, 'expo-constants': {},
  });
  assert.equal(await store.readOfflineSession(), null);
  values.set('khata.refresh.v1', 'synthetic');
  const session = { accountId: '12345678', authenticatedAt: Date.now(), refreshTokenHash: 'hash:synthetic' };
  values.set('khata.offline-session.v1', JSON.stringify(session));
  assert.deepEqual(await store.readOfflineSession(), session);
  values.set('khata.offline-session.v1', JSON.stringify({ ...session, authenticatedAt: Date.now() - 31 * 86400000 }));
  assert.equal(await store.readOfflineSession(), null);
  values.set('khata.offline-session.v1', JSON.stringify({ ...session, refreshTokenHash: 'mismatch' }));
  assert.equal(await store.readOfflineSession(), null);
  values.delete('khata.refresh.v1');
  assert.equal(await store.readOfflineSession(), null);
});

test('local credential storage failures are not fabricated as backend HTTP 503', async () => {
  let reads = 0;
  const failure = new Error('synthetic storage failure');
  const api = loadTs('src/api.ts', {
    'expo-secure-store': { getItemAsync: async () => { if (++reads > 1) throw failure; return 'synthetic'; } },
    './offlineStore': {},
  }, { __DEV__: false });
  await assert.rejects(api.restoreSession(), error => error === failure);
});

test('lifecycle synchronization retains a failed pending operation across restart and acknowledges success once', async () => {
  const pending = { id: 1, change: { operationId: 'synthetic-op', customers: [{ operation: 'lifecycle', id: 'customer-test', target: 'disabled', baseVersion: 2, baseResolutionVersion: 1 }], entries: [], audit: [] } };
  let durableQueue = JSON.stringify(pending);
  let acknowledgements = 0;
  class ApiError extends Error { constructor(status) { super('synthetic'); this.status = status; } }
  const create = (available) => loadTs('src/offlineSync.ts', {
    './api': { ApiError, syncQueuedChange: async change => {
      assert.equal(change.operationId, 'synthetic-op');
      assert.equal(change.customers[0].baseVersion, 2);
      if (!available) throw new ApiError(503);
      return { acknowledged: true };
    } },
    './connectivity': { checkConnectivity: async () => 'online' },
    './offlineStore': {
      readOfflineSession: async () => ({ accountId: '12345678' }),
      readNextChange: async () => durableQueue ? JSON.parse(durableQueue) : null,
      noteSyncFailure: async () => {}, nextPendingRetryAt: async () => null,
      acknowledgeChange: async () => { acknowledgements++; durableQueue = null; },
    },
  });
  await assert.rejects(create(false).synchronizeAccount('12345678', false), error => error.status === 503);
  assert.deepEqual(JSON.parse(durableQueue), pending);
  await create(true).synchronizeAccount('12345678', false);
  assert.equal(acknowledgements, 1);
  assert.equal(durableQueue, null);
});
