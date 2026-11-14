import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { Notification, ShopSubscription } from "../models.js";
import { subscriptionConfig } from "../config/env.js";
// Only register future, server-verified reminders. Never reconstruct old OS alerts.
export async function prepareSubscriptionInbox(shopId, userId) {
  const now = new Date();
  const subscriptions = await ShopSubscription.find({
    shopId,
    status: { $in: ["active", "scheduled"] },
    startsAt: { $lte: now },
    expiresAt: { $gt: now },
  })
    .select("_id expiresAt planCode planSnapshot")
    .limit(20)
    .lean();
  const timezone = subscriptionConfig.reminderTimezone;
  const parts = (date) =>
    Object.fromEntries(
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
        .map((p) => [p.type, p.value]),
    );
  for (const sub of subscriptions) {
    if (
      await ShopSubscription.exists({
        shopId,
        _id: { $ne: sub._id },
        status: { $in: ["active", "scheduled"] },
        startsAt: { $lte: sub.expiresAt },
        expiresAt: { $gt: sub.expiresAt },
      })
    )
      continue;
    const expiry = parts(sub.expiresAt);
    const [hour, minute] = subscriptionConfig.reminderTime
      .split(":")
      .map(Number);
    for (const days of [15, 7, 3, 1, 0]) {
      const wallTime = Date.UTC(
        +expiry.year,
        +expiry.month - 1,
        +expiry.day - days,
        hour,
        minute,
      );
      let instant = wallTime;
      for (let i = 0; i < 3; i++) {
        const local = parts(new Date(instant));
        instant +=
          wallTime -
          Date.UTC(
            +local.year,
            +local.month - 1,
            +local.day,
            +local.hour,
            +local.minute,
          );
      }
      if (instant <= now.getTime()) continue;
      const id = new mongoose.Types.ObjectId(
        createHash("sha256")
          .update(`subscription:${shopId}:${sub._id}:expiry:${days}`)
          .digest("hex")
          .slice(0, 24),
      );
      try {
        await Notification.updateOne(
          { _id: id, shopId },
          {
            $setOnInsert: {
              recipientUserId: userId,
              title: "Digital-Khata subscription reminder",
              body: `Your ${sub.planSnapshot?.name || sub.planCode} plan ${days ? `expires in ${days} days` : "expires today"}. Open My Subscription to review your options.`,
              category: "subscription",
              read: false,
              createdAt: now,
              visibleAfter: new Date(instant),
              subscriptionReminderId: sub._id,
            },
          },
          { upsert: true },
        );
      } catch (e) {
        if (e.code !== 11000) throw e;
      }
    }
  }
}
