import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from '../server/node_modules/mongoose/index.js';
import { Audit, Customer, Entry, Idempotency, Shop, User } from '../server/src/models.js';

test('MongoDB soft delete and restore retain one ledger document, versions, audit, and balances', {
  skip: process.env.LEDGER_RESTORE_MONGO_TEST !== '1',
}, async () => {
  const uri = 'mongodb://127.0.0.1:27031/?replicaSet=khataLedgerRestoreTest';
  Object.assign(process.env, {
    NODE_ENV: 'test', APP_MODE: 'testing',
    MONGODB_URI: uri, MONGODB_DB_NAME: 'digital_khata_ledger_restore_testing',
  });
  const { deleteLedgerEntry, listDeletedLedger, restoreLedgerEntry } = await import('../server/src/services/ledgerService.js');
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME, serverSelectionTimeoutMS: 5000 });
  const shopId = new mongoose.Types.ObjectId();
  const actorId = new mongoose.Types.ObjectId();
  const otherShopId = new mongoose.Types.ObjectId();
  const customerId = `restore-customer-${shopId}`;
  const transactionId = `restore-transaction-${shopId}`;
  try {
    await Promise.all([Idempotency.createIndexes(), Audit.createIndexes(), Entry.createIndexes()]);
    await User.create({ _id: actorId, phone: '+916203253537', shopId });
    await Shop.create({ _id: shopId, ownerId: actorId, name: 'Restore test', phone: '+916203253537' });
    await Customer.create({ shopId, clientId: customerId, name: 'Restore Customer', nameFolded: 'restore customer', phone: '', address: '', openingPaise: 500000, openingAdvancePaise: 0, limitPaise: 0, reminder: true, status: true, disabled: false, removed: false });
    await Entry.create({ shopId, clientId: transactionId, customerClientId: customerId, type: 'payment', amountPaise: 200000, date: '2026-10-15', recordedAt: new Date('2026-10-15T10:00:00Z'), note: 'Original payment', method: 'Cash', serverVersion: 1, resolutionVersion: 1 });

    const original = { id: transactionId, customerId, type: 'payment', amount: 2000, date: '2026-10-15', recordedAt: '2026-10-15T10:00:00.000Z', note: 'Original payment', method: 'Cash', reference: '' };
    const deleteAudit = { id: `delete-event-${shopId}`, action: 'Deleted transaction', date: '2026-10-26T10:00:00.000Z', before: original };
    const deleteArgs = { shopId, actorId, id: transactionId, baseVersion: 1, baseResolutionVersion: 1, audit: deleteAudit, key: `transaction-delete:${deleteAudit.id}`, requestHash: 'delete-request' };
    const deleted = await deleteLedgerEntry(deleteArgs);
    const deleteRetry = await deleteLedgerEntry(deleteArgs);
    assert.equal(deleted.entry.id, transactionId);
    assert.equal(deleted.entry.serverVersion, 2);
    assert.equal(deleteRetry.deletedAt, deleted.deletedAt);
    assert.equal(await Entry.countDocuments({ shopId, clientId: transactionId }), 1);
    assert.equal((await Entry.findOne({ shopId, clientId: transactionId }).lean()).deletedAt.toISOString(), deleted.deletedAt);
    assert.equal((await listDeletedLedger({ shopId, limit: 10 })).items.length, 1);
    assert.equal((await listDeletedLedger({ shopId: otherShopId, limit: 10 })).items.length, 0);

    const restoreAudit = { id: `restore-event-${shopId}`, action: 'Restored transaction', date: '2026-10-27T10:00:00.000Z', before: original, after: original };
    const restoreArgs = { shopId, actorId, id: transactionId, expectedVersion: 2, expectedResolutionVersion: 2, audit: restoreAudit, key: `transaction-restore:${restoreAudit.id}`, requestHash: 'restore-request' };
    const restored = await restoreLedgerEntry(restoreArgs);
    const restoreRetry = await restoreLedgerEntry(restoreArgs);
    assert.equal(restored.id, transactionId);
    assert.equal(restored.date, '2026-10-15');
    assert.equal(restored.serverVersion, 3);
    assert.equal(restoreRetry.serverVersion, 3);
    assert.equal(await Entry.countDocuments({ shopId, clientId: transactionId }), 1);
    assert.equal(await Entry.countDocuments({ shopId, clientId: transactionId, deletedAt: { $exists: false } }), 1);
    assert.equal((await listDeletedLedger({ shopId, limit: 10 })).items.length, 0);
    await Idempotency.deleteOne({ shopId, key: restoreArgs.key });
    const retryAfterIdempotencyExpiry = await restoreLedgerEntry(restoreArgs);
    assert.equal(retryAfterIdempotencyExpiry.serverVersion, 3);
    const active = await Entry.find({ shopId, customerClientId: customerId, deletedAt: { $exists: false } }).lean();
    assert.equal(((500000 - 0) - active.reduce((sum, item) => sum + (item.type === 'payment' ? item.amountPaise : -item.amountPaise), 0)) / 100, 3000);
    assert.equal(await Audit.countDocuments({ shopId, clientId: { $in: [deleteAudit.id, restoreAudit.id] } }), 2);
    await assert.rejects(restoreLedgerEntry({ ...restoreArgs, audit: { ...restoreAudit, id: `different-restore-${shopId}` }, key: 'stale-restore', requestHash: 'stale', expectedVersion: 2 }), (error) => error.status === 409);
  } finally {
    await Promise.all([
      Entry.deleteMany({ shopId }), Customer.deleteMany({ shopId }), Audit.deleteMany({ shopId }),
      Idempotency.deleteMany({ shopId }), Shop.deleteMany({ _id: shopId }), User.deleteMany({ _id: actorId }),
    ]);
    await mongoose.disconnect();
  }
});
