import mongoose from 'mongoose';
import { Customer, Shop, SubscriptionUsage, SubscriptionAuditLog, Idempotency } from '../models.js';
import { getCurrentSubscription, getOperationalPlan } from './subscriptionService.js';
import { digest } from '../utils/hashing.js';
const active = { deletedAt: { $exists: false }, status: { $ne: false }, disabled: { $ne: true }, removed: { $ne: true } };
const failure = (message, code = 'CUSTOMER_LIMIT_REACHED') => Object.assign(new Error(message), { status: 409, code });
export async function assertCustomerOperation(shopId, customer, session, collectionOnly = false) {
  // Serialize checks with selection, customer creation and subscription purchases.
  await Shop.updateOne({ _id: shopId }, { $inc: { entitlementRevision: 1 } }, { session });
  const plan = await getOperationalPlan(shopId, session);
  const count = await Customer.countDocuments({ shopId, ...active, subscriptionArchived: { $ne: true } }).session(session);
  const restricted = customer.subscriptionArchived || (!plan.unlimitedCustomers && count > plan.customerLimit);
  if (!collectionOnly && (restricted || plan.entitlements?.credit === false))
    throw failure('Select active customers within your current plan limit before adding credit. Existing records and collections remain available.');
  return restricted;
}
export async function getCustomerSelection(shopId) {
  const current = await getCurrentSubscription(shopId);
  const rows = await Customer.find({ shopId, ...active }).select('clientId name subscriptionArchived updatedAt').sort({ updatedAt: -1, _id: 1 }).lean();
  return { limit: current.plan.unlimitedCustomers ? null : current.plan.customerLimit,
    version: digest(JSON.stringify(rows.map(r => [r.clientId, r.subscriptionArchived, r.updatedAt]))),
    customers: rows.map(r => ({ id: r.clientId, name: r.name, archived: !!r.subscriptionArchived })),
    suggestedIds: rows.slice(0, current.plan.unlimitedCustomers ? rows.length : current.plan.customerLimit).map(r => r.clientId),
  };
}
export async function applyCustomerSelection({ shopId, actorId, activeIds, operationId, expectedVersion }) {
  const key = `customer-selection:${operationId}`;
  const requestHash = digest(JSON.stringify({ activeIds: [...activeIds].sort(), expectedVersion }));
  return mongoose.connection.transaction(async session => {
    await Shop.updateOne({ _id: shopId }, { $inc: { entitlementRevision: 1 } }, { session });
    const prior = await Idempotency.findOne({ shopId, key }).session(session).lean();
    if (prior) {
      if (prior.requestHash !== requestHash) throw failure('Selection identifier was reused for different choices.');
      return prior.response;
    }
    const rows = await Customer.find({ shopId, ...active }).select('clientId name subscriptionArchived updatedAt').sort({ updatedAt: -1, _id: 1 }).session(session).lean();
    if (expectedVersion !== digest(JSON.stringify(rows.map(r => [r.clientId, r.subscriptionArchived, r.updatedAt]))))
      throw failure('Customers changed on another device. Review the selection again.');
    const plan = await getOperationalPlan(shopId, session);
    if (new Set(activeIds).size !== activeIds.length || activeIds.some(id => !rows.some(r => r.clientId === id)))
      throw failure('Selection contains invalid or duplicate customers.');
    if (!plan.unlimitedCustomers && activeIds.length > plan.customerLimit) throw failure('Selection exceeds the current plan limit.');
    const selected = new Set(activeIds);
    for (const row of rows) {
      const archived = !selected.has(row.clientId);
      if (archived === !!row.subscriptionArchived) continue;
      await Customer.updateOne({ _id: row._id }, { $set: { subscriptionArchived: archived }, $inc: { serverVersion: 1, resolutionVersion: 1 } }, { session });
    }
    await SubscriptionUsage.updateOne({ shopId }, { $set: { activeCustomers: activeIds.length } }, { upsert: true, session });
    await SubscriptionAuditLog.create([{ shopId, eventType: 'customer_selection_applied', referenceId: key,
      actorType: 'shopkeeper', actorId, occurredAt: new Date(), metadata: { activeIds, archivedCount: rows.length - activeIds.length },
    }], { session });
    const response = { activeIds, archivedIds: rows.filter(r => !selected.has(r.clientId)).map(r => r.clientId) };
    await Idempotency.create([{ shopId, key, requestHash, response }], { session });
    return response;
  });
}
