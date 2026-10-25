import assert from 'node:assert/strict';
import test from 'node:test';
import { handle_post_ledger_id_restore } from '../server/src/controllers/ledgerController.js';

const entry = {
  id: 'txn-original', customerId: 'customer-one', type: 'payment', amount: 250,
  date: '2026-10-15', recordedAt: '2026-10-15T10:00:00.000Z', note: 'Paid',
  method: 'Cash', reference: '', appliedToUdhari: 250, addedToAdvance: 0, advanceApplied: 0,
};

function responseCapture() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('restore controller reports strict-schema fields safely before touching persistence', async () => {
  const res = responseCapture();
  await handle_post_ledger_id_restore({
    params: { id: entry.id },
    body: {
      expectedVersion: 2,
      expectedResolutionVersion: 1,
      audit: {
        id: 'restore-event', action: 'Restored transaction', date: '2026-10-27T10:00:00.000Z',
        before: { ...entry, createdAt: '2026-10-15T10:00:00.000Z' }, after: entry,
      },
    },
    get: () => 'transaction-restore:restore-event',
  }, res, (error) => { throw error; });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_TRANSACTION_RESTORATION');
  assert.deepEqual(res.body.details, [{ field: 'audit.before.createdAt', code: 'unrecognized_keys' }]);
  assert.equal(JSON.stringify(res.body).includes('2026-10-15T10:00:00.000Z'), false);
});
