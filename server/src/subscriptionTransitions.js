import cron from 'node-cron';
import mongoose from 'mongoose';
import { Shop, ShopSubscription, SubscriptionAuditLog } from './models.js';
import { effectiveStatus } from './services/subscriptionTimeline.js';
import { safeErrorContext } from './config/logger.js';
/** Materialize derived statuses for reporting. Authorization always uses dates. */
export async function reconcileSubscriptionTransitions(shopId, now = new Date()) {
  return mongoose.connection.transaction(async session => {
    await Shop.updateOne({ _id: shopId }, { $inc: { entitlementRevision: 1 } }, { session });
    const rows = await ShopSubscription.find({ shopId, status: { $in: ['active', 'paused', 'scheduled'] } }).session(session).lean();
    let changed = 0;
    for (const row of rows) {
      const status = effectiveStatus(row, now);
      if (status === row.status) continue;
      await ShopSubscription.updateOne({ _id: row._id, status: row.status }, { $set: { status, ...(status === 'active' ? { activatedAt: row.startsAt } : {}) } }, { session });
      const eventType = status === 'expired' ? 'subscription_expired' : row.status === 'paused' ? 'subscription_resumed' : 'subscription_activated';
      await SubscriptionAuditLog.updateOne({ referenceId: `transition:${row._id}:${+row.startsAt}`, eventType }, { $setOnInsert: { shopId, referenceId: `transition:${row._id}:${+row.startsAt}`, eventType, actorType: 'system', occurredAt: status === 'expired' ? row.expiresAt : row.startsAt, newPlan: row.planSnapshot } }, { session, upsert: true });
      changed++;
    }
    return changed;
  });
}
export function startSubscriptionTransitionWorker(log) {
  cron.schedule('* * * * *', async () => {
    const now = new Date();
    try {
      const ids = await ShopSubscription.distinct('shopId', { status: { $in: ['active', 'scheduled', 'paused'] }, $or: [{ expiresAt: { $lte: now } }, { status: { $in: ['scheduled', 'paused'] }, startsAt: { $lte: now } }] });
      for (const id of ids) {
        try { await reconcileSubscriptionTransitions(id, now); }
        catch (error) { log.error({ shopId: String(id), ...safeErrorContext(error) }, 'Subscription transition reporting failed; date-based entitlements remain authoritative'); }
      }
    } catch (error) { log.error(safeErrorContext(error), 'Subscription transition scan failed'); }
  }, { noOverlap: true });
}
