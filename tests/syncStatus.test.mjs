import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import loadTs from './helpers/loadTs.cjs';

const { syncStatusFromQueue, syncStatusUnavailable } = loadTs('src/syncStatus.ts');
const empty = { pending: 0, failed: 0, conflicts: 0, mobileConflicts: 0 };

test('queue status distinguishes synced from connectivity and active synchronization', () => {
  assert.deepEqual(syncStatusFromQueue(empty, { offline: false, syncing: false }), { kind: 'available', status: 'synced', counts: empty });
  assert.equal(syncStatusFromQueue(empty, { offline: false, syncing: true }).status, 'syncing');
  assert.equal(syncStatusFromQueue(empty, { offline: true, syncing: false }).status, 'offline');
});

test('pending, failed, and unresolved conflict counts produce their actual queue states', () => {
  assert.equal(syncStatusFromQueue({ ...empty, pending: 2 }, { offline: false, syncing: false }).status, 'pending');
  assert.equal(syncStatusFromQueue({ ...empty, failed: 1 }, { offline: false, syncing: false }).status, 'failed');
  assert.equal(syncStatusFromQueue({ ...empty, conflicts: 1 }, { offline: false, syncing: false }).status, 'conflict');
  assert.equal(syncStatusFromQueue({ ...empty, mobileConflicts: 1 }, { offline: false, syncing: false }).status, 'conflict');
  assert.equal(syncStatusFromQueue({ ...empty, pending: 3 }, { offline: true, syncing: false }).status, 'offline');
});

test('unavailable queue reads retain a specific reason instead of claiming sync success', () => {
  for (const reason of ['not_signed_in', 'shop_context', 'storage', 'read']) {
    assert.deepEqual(syncStatusUnavailable(reason), { kind: 'unavailable', reason });
  }
});

test('Settings no longer labels every missing snapshot as an app-build limitation', () => {
  const app = readFileSync('App.tsx', 'utf8');
  assert.doesNotMatch(app, /Sync status is unavailable in this app build/);
  assert.match(app, /accountKey\(dataRef\.current\.shop\.phone \|\| ""\) !== accountId/);
  assert.match(app, /subscribeSyncState/);
});
