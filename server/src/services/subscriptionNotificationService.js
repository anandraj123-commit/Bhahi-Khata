import { ownedPushDevices, removeInvalidPushDevices } from "./pushOwnership.js";
import mongoose from "mongoose";
import { createHash } from "node:crypto";
import { SubscriptionNotificationLog, Notification, Shop } from "../models.js";
import { subscriptionConfig } from "../config/env.js";
import { sendPush } from "../providers.js";
import { log, safeErrorContext } from "../config/logger.js";

export async function sendSubscriptionPush({
  shopId,
  subscriptionId = null,
  notificationType,
  deduplicationKey,
  title,
  body,
}) {
  // Inbox identity is independent of push attempts and provider receipts.
  // Notification failure must never change a verified payment/subscription result.
  try {
    const shop = await Shop.findById(shopId).select("ownerId").lean();
    if (shop)
      await Notification.updateOne(
        {
          _id: new mongoose.Types.ObjectId(
            createHash("sha256")
              .update(`subscription:${shopId}:${deduplicationKey}`)
              .digest("hex")
              .slice(0, 24),
          ),
          shopId,
        },
        {
          $setOnInsert: {
            shopId,
            recipientUserId: shop.ownerId,
            title,
            body,
            category: "subscription",
            read: false,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
  } catch (error) {
    log.warn(
      { code: "SUBSCRIPTION_INBOX_WRITE_FAILED" },
      "Subscription inbox publication requires investigation",
    );
    return false;
  }
  if (!subscriptionConfig.pushEnabled) return false;
  const devices = await ownedPushDevices(shopId);
  const tokens = devices.map((d) => d.token);
  if (!tokens.length) return false;
  let claim;
  try {
    claim = await SubscriptionNotificationLog.create({
      shopId,
      subscriptionId,
      notificationType,
      deduplicationKey,
      status: "scheduled",
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await SubscriptionNotificationLog.findOne({
      shopId,
      deduplicationKey,
    }).lean();
    if (["sent", "delivered"].includes(existing?.status)) return true;
    if (
      (existing && existing.attempts == null) ||
      existing?.deliveryUncertain ||
      (existing?.attempts || 1) >= 3
    )
      return false;
    if (
      existing?.status === "scheduled" &&
      Date.now() - new Date(existing.updatedAt).getTime() >= 5 * 60000
    ) {
      await SubscriptionNotificationLog.updateOne(
        {
          _id: existing._id,
          status: "scheduled",
          updatedAt: existing.updatedAt,
        },
        { $set: { deliveryUncertain: true } },
      );
      return false;
    }
    if (
      !existing ||
      (existing.status === "scheduled" &&
        Date.now() - new Date(existing.updatedAt).getTime() < 5 * 60 * 1000)
    )
      return false;
    claim = await SubscriptionNotificationLog.findOneAndUpdate(
      {
        _id: existing._id,
        status: existing.status,
        updatedAt: existing.updatedAt,
      },
      { $set: { status: "scheduled", sentAt: null }, $inc: { attempts: 1 } },
      { new: true },
    );
    if (!claim) return false;
  }
  let verifiedRejection = false;
  try {
    const receipts = await sendPush(
      tokens,
      title,
      body,
      {
        screen: "subscription",
        shopId: String(shopId),
        subscriptionId: subscriptionId ? String(subscriptionId) : "",
        notificationType,
      },
      { signal: AbortSignal.timeout(15000) },
    );
    if (
      !Array.isArray(receipts?.data) ||
      receipts.data.length !== tokens.length ||
      receipts.data.some(
        (t) =>
          !["ok", "error"].includes(t?.status) || (t.status === "ok" && !t.id),
      )
    )
      throw Error("Unknown provider response");
    verifiedRejection = receipts.data.every((t) => t.status === "error");
    await removeInvalidPushDevices(shopId, devices, receipts?.data);
    const errors = (receipts?.data || []).filter(
      (receipt) => receipt.status === "error",
    );
    if (errors.length === receipts?.data?.length)
      throw new Error("Push provider rejected all subscription notifications");
    await SubscriptionNotificationLog.updateOne(
      { _id: claim._id },
      { $set: { status: "sent", sentAt: new Date() } },
    );
    return true;
  } catch (error) {
    await SubscriptionNotificationLog.updateOne(
      { _id: claim._id },
      { $set: { status: "failed", deliveryUncertain: !verifiedRejection } },
    ).catch(() => {});
    log.warn(
      { shopId: String(shopId), notificationType, ...safeErrorContext(error) },
      "subscription push notification failed",
    );
    return false;
  }
}
