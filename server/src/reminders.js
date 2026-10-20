import cron from "node-cron";
import mongoose from "mongoose";
import {
  Customer,
  Device,
  Entry,
  Notification,
  ReminderDelivery,
  Shop,
} from "./models.js";
import {
  isSmsConfigured,
  sendPush,
  sendSms,
  sendWhatsApp,
} from "./providers.js";

function localParts(date, timezone) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  const lastDay = new Date(`${values.year}-${values.month}-01T12:00:00Z`);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
  lastDay.setUTCDate(0);
  return {
    ...values,
    month: `${values.year}-${values.month}`,
    day: String(Number(values.day)),
    finalDay: String(lastDay.getUTCDate()),
  };
}
function intlPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length === 10
    ? `+91${digits}`
    : digits.length >= 11
      ? `+${digits}`
      : "";
}
export function startReminderWorker(log) {
  if (process.env.REMINDER_WORKER_ENABLED !== "true") {
    log.info("Reminder worker disabled");
    return;
  }
  const timezone = process.env.REMINDER_TIMEZONE || "Asia/Kolkata";
  cron.schedule(
    "* * * * *",
    async () => {
      try {
        const now = localParts(new Date(), timezone);
        const shops = await Shop.find({ "reminders.enabled": true })
          .select("_id name reminders")
          .lean();
        for (const shop of shops) {
          if (shop.reminders.time !== `${now.hour}:${now.minute}`) continue;
          if (shop.reminders.day === "Last day" && now.day !== now.finalDay)
            continue;
          if (
            shop.reminders.day !== "Last day" &&
            shop.reminders.day !== now.day
          )
            continue;
          const customers = await Customer.find({
            shopId: shop._id,
            reminder: true,
            deletedAt: { $exists: false },
            phone: { $ne: "" },
          }).lean();
          if (!customers.length) continue;
          const ids = customers.map((c) => c.clientId);
          const balances = await Entry.aggregate([
            {
              $match: {
                shopId: new mongoose.Types.ObjectId(shop._id),
                customerClientId: { $in: ids },
                deletedAt: { $exists: false },
              },
            },
            {
              $group: {
                _id: "$customerClientId",
                paise: {
                  $sum: {
                    $cond: [
                      { $in: ["$type", ["credit", "refund"]] },
                      "$amountPaise",
                      { $multiply: ["$amountPaise", -1] },
                    ],
                  },
                },
              },
            },
          ]);
          const totals = new Map(balances.map((x) => [x._id, x.paise]));
          for (const customer of customers) {
            const outstanding =
              Math.max(
                0,
                (customer.openingPaise || 0) - (customer.openingAdvancePaise || 0) +
                  (totals.get(customer.clientId) || 0),
              ) / 100;
            if (outstanding <= 0 || outstanding < Number(shop.reminders.minimum || 0)) continue;
            for (const channel of ["whatsapp", "sms"]) {
              if (!shop.reminders[channel]) continue;
              if (
                channel === "whatsapp" &&
                (!process.env.WHATSAPP_PHONE_NUMBER_ID ||
                  !process.env.WHATSAPP_ACCESS_TOKEN ||
                  !process.env.WHATSAPP_TEMPLATE_NAME)
              )
                continue;
              if (
                channel === "sms" &&
                !isSmsConfigured()
              )
                continue;
              const phone = intlPhone(customer.phone);
              if (!phone) continue;
              let claim;
              try {
                claim = await ReminderDelivery.create({
                  shopId: shop._id,
                  customerId: customer._id,
                  month: now.month,
                  channel,
                  status: "pending",
                });
              } catch (e) {
                if (e.code === 11000) continue;
                throw e;
              }
              try {
                if (channel === "whatsapp")
                  await sendWhatsApp(
                    phone,
                    process.env.WHATSAPP_TEMPLATE_NAME,
                    [customer.name, `₹${outstanding.toFixed(2)}`, shop.name],
                  );
                else
                  await sendSms(
                    phone,
                    { customer: customer.name, shop: shop.name, amount: outstanding },
                  );
                await ReminderDelivery.updateOne(
                  { _id: claim._id },
                  { $set: { status: "sent", sentAt: new Date() } },
                );
                const notification = await Notification.create({
                  shopId: shop._id,
                  title: "Reminder sent",
                  body: `A ${channel === "sms" ? "SMS" : "WhatsApp"} balance reminder was sent to ${customer.name}.`,
                });
                const tokens = await Device.find({ shopId: shop._id }).distinct(
                  "token",
                );
                if (tokens.length) {
                  try {
                    const receipts = await sendPush(
                      tokens,
                      "Khata reminder sent",
                      `A balance reminder was sent to ${customer.name}.`,
                    );
                    const invalid = (receipts?.data || [])
                      .map((r, i) =>
                        r.status === "error" &&
                        r.details?.error === "DeviceNotRegistered"
                          ? tokens[i]
                          : null,
                      )
                      .filter(Boolean);
                    if (invalid.length)
                      await Device.deleteMany({
                        shopId: shop._id,
                        token: { $in: invalid },
                      });
                } catch (e) {
                    log.warn(
                      {
                        errorName: e?.name || "Error",
                        notification: String(notification._id),
                      },
                      "push notification could not be delivered",
                    );
                  }
                }
              } catch (e) {
                // Keep the unique claim after an ambiguous provider timeout to prevent duplicate messages.
                log.error(
                  {
                    errorName: e?.name || "Error",
                    shopId: String(shop._id),
                    channel,
                  },
                  "scheduled reminder delivery failed",
                );
              }
            }
          }
        }
      } catch (err) {
        log.error(
          { errorName: err?.name || "Error" },
          "reminder worker iteration failed",
        );
      }
    },
    { timezone, noOverlap: true },
  );
  log.info({ timezone }, "Reminder worker enabled");
}
