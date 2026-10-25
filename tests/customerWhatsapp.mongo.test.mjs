import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from '../server/node_modules/mongoose/index.js';
import { Customer, Shop, User } from '../server/src/models.js';
import { customerCreateSchema, customerSchema } from '../server/src/validators/schemas.js';
import { customerOut } from '../server/src/utils/serializers.js';

// Opt-in, fixed localhost port: never use application database credentials.
test('MongoDB customer create/update/remove, shop isolation and conflict resolution', { skip: process.env.WHATSAPP_MONGO_TEST !== '1' }, async () => {
  Object.assign(process.env, { NODE_ENV: 'test', APP_MODE: 'testing', JWT_SECRET: 'whatsapp-isolated-test-secret-only-123456', MONGODB_URI: 'mongodb://127.0.0.1:27029/?replicaSet=khataWhatsappTest', MONGODB_DB_NAME: 'digital_khata_testing' });
  const { createCustomer, updateCustomer, listCustomers, resolveCustomerConflict } = await import('../server/src/services/customersService.js');
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME, serverSelectionTimeoutMS: 5000 });
  try {
    const shopId = new mongoose.Types.ObjectId(), actorId = new mongoose.Types.ObjectId(), otherShop = new mongoose.Types.ObjectId();
    await User.create({ _id: actorId, phone: '+919876543210', shopId });
    await Shop.create({ _id: shopId, ownerId: actorId, name: 'WhatsApp test', phone: '+919876543210' });
    const base = { id: 'whatsapp-test', name: 'Synthetic Customer', phone: '', address: 'Test', opening: 25, openingAdvance: 0, limit: 100, reminder: false };
    const legacy = await createCustomer({ shopId, actorId, customer: customerCreateSchema.parse({ ...base, id: 'legacy-test' }) });
    assert.equal(customerOut(legacy).whatsappNumber, '');
    const created = await createCustomer({ shopId, actorId, customer: customerCreateSchema.parse({ ...base, whatsappNumber: '+91 98765 43210' }) });
    assert.equal((await Customer.findById(created._id).lean()).whatsappNumber, '9876543210');
    const moneyBefore = [created.openingPaise, created.openingAdvancePaise, created.limitPaise, created.financialVersion];
    const input = (doc, value) => customerSchema.parse({ ...base, openingDate: customerOut(doc).openingDate, ...(value !== undefined ? { whatsappNumber: value } : {}) });
    let doc = await updateCustomer({ shopId, actorId, customer: input(created, '8765432109'), baseVersion: 1, baseResolutionVersion: 1 });
    assert.equal(doc.whatsappNumber, '8765432109');
    // A stale offline change must fail rather than overwrite the new server value.
    await assert.rejects(updateCustomer({ shopId, actorId, customer: input(created, '7654321098'), baseVersion: 1 }), (e) => e.status === 409 && e.current.whatsappNumber === '8765432109');
    const resolved = await resolveCustomerConflict({ shopId, actorId, customerId: base.id, key: 'whatsapp-resolution', requestHash: 'test-hash', conflictId: 'whatsapp-conflict', input: { resolutionId: 'resolution-1', choice: 'keep_local', proposed: input(doc, '7654321098'), expectedVersion: doc.serverVersion, expectedResolutionVersion: doc.resolutionVersion } });
    assert.equal(resolved.customer.whatsappNumber, '7654321098');
    doc = await Customer.findById(created._id);
    // Older clients omit the field; their ordinary profile edits preserve it.
    doc = await updateCustomer({ shopId, actorId, customer: { ...input(doc), name: 'Renamed' }, baseVersion: doc.serverVersion });
    assert.equal(doc.whatsappNumber, '7654321098');
    doc = await updateCustomer({ shopId, actorId, customer: { ...input(doc, ''), name: 'Renamed' }, baseVersion: doc.serverVersion });
    assert.equal((await Customer.findById(created._id).lean()).whatsappNumber, '');
    assert.deepEqual([doc.openingPaise, doc.openingAdvancePaise, doc.limitPaise, doc.financialVersion], moneyBefore);
    assert.equal(doc.phone, '');
    await assert.rejects(updateCustomer({ shopId: otherShop, actorId, customer: input(doc, '9876543210') }), (e) => e.status === 404);
    assert.deepEqual((await listCustomers({ shopId: otherShop, limit: 30 })).items, []);
    assert.equal((await listCustomers({ shopId, limit: 30 })).items.find((c) => c.id === base.id).whatsappNumber, '');
    // Duplicate WhatsApp contact numbers are allowed, including within a shop.
    for (const id of ['shared-one', 'shared-two']) await createCustomer({ shopId, actorId, customer: customerCreateSchema.parse({ ...base, id, whatsappNumber: '9876543210' }) });
  } finally { await mongoose.disconnect(); }
});
