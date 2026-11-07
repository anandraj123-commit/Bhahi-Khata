/** Read-only deployment preflight; never modifies purchases or customer records. */
import '../config/startupGuard.js';
import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { ShopSubscription, PaymentOrder } from '../models.js';
await connectDatabase();
try {
  const rows = await ShopSubscription.find({ status: { $in: ['active', 'scheduled', 'paused'] } }).select('shopId status startsAt expiresAt sourcePaymentOrderId').sort({ shopId: 1, startsAt: 1 }).lean();
  const issues = [];
  const last = new Map();
  for (const row of rows) {
    const key = String(row.shopId), previous = last.get(key);
    if (!row.expiresAt || +row.expiresAt <= +row.startsAt) issues.push({ subscriptionId: String(row._id), reason: 'non-finite-or-invalid-interval' });
    if (previous && (!previous.expiresAt || +previous.expiresAt > +row.startsAt)) issues.push({ subscriptionId: String(row._id), reason: 'overlapping-interval', previousId: String(previous._id) });
    last.set(key, row);
  }
  const legacyWalletOrders = await PaymentOrder.countDocuments({ status: 'paid', amountMinor: 0 });
  console.log(JSON.stringify({ readOnly: true, checked: rows.length, issues, paidWalletOrders: legacyWalletOrders, note: 'Legacy wallet orders are idempotent by order key; historical records do not require backfill.' }, null, 2));
  if (issues.length) process.exitCode = 1;
} finally { await mongoose.disconnect(); }
