import mongoose from "mongoose";
import { Customer } from "../models.js";
import { paise } from "../utils/money.js";
import { customerOut } from "../utils/serializers.js";
import { sameCustomerValues } from "../utils/records.js";
import { saveAudit } from "./auditService.js";
import {
  ensureCustomerUsage,
  releaseCustomerCapacity,
  reserveCustomerCapacity,
} from "./subscriptionService.js";

export async function listCustomers({ shopId, query, cursorId, limit }) {
  const filter = { shopId, deletedAt: { $exists: false } };
  if (query)
    filter.nameFolded = {
      $regex: `^${query.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    };
  if (cursorId) {
    const cursor = await Customer.findOne({ shopId, clientId: cursorId })
      .select("_id nameFolded")
      .lean();
    if (cursor)
      filter.$or = [
        { nameFolded: { $gt: cursor.nameFolded } },
        { nameFolded: cursor.nameFolded, _id: { $gt: cursor._id } },
      ];
  }
  const rows = await Customer.find(filter)
    .sort({ nameFolded: 1, _id: 1 })
    .limit(limit + 1)
    .lean();
  const more = rows.length > limit;
  if (more) rows.pop();
  return {
    items: rows.map(customerOut),
    nextCursor: more ? rows.at(-1).clientId : null,
  };
}

export async function createCustomer({ shopId, actorId, customer, audit }) {
  await ensureCustomerUsage(shopId);
  const session = await mongoose.startSession();
  let doc;
  try {
    await session.withTransaction(async () => {
      doc = await Customer.findOne({
        shopId,
        clientId: customer.id,
      }).session(session);
      if (doc) {
        if (doc.deletedAt || !sameCustomerValues(customerOut(doc), customer))
          throw Object.assign(new Error("Customer identifier already exists"), {
            status: 409,
          });
      } else {
        await reserveCustomerCapacity({ shopId, session });
        doc = await Customer.findOneAndUpdate(
            { shopId, clientId: customer.id },
          {
            $set: {
              shopId,
              clientId: customer.id,
              name: customer.name,
              nameFolded: customer.name.toLocaleLowerCase("en"),
              phone: customer.phone,
              address: customer.address,
              openingPaise: paise(customer.opening),
              limitPaise: paise(customer.limit),
              reminder: customer.reminder,
            },
          },
          { upsert: true, new: true, runValidators: true, session },
        );
      }
      if (audit)
        await saveAudit({ shopId, actorId, session }, audit);
    });
  } finally {
    await session.endSession();
  }
  return doc;
}

export async function updateCustomer({ shopId, actorId, customer, base, audit }) {
  const session = await mongoose.startSession();
  let doc;
  try {
    await session.withTransaction(async () => {
      doc = await Customer.findOne({
        shopId,
        clientId: customer.id,
        deletedAt: { $exists: false },
      }).session(session);
      if (!doc)
        throw Object.assign(new Error("Customer not found"), { status: 404 });
      const current = customerOut(doc);
      if (
        base?.success &&
        !sameCustomerValues(current, base.data) &&
        !sameCustomerValues(current, customer)
      )
        throw Object.assign(new Error("Customer changed on another device"), {
          status: 409,
        });
      if (!sameCustomerValues(current, customer)) {
        doc.set({
          name: customer.name,
          nameFolded: customer.name.toLocaleLowerCase("en"),
          phone: customer.phone,
          address: customer.address,
          openingPaise: paise(customer.opening),
          limitPaise: paise(customer.limit),
          reminder: customer.reminder,
        });
        await doc.save({ session });
      }
      if (audit)
        await saveAudit({ shopId, actorId, session }, audit);
    });
  } finally {
    await session.endSession();
  }
  return doc;
}

export async function deleteCustomer({ shopId, id, base }) {
  await ensureCustomerUsage(shopId);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const customer = await Customer.findOne({ shopId, clientId: id }).session(
        session,
      );
      if (!customer)
        throw Object.assign(new Error("Customer not found"), { status: 404 });
      if (customer.deletedAt) return;
      if (base?.success && !sameCustomerValues(customerOut(customer), base.data))
        throw Object.assign(new Error("Customer changed on another device"), {
          status: 409,
        });
      customer.deletedAt = new Date();
      await customer.save({ session });
      await releaseCustomerCapacity({ shopId, session });
    });
  } finally {
    await session.endSession();
  }
}
