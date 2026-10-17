import mongoose from "mongoose";
import { Audit, Customer, Entry, Shop, User } from "../models.js";
import { customerOut, entryOut, shopOut } from "../utils/serializers.js";
import { phoneLookupVariants } from "../utils/phone.js";
import { normalizePhone } from "../utils/phone.js";
import { hasShopScopedData } from "./shopService.js";

const emptyReminders = {
  enabled: true,
  day: "Last day",
  time: "10:00",
  minimum: "100",
  whatsapp: true,
  sms: false,
};

export async function getBootstrap(user, shopId) {
  if (!shopId) {
    const [linkedShop, ownedShop, phoneShop] = await Promise.all([
      user.shopId ? Shop.findById(user.shopId).select("_id ownerId").lean() : null,
      Shop.findOne({ ownerId: user._id }).select("_id").lean(),
      Shop.findOne({ phone: { $in: phoneLookupVariants(user.phone) } }).select("_id ownerId").lean(),
    ]);
    if (linkedShop || ownedShop || phoneShop)
      throw Object.assign(new Error("Account and shop registration need support review"), { status: 409, code: "ACCOUNT_SHOP_LINK_CONFLICT" });
    if (user.shopId && await hasShopScopedData(user.shopId))
      throw Object.assign(new Error("Existing shop data needs support recovery before registration"), { status: 409, code: "ACCOUNT_SHOP_LINK_CONFLICT" });
    return {
      shop: { name: "", owner: "", address: "", phone: user.phone, whatsapp: "" },
      shopExists: false,
      shopComplete: false,
      customers: [], entries: [], audit: [], signedIn: true,
      language: "English", reminders: emptyReminders, defaultMethod: "Cash", read: [],
    };
  }
  const [owner, linkedShop] = await Promise.all([
    User.findOne({ _id: user._id, shopId }).select("_id").lean(),
    Shop.findOne({ _id: shopId, ownerId: user._id }).lean(),
  ]);
  if (!owner || !linkedShop || normalizePhone(linkedShop.phone) !== normalizePhone(user.phone))
    throw Object.assign(new Error("Account and shop registration need support review"), { status: 409, code: "ACCOUNT_SHOP_LINK_CONFLICT" });
  const [shop, customers, entries, audits] = await Promise.all([
    Promise.resolve(linkedShop),
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
    shopExists: true,
    shopComplete: Boolean(shop.name?.trim() && shop.owner?.trim()),
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
