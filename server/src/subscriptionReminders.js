import cron from "node-cron";
import { ShopSubscription } from "./models.js";
import { subscriptionConfig } from "./config/env.js";
import { log as logger, safeErrorContext } from "./config/logger.js";
import { sendSubscriptionPush } from "./services/subscriptionNotificationService.js";

function localDayNumber(value, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(value)
      .map((part) => [part.type, part.value]),
  );
  return {
    dayNumber: Math.floor(
      Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) /
        86400000,
    ),
    time: `${parts.hour}:${parts.minute}`,
  };
}

let task,
  cursor = null,
  scanDay = null;
export async function processSubscriptionReminders(log = logger) {
  const { reminderTimezone: timezone, reminderTime } = subscriptionConfig;

  try {
    const now = new Date();
    const today = localDayNumber(now, timezone);
    if (today.time < reminderTime) return;
    if (scanDay !== today.dayNumber) {
      cursor = null;
      scanDay = today.dayNumber;
    }
    const rows = await ShopSubscription.find({
      ...(cursor ? { _id: { $gt: cursor } } : {}),
      status: { $in: ["active", "scheduled", "expired"] },
      startsAt: { $lte: now },
      expiresAt: {
        $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        $lte: new Date(now.getTime() + 16 * 86400000),
      },
    })
      .sort({ _id: 1 })
      .limit(100)
      .select("shopId planCode planSnapshot startsAt expiresAt")
      .lean();
    if (!rows.length) cursor = null;
    for (const subscription of rows) {
      cursor = subscription._id;
      const expiryDay = localDayNumber(
        subscription.expiresAt,
        timezone,
      ).dayNumber;
      const days = expiryDay - today.dayNumber;
      if (![15, 7, 3, 1, 0].includes(days)) continue;
      const renewed = await ShopSubscription.exists({
        shopId: subscription.shopId,
        _id: { $ne: subscription._id },
        status: { $in: ["active", "scheduled"] },
        startsAt: { $lte: subscription.expiresAt },
        expiresAt: { $gt: subscription.expiresAt },
      });
      if (renewed) continue;
      const planName = subscription.planSnapshot?.name || subscription.planCode;
      const remaining =
        days === 0
          ? "expires today"
          : `expires in ${days} ${days === 1 ? "day" : "days"}`;
      await sendSubscriptionPush({
        shopId: subscription.shopId,
        subscriptionId: subscription._id,
        notificationType: `expiry_${days}`,
        deduplicationKey: `${subscription._id}:expiry:${days}`,
        title: "Digital-Khata subscription reminder",
        body: `Your ${planName} plan ${remaining}. Open My Subscription to review your options.`,
      });
    }
  } catch (error) {
    log.error(
      safeErrorContext(error),
      "subscription reminder worker iteration failed",
    );
  }
}
export function startSubscriptionReminderWorker(log = logger) {
  if (task) return task;
  // The notification publisher owns this phase when enabled, including its dedicated entrypoint.
  if (process.env.ADMIN_NOTIFICATION_WORKER_ENABLED === "true") return;
  if (!subscriptionConfig.pushEnabled) return;
  task = cron.schedule("* * * * *", () => processSubscriptionReminders(log), {
    timezone: subscriptionConfig.reminderTimezone,
    noOverlap: true,
  });
  return task;
}
