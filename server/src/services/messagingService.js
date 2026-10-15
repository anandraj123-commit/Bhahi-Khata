import mongoose from "mongoose";
import { Customer, Entry, Shop } from "../models.js";
import { env } from "../config/env.js";
import { isSmsConfigured, sendSms, sendWhatsApp } from "../providers.js";

function serviceError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function optedInCustomer(shopId, customerId) {
  const customer = await Customer.findOne({
    shopId,
    clientId: customerId,
    deletedAt: { $exists: false },
  }).lean();
  if (!customer) throw serviceError("Customer not found", 404);
  if (!customer.reminder)
    throw serviceError("Customer has opted out of reminders", 403);
  return customer;
}

export async function sendCustomerWhatsApp({ shopId, customerId, parameters }) {
  if (
    !env.WHATSAPP_TEMPLATE_NAME ||
    !env.WHATSAPP_PHONE_NUMBER_ID ||
    !env.WHATSAPP_ACCESS_TOKEN
  )
    throw serviceError("WhatsApp messaging is not configured", 503);
  const customer = await optedInCustomer(shopId, customerId);
  const number = customer.phone.replace(/\D/g, "");
  if (number.length < 10)
    throw serviceError("Customer phone number is missing", 400);
  await sendWhatsApp(
    number.startsWith("91") ? `+${number}` : `+91${number}`,
    env.WHATSAPP_TEMPLATE_NAME,
    parameters,
  );
}

export async function sendCustomerSms({ shopId, customerId }) {
  const customer = await optedInCustomer(shopId, customerId);
  if (!isSmsConfigured())
    throw serviceError("SMS messaging is not configured", 503);
  const phone = customer.phone.replace(/\D/g, "");
  if (phone.length < 10)
    throw serviceError("Customer phone number is missing", 400);
  const shop = await Shop.findById(shopId).select("name").lean();
  const [{ total = 0 } = {}] = await Entry.aggregate([
    {
      $match: {
        shopId: new mongoose.Types.ObjectId(shopId),
        customerClientId: customer.clientId,
        deletedAt: { $exists: false },
      },
    },
    {
      $group: {
        _id: null,
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
  const due = Math.max(0, (customer.openingPaise || 0) + total) / 100;
  await sendSms(
    phone.length === 10 ? `+91${phone}` : `+${phone}`,
    { customer: customer.name, shop: shop.name, amount: due },
  );
}
