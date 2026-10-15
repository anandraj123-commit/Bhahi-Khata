import mongoose from "mongoose";
import { Audit, Customer, Entry, Shop } from "../models.js";
import { customerOut, entryOut, shopOut } from "../utils/serializers.js";

export async function getBootstrap(shopId) {
  const [shop, customers, entries, audits] = await Promise.all([
    Shop.findById(shopId).lean(),
    Customer.find({ shopId, deletedAt: { $exists: false } })
      .sort({ nameFolded: 1, _id: 1 })
      .limit(500)
      .lean(),
    Entry.find({ shopId, deletedAt: { $exists: false } })
      .sort({ date: -1, _id: -1 })
      .limit(2000)
      .lean(),
    Audit.find({ shopId }).sort({ occurredAt: -1, _id: -1 }).limit(500).lean(),
  ]);
  const customerIds = customers.map((customer) => customer.clientId);
  const totals = await Entry.aggregate([
    {
      $match: {
        shopId: new mongoose.Types.ObjectId(shopId),
        customerClientId: { $in: customerIds },
        deletedAt: { $exists: false },
      },
    },
    {
      $group: {
        _id: "$customerClientId",
        total: {
          $sum: {
            $cond: [
              { $eq: ["$type", "credit"] },
              "$amountPaise",
              { $multiply: ["$amountPaise", -1] },
            ],
          },
        },
      },
    },
  ]);
  const creditById = new Map(totals.map((item) => [item._id, item.total]));
  const byId = new Map(
    customers.map((customer) => [
      customer.clientId,
      (customer.openingPaise || 0) + (creditById.get(customer.clientId) || 0),
    ]),
  );
  return {
    shop: shopOut(shop),
    customers: customers.map(customerOut),
    entries: entries.map(entryOut),
    audit: audits.map((item) => ({
      id: item.clientId,
      action: item.action,
      date: item.occurredAt.toISOString(),
      ...(item.before ? { before: item.before } : {}),
      ...(item.after ? { after: item.after } : {}),
    })),
    signedIn: true,
    language: shop.language || "English",
    reminders: shop.reminders,
    defaultMethod: shop.defaultMethod,
    read: shop.readAuditIds || [],
    summary: {
      customers: customers.length,
      duePaise: [...byId.values()].reduce((sum, amount) => sum + Math.max(amount, 0), 0),
      balanceByCustomer: Object.fromEntries(byId),
    },
  };
}
