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
    }).formatToParts(value).map((part) => [part.type, part.value]),
  );
  return {
    dayNumber: Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86400000),
    time: `${parts.hour}:${parts.minute}`,
  };
}

export function startSubscriptionReminderWorker(log = logger) {
  if (!subscriptionConfig.pushEnabled) {
    log.info("Subscription push reminder worker disabled");
    return;
  }
  const { reminderTimezone: timezone, reminderTime } = subscriptionConfig;
  cron.schedule(
    "* * * * *",
    async () => {
      try {
        const now = new Date();
        const today = localDayNumber(now, timezone);
        if (today.time !== reminderTime) return;
        const rows = await ShopSubscription.find({
          status: { $in: ["active", "scheduled"] },
          startsAt: { $lte: now },
          expiresAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        }).select("shopId planCode planSnapshot startsAt expiresAt").lean();
        for (const subscription of rows) {
          const expiryDay = localDayNumber(subscription.expiresAt, timezone).dayNumber;
          const days = expiryDay - today.dayNumber;
          if (![15, 7, 3, 1, 0].includes(days)) continue;
          const renewed = await ShopSubscription.exists({
            shopId: subscription.shopId,
            _id: { $ne: subscription._id },
            status: "scheduled",
            startsAt: { $lte: subscription.expiresAt },
            expiresAt: { $gt: subscription.expiresAt },
          });
          if (renewed) continue;
          const planName = subscription.planSnapshot?.name || subscription.planCode;
          const remaining = days === 0 ? "expires today" : `expires in ${days} ${days === 1 ? "day" : "days"}`;
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
        log.error(safeErrorContext(error), "subscription reminder worker iteration failed");
      }
    },
    { timezone, noOverlap: true },
  );
  log.info({ timezone, reminderTime }, "Subscription push reminder worker enabled");
}
