import { campaignReceiptId } from "../services/notificationsService.js";
import { processSubscriptionReminders } from "../subscriptionReminders.js";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import cron from "node-cron";
import { AdminNotification } from "./models.js";
import { Notification, Shop, User, Device } from "../models.js";
import { pollNotificationReceipts } from "./receipts.js";
import { sendPush } from "../providers.js";
for (const key of [
  "ADMIN_NOTIFICATION_WORKER_ENABLED",
  "ADMIN_NOTIFICATION_PUSH_ENABLED",
])
  if (
    process.env[key] !== undefined &&
    !["true", "false"].includes(process.env[key])
  )
    throw Error(`${key} must be true or false`);
let task;
export async function publishDueNotifications() {
  const now = new Date(),
    token = randomUUID();
  const campaign = await AdminNotification.findOneAndUpdate(
    {
      appMode: process.env.APP_MODE,
      status: true,
      deletedAt: { $exists: false },
      displayOn: { $lte: now },
      state: { $ne: "published" },
      $and: [
        {
          $or: [
            { leaseUntil: { $exists: false } },
            { leaseUntil: { $lt: now } },
          ],
        },
        {
          $or: [
            { nextAttemptAt: { $exists: false } },
            { nextAttemptAt: { $lte: now } },
          ],
        },
      ],
    },
    {
      $set: {
        leaseToken: token,
        leaseUntil: new Date(now.getTime() + 120000),
        state: "processing",
      },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { displayOn: 1, _id: 1 } },
  ).lean();
  if (!campaign) return;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await AdminNotification.findOne({
        _id: campaign._id,
        leaseToken: token,
        status: true,
        deletedAt: { $exists: false },
      })
        .session(session)
        .lean();
      if (!current) return;
      const cutoff = current.audienceCutoff || now;
      const shops = await Shop.find({
        createdAt: { $lte: cutoff },
        ...(current.cursor ? { _id: { $gt: current.cursor } } : {}),
        ...(current.recipientType === "selected"
          ? {
              _id: {
                $in: current.shopIds,
                ...(current.cursor ? { $gt: current.cursor } : {}),
              },
            }
          : {}),
      })
        .sort({ _id: 1 })
        .limit(50)
        .select("_id ownerId")
        .session(session)
        .lean();
      const owners = await User.find({
        _id: { $in: shops.map((s) => s.ownerId) },
        disabledAt: { $exists: false },
      })
        .select("_id shopId")
        .session(session)
        .lean();
      const eligible = new Set(owners.map((u) => `${u._id}:${u.shopId}`));
      let published = 0;
      for (const shop of shops) {
        if (!eligible.has(`${shop.ownerId}:${shop._id}`)) continue;
        const prior = await Notification.findOne({
          campaignId: current._id,
          shopId: shop._id,
          recipientUserId: shop.ownerId,
        })
          .select("_id")
          .session(session)
          .lean();
        const id =
          prior?._id || campaignReceiptId(current._id, shop._id, shop.ownerId);
        await Notification.updateOne(
          { _id: id, campaignId: current._id, shopId: shop._id },
          {
            $setOnInsert: {
              shopId: shop._id,
              recipientUserId: shop.ownerId,
              campaignId: current._id,
              campaignMode: process.env.APP_MODE,
              title: current.title,
              body: current.preview,
              read: false,
              createdAt: now,
              pushState:
                process.env.ADMIN_NOTIFICATION_PUSH_ENABLED === "true"
                  ? "pending"
                  : "skipped",
            },
          },
          { upsert: true, session },
        );
        await Notification.updateOne(
          { _id: id, pushState: { $exists: false } },
          {
            $set: {
              pushState:
                process.env.ADMIN_NOTIFICATION_PUSH_ENABLED === "true"
                  ? "pending"
                  : "skipped",
            },
          },
          { session },
        );
        published += 1; // Cursor and count commit together, including pre-existing read receipts.
      }
      await AdminNotification.updateOne(
        { _id: current._id, leaseToken: token },
        {
          $set: {
            audienceCutoff: cutoff,
            publishedAt: current.publishedAt || now,
            state: shops.length < 50 ? "published" : "processing",
            ...(shops.length ? { cursor: shops.at(-1)._id } : {}),
            ...(shops.length < 50 ? { completedAt: now } : {}),
          },
          $inc: { publishedCount: published },
          $unset: {
            leaseToken: 1,
            leaseUntil: 1,
            nextAttemptAt: 1,
            lastError: 1,
          },
        },
        { session },
      );
    });
  } catch (error) {
    await AdminNotification.updateOne(
      { _id: campaign._id, leaseToken: token },
      {
        $set: {
          state: "failed",
          lastError: "PUBLICATION_RETRY_REQUIRED",
          nextAttemptAt: new Date(
            Date.now() +
              Math.min(60, 2 ** Math.min(campaign.attempts, 6)) * 60000,
          ),
        },
        $unset: { leaseToken: 1, leaseUntil: 1 },
      },
    );
    throw error;
  } finally {
    await session.endSession();
  }
}
export async function dispatchNotificationPush() {
  if (process.env.ADMIN_NOTIFICATION_PUSH_ENABLED !== "true") return;
  // Ambiguous claims are retained, never resent automatically.
  await Notification.updateMany(
    {
      campaignMode: process.env.APP_MODE,
      campaignId: { $exists: true },
      pushState: "claimed",
      pushClaimedAt: { $lt: new Date(Date.now() - 300000) },
    },
    { $set: { pushState: "unknown", pushError: "DELIVERY_OUTCOME_UNKNOWN" } },
  );
  const rows = await Notification.find({
    campaignMode: process.env.APP_MODE,
    campaignId: { $exists: true },
    pushState: "pending",
    $or: [
      { pushNextAt: { $exists: false } },
      { pushNextAt: { $lte: new Date() } },
    ],
  })
    .sort({ createdAt: 1, _id: 1 })
    .limit(20)
    .lean();
  for (const row of rows) {
    const campaign = await AdminNotification.findOne({
      _id: row.campaignId,
      appMode: process.env.APP_MODE,
      status: true,
      deletedAt: { $exists: false },
      displayOn: { $lte: new Date() },
      publishedAt: { $exists: true },
    }).lean();
    const owner = await User.exists({
      _id: row.recipientUserId,
      shopId: row.shopId,
      disabledAt: { $exists: false },
    });
    const shopOwner =
      owner &&
      (await Shop.exists({ _id: row.shopId, ownerId: row.recipientUserId }));
    if (!campaign || !shopOwner) {
      await Notification.updateOne(
        { _id: row._id, pushState: "pending" },
        { $set: { pushState: "skipped" } },
      );
      continue;
    }
    const claim = await Notification.findOneAndUpdate(
      {
        _id: row._id,
        pushState: "pending",
        $or: [
          { pushNextAt: { $exists: false } },
          { pushNextAt: { $lte: new Date() } },
        ],
      },
      {
        $set: { pushState: "claimed", pushClaimedAt: new Date() },
        $inc: { pushAttempts: 1 },
      },
      { new: true },
    );
    if (!claim) continue;
    try {
      const devices = await Device.find({ shopId: row.shopId })
        .select("token updatedAt")
        .limit(100)
        .lean();
      const candidateTokens = [...new Set(devices.map((d) => d.token))];
      // Legacy registration permits a token under multiple shops. Never guess ownership.
      const conflictingTokens = new Set(
        await Device.find({
          token: { $in: candidateTokens },
          shopId: { $ne: row.shopId },
        }).distinct("token"),
      );
      const tokens = candidateTokens.filter(
        (token) => !conflictingTokens.has(token),
      );
      if (!tokens.length) {
        await Notification.updateOne(
          { _id: row._id, pushState: "claimed" },
          {
            $set: {
              pushState: "skipped",
              pushError: candidateTokens.length
                ? "DEVICE_OWNERSHIP_UNRESOLVED"
                : "NO_REGISTERED_DEVICE",
            },
          },
        );
        continue;
      }
      const result = await sendPush(
        tokens,
        "Digital Khata",
        "A new account notification is available.",
        {
          screen: "notifications",
          shopId: String(row.shopId),
          notificationId: String(row._id),
        },
        { signal: AbortSignal.timeout(15000) },
      );
      const tickets = result?.data;
      if (!Array.isArray(tickets) || tickets.length !== tokens.length)
        throw Error("Unknown provider response");
      if (
        tickets.some(
          (t) =>
            !["ok", "error"].includes(t?.status) ||
            (t.status === "ok" && (typeof t.id !== "string" || !t.id)),
        )
      )
        throw Error("Unknown provider ticket");
      const accepted = tickets.filter(
        (t) => t?.status === "ok" && typeof t.id === "string",
      ).length;
      const safeRetry =
        accepted === 0 &&
        tickets.every(
          (t) =>
            t?.status === "error" && t.details?.error === "MessageRateExceeded",
        ) &&
        claim.pushAttempts < 3;
      await Notification.updateOne(
        { _id: row._id, pushState: "claimed" },
        {
          $set: {
            pushState: safeRetry
              ? "pending"
              : accepted
                ? "ticket_accepted"
                : "failed",
            ...(safeRetry
              ? {
                  pushNextAt: new Date(
                    Date.now() + claim.pushAttempts * 300000,
                  ),
                }
              : {}),
            ...(accepted
              ? {
                  pushTickets: tickets.flatMap((ticket, i) =>
                    ticket?.status === "ok" && typeof ticket.id === "string"
                      ? [
                          {
                            id: ticket.id,
                            token: tokens[i],
                            deviceUpdatedAt: devices.find(
                              (d) => d.token === tokens[i],
                            )?.updatedAt,
                            status: "pending",
                          },
                        ]
                      : [],
                  ),
                  receiptState: "pending",
                  receiptNextAt: new Date(Date.now() + 15 * 60000),
                }
              : {}),
            pushAccepted: accepted,
            pushRejected: tokens.length - accepted,
            ...(!accepted ? { pushError: "PROVIDER_REJECTED" } : {}),
          },
        },
      );
      const invalid = tickets.flatMap((t, i) =>
        t?.status === "error" && t.details?.error === "DeviceNotRegistered"
          ? [tokens[i]]
          : [],
      );
      for (const token of invalid) {
        const registered = devices.find((d) => d.token === token);
        if (registered?.updatedAt)
          await Device.deleteMany({
            shopId: row.shopId,
            token,
            updatedAt: { $lte: registered.updatedAt },
          });
      }
    } catch {
      await Notification.updateOne(
        { _id: row._id, pushState: "claimed" },
        {
          $set: { pushState: "unknown", pushError: "DELIVERY_OUTCOME_UNKNOWN" },
        },
      );
    }
  }
}
export function startAdminNotificationWorker(log) {
  if (task || process.env.ADMIN_NOTIFICATION_WORKER_ENABLED !== "true") return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (let i = 0; i < 10; i++) await publishDueNotifications();
      await processSubscriptionReminders(log);
    } catch {
      log.error(
        { code: "ADMIN_NOTIFICATION_WORKER_FAILED" },
        "Notification publication requires retry",
      );
    } finally {
      try {
        await dispatchNotificationPush();
      } catch {
        log.error(
          { code: "ADMIN_NOTIFICATION_PUSH_FAILED" },
          "Push dispatch requires review",
        );
      }
      try {
        await pollNotificationReceipts();
      } catch {
        log.error(
          { code: "ADMIN_NOTIFICATION_RECEIPTS_FAILED" },
          "Push receipts require retry",
        );
      }
      log.info(
        {
          code: "ADMIN_NOTIFICATION_TICK_COMPLETE",
          appMode: process.env.APP_MODE,
        },
        "Notification worker tick completed",
      );
      running = false;
    }
  };
  task = cron.schedule("* * * * *", run, { noOverlap: true });
  log.info(
    {
      code: "ADMIN_NOTIFICATION_WORKER_STARTED",
      intervalSeconds: 60,
      pushEnabled: process.env.ADMIN_NOTIFICATION_PUSH_ENABLED === "true",
    },
    "Notification worker enabled",
  );
  void run();
  return {
    stop: async () => {
      await task.stop();
      while (running) await new Promise((resolve) => setTimeout(resolve, 100));
    },
  };
}
