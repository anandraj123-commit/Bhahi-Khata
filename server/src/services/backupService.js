import mongoose from "mongoose";
import { Audit, Customer, Entry, Idempotency, Notification, Shop, SubscriptionUsage } from "../models.js";
import { paise } from "../utils/money.js";
import { reconcileCustomerAllocations } from "./ledgerService.js";

export async function restoreBackup({ shopId, user, data }) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const shop = await Shop.findOne({
        _id: shopId,
        ownerId: user._id,
      }).session(session);
      if (!shop) throw Object.assign(new Error("Shop not found"), { status: 404 });
      if (
        data.shop.phone.replace(/\D/g, "").slice(-10) !==
        user.phone.replace(/\D/g, "").slice(-10)
      )
        throw Object.assign(new Error("Backup phone does not match this account"), {
          status: 403,
        });
      await Promise.all([
        Customer.deleteMany({ shopId }, { session }),
        Entry.deleteMany({ shopId }, { session }),
        Audit.deleteMany({ shopId }, { session }),
        Notification.deleteMany({ shopId }, { session }),
        Idempotency.deleteMany({ shopId }, { session }),
      ]);
      shop.name = data.shop.name;
      shop.owner = data.shop.owner;
      shop.address = data.shop.address;
      shop.phone = user.phone;
      shop.whatsapp = data.shop.whatsapp;
      shop.language = data.language;
      shop.defaultMethod = data.defaultMethod;
      shop.reminders = data.reminders;
      shop.readAuditIds = data.read;
      await shop.save({ session });
      if (data.customers.length)
        await Customer.insertMany(
          data.customers.map((customer) => {
            return {
              shopId,
              clientId: customer.id,
              name: customer.name,
              nameFolded: customer.name.toLocaleLowerCase("en"),
              phone: customer.phone,
              ...(customer.phone ? { phoneNormalized: customer.phone } : {}),
              phoneActive: Boolean(customer.phone),
              address: customer.address,
              openingPaise: paise(customer.opening),
              openingAdvancePaise: paise(customer.openingAdvance || 0),
              openingDate: customer.openingDate
                ? new Date(`${customer.openingDate}T00:00:00.000Z`)
                : customer.createdAt
                  ? new Date(customer.createdAt)
                  : undefined,
              limitPaise: paise(customer.limit),
              reminder: customer.reminder,
              status: customer.status ?? true,
              disabled: customer.disabled ?? false,
              removed: customer.removed ?? false,
              ...(customer.createdAt ? { createdAt: new Date(customer.createdAt) } : {}),
            };
          }),
          { session, ordered: true },
        );
      await SubscriptionUsage.updateOne(
        { shopId },
        { $set: { activeCustomers: data.customers.filter((customer) => customer.status ?? true).filter((customer) => !customer.disabled && !customer.removed).length }, $setOnInsert: { shopId } },
        { session, upsert: true },
      );
      if (data.entries.length)
        await Entry.insertMany(
          data.entries.map((entry) => ({
            shopId,
            clientId: entry.id,
            customerClientId: entry.customerId,
            type: entry.type,
            amountPaise: paise(entry.amount),
            date: entry.date,
            ...(entry.recordedAt ? { recordedAt: new Date(entry.recordedAt) } : {}),
            note: entry.note,
            method: entry.method,
            reference: entry.reference || "",
          })),
          { session, ordered: true },
        );
      for (const customer of data.customers)
        await reconcileCustomerAllocations(shopId, customer.id, session);
      if (data.audit.length)
        await Audit.insertMany(
          data.audit.map((item) => ({
            shopId,
            actorId: user._id,
            clientId: item.id,
            action: item.action,
            occurredAt: new Date(item.date),
            ...(item.before ? { before: item.before } : {}),
            ...(item.after ? { after: item.after } : {}),
          })),
          { session, ordered: true },
        );
    });
  } finally {
    await session.endSession();
  }
}
